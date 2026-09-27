"""Create the v2 ledger without promoting archived legacy metrics into production."""
import hashlib
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from price_freshness import number, utc_now


VERSION = 'demo-reliability-v2'
LEGACY_ISOLATION_VERSION = 'legacy-fake-metrics-v1'
LEGACY_FAKE_BALANCE_MIN = 1_450_000.0
LEGACY_FAKE_BALANCE_MAX = 1_490_000.0
LEGACY_FINANCIAL_TABLES = ('portfolio_state', 'trades', 'decisions')
KNOWN_LEGACY_FIXTURE_FINGERPRINTS = frozenset({
    # Archived 2026-09-01 fake 1,468,001-credit dataset from the affected workspace.
    '39e0898a9c93605e27aa1bc9f5cc54bc88222df9520d0fc12ed9ebc730305523',
    # Small immutable regression fixture in test_legacy_isolation.py.
    '041b24a0842fb9c7477a98841c3d6c7f30de619ecec17848c21fa5198857a8da',
})


def _quoted(identifier):
    return '"' + str(identifier).replace('"', '""') + '"'


def _tables(conn):
    return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _legacy_signature(conn, tables):
    """Return a stable signature only for the known million-credit fake-data era."""
    if 'portfolio_state' not in tables:
        return None
    columns = {row[1] for row in conn.execute('PRAGMA table_info(portfolio_state)')}
    if not {'balance_usdt', 'equity'}.issubset(columns):
        return None
    marker = conn.execute('''
        SELECT 1 FROM portfolio_state
        WHERE ABS(COALESCE(balance_usdt, 0)) BETWEEN ? AND ?
           OR ABS(COALESCE(equity, 0)) BETWEEN ? AND ?
        LIMIT 1
    ''', (LEGACY_FAKE_BALANCE_MIN, LEGACY_FAKE_BALANCE_MAX,
          LEGACY_FAKE_BALANCE_MIN, LEGACY_FAKE_BALANCE_MAX)).fetchone()
    if not marker:
        return None

    digest = hashlib.sha256()
    counts = {}
    present = [table for table in LEGACY_FINANCIAL_TABLES if table in tables]
    for table in present:
        schema = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()[0]
        digest.update(table.encode('utf-8'))
        digest.update((schema or '').encode('utf-8'))
        count = 0
        for row in conn.execute(f'SELECT * FROM {_quoted(table)} ORDER BY rowid'):
            digest.update(json.dumps(list(row), default=str, ensure_ascii=True, separators=(',', ':')).encode('utf-8'))
            digest.update(b'\n')
            count += 1
        counts[table] = count
    return {'fingerprint': digest.hexdigest(), 'tables': present, 'counts': counts}


def _file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_archive(path, signature):
    archive = Path(path)
    if not archive.is_file():
        return None
    with closing(sqlite3.connect(archive)) as conn:
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Legacy quarantine failed SQLite integrity validation.')
        row = conn.execute('''
            SELECT fingerprint, table_counts_json FROM legacy_quarantine_manifest
            WHERE isolation_version=?
        ''', (LEGACY_ISOLATION_VERSION,)).fetchone()
        if not row or row[0] != signature['fingerprint']:
            raise RuntimeError('Existing legacy quarantine does not match source data.')
        counts = json.loads(row[1])
        for table, expected in signature['counts'].items():
            actual = conn.execute(f'SELECT COUNT(*) FROM {_quoted(table)}').fetchone()[0]
            if actual != expected or counts.get(table) != expected:
                raise RuntimeError('Legacy quarantine row-count validation failed.')
    return _file_sha256(archive)


def _write_archive(conn, archive, signature, created_at, source_name):
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        return _validate_archive(archive, signature)

    temporary = archive.with_name(archive.name + '.tmp-' + uuid4().hex)
    try:
        with closing(sqlite3.connect(temporary)) as destination:
            destination.execute('''
                CREATE TABLE legacy_quarantine_manifest(
                    isolation_version TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
                    created_at TEXT NOT NULL, source_name TEXT NOT NULL,
                    table_counts_json TEXT NOT NULL
                )
            ''')
            destination.execute(
                'INSERT INTO legacy_quarantine_manifest VALUES(?,?,?,?,?)',
                (LEGACY_ISOLATION_VERSION, signature['fingerprint'], created_at,
                 source_name, json.dumps(signature['counts'], sort_keys=True)),
            )
            for table in signature['tables']:
                schema = conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
                ).fetchone()[0]
                destination.execute(schema)
                rows = conn.execute(f'SELECT * FROM {_quoted(table)} ORDER BY rowid').fetchall()
                if rows:
                    placeholders = ','.join('?' for _ in rows[0])
                    destination.executemany(
                        f'INSERT INTO {_quoted(table)} VALUES({placeholders})', rows
                    )
            destination.commit()
            if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Legacy quarantine failed SQLite integrity validation.')
        os.replace(temporary, archive)
    finally:
        if temporary.exists():
            temporary.unlink()
    return _validate_archive(archive, signature)


def quarantine_legacy_fake_metrics(db_path, *, approved_fingerprint=None):
    """Archive and isolate the known fake legacy financial dataset, if present."""
    path = Path(db_path).resolve()
    if not path.exists():
        return {'status': 'not_present', 'quarantined': False}
    with closing(sqlite3.connect(path, timeout=30)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute('BEGIN IMMEDIATE')
        try:
            tables = _tables(conn)
            signature = _legacy_signature(conn, tables)
            if not signature:
                conn.rollback()
                return {'status': 'not_detected', 'quarantined': False}
            fingerprint = signature['fingerprint']
            explicitly_approved = approved_fingerprint is not None and approved_fingerprint == fingerprint
            if fingerprint not in KNOWN_LEGACY_FIXTURE_FINGERPRINTS and not explicitly_approved:
                conn.rollback()
                return {
                    'status': 'candidate_detected',
                    'quarantined': False,
                    'fingerprint': fingerprint,
                    'tableCounts': signature['counts'],
                    'approvalRequired': True,
                }
            conn.execute('''
                CREATE TABLE IF NOT EXISTS crypto_legacy_isolations(
                    fingerprint TEXT PRIMARY KEY, isolation_version TEXT NOT NULL,
                    created_at TEXT NOT NULL, archive_path TEXT NOT NULL,
                    archive_sha256 TEXT NOT NULL, table_counts_json TEXT NOT NULL,
                    restored_at TEXT
                )
            ''')
            existing = conn.execute(
                'SELECT archive_path, archive_sha256 FROM crypto_legacy_isolations WHERE fingerprint=?',
                (signature['fingerprint'],),
            ).fetchone()
            quarantine_dir = path.parent / 'legacy-quarantine'
            archive = quarantine_dir / f'{path.stem}.legacy-{signature["fingerprint"][:16]}.sqlite3'
            archive_hash = _write_archive(conn, archive, signature, utc_now(), path.name)
            if existing and (Path(existing[0]).resolve() != archive.resolve() or existing[1] != archive_hash):
                raise RuntimeError('Legacy isolation audit record does not match verified quarantine.')
            for table in signature['tables']:
                conn.execute(f'DELETE FROM {_quoted(table)}')
            conn.execute('''
                INSERT INTO crypto_legacy_isolations VALUES(?,?,?,?,?,?,NULL)
                ON CONFLICT(fingerprint) DO UPDATE SET
                    archive_path=excluded.archive_path,
                    archive_sha256=excluded.archive_sha256,
                    table_counts_json=excluded.table_counts_json,
                    restored_at=NULL
            ''', (signature['fingerprint'], LEGACY_ISOLATION_VERSION, utc_now(), str(archive),
                  archive_hash, json.dumps(signature['counts'], sort_keys=True)))
            conn.commit()
            return {'status': 'quarantined', 'quarantined': True, 'archivePath': str(archive),
                    'archiveSha256': archive_hash, 'fingerprint': signature['fingerprint'],
                    'tableCounts': signature['counts']}
        except Exception:
            conn.rollback()
            raise


def restore_legacy_quarantine(db_path, archive_path):
    """Explicit rollback helper. It refuses to merge into non-empty legacy tables."""
    path, archive = Path(db_path).resolve(), Path(archive_path).resolve()
    if archive.parent != path.parent / 'legacy-quarantine':
        raise ValueError('Archive must be inside the database legacy-quarantine directory.')
    with closing(sqlite3.connect(archive)) as source:
        source.row_factory = sqlite3.Row
        if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Legacy quarantine failed SQLite integrity validation.')
        manifest = source.execute('''
            SELECT fingerprint, table_counts_json FROM legacy_quarantine_manifest
            WHERE isolation_version=?
        ''', (LEGACY_ISOLATION_VERSION,)).fetchone()
        if not manifest:
            raise ValueError('Archive is not a supported legacy quarantine.')
        counts = json.loads(manifest['table_counts_json'])
        with closing(sqlite3.connect(path, timeout=30)) as destination:
            destination.execute('BEGIN IMMEDIATE')
            try:
                record = destination.execute('''
                    SELECT archive_sha256, restored_at FROM crypto_legacy_isolations
                    WHERE fingerprint=?
                ''', (manifest['fingerprint'],)).fetchone()
                if not record or record[0] != _file_sha256(archive):
                    raise RuntimeError('Quarantine checksum does not match the isolation audit record.')
                if record[1]:
                    destination.rollback()
                    return {'status': 'already_restored', 'restored': False}
                for table, expected in counts.items():
                    if destination.execute(f'SELECT COUNT(*) FROM {_quoted(table)}').fetchone()[0]:
                        raise RuntimeError('Refusing to merge quarantine into a non-empty legacy table.')
                    rows = source.execute(f'SELECT * FROM {_quoted(table)} ORDER BY rowid').fetchall()
                    if len(rows) != expected:
                        raise RuntimeError('Quarantine row count changed after isolation.')
                    if rows:
                        placeholders = ','.join('?' for _ in rows[0])
                        destination.executemany(
                            f'INSERT INTO {_quoted(table)} VALUES({placeholders})',
                            [tuple(row) for row in rows],
                        )
                restored_at = utc_now()
                destination.execute(
                    'UPDATE crypto_legacy_isolations SET restored_at=? WHERE fingerprint=?',
                    (restored_at, manifest['fingerprint']),
                )
                destination.commit()
                return {'status': 'restored', 'restored': True, 'restoredAt': restored_at}
            except Exception:
                destination.rollback()
                raise


def ensure_indexes(conn):
    conn.execute('CREATE INDEX IF NOT EXISTS crypto_demo_pending ON crypto_demo_operations(status, expires_at)')
    conn.execute('CREATE INDEX IF NOT EXISTS crypto_demo_decision_source ON crypto_demo_decisions_v2(source, timestamp)')


def enforce_active_session_invariant(conn, *, test_only=False):
    """Archive a non-standard active demo session and replace it without deleting history."""
    if test_only or 'crypto_demo_sessions' not in _tables(conn):
        return None
    active = conn.execute(
        'SELECT * FROM crypto_demo_sessions WHERE ended_at IS NULL'
    ).fetchone()
    if not active or float(active['initial_balance']) == 10_000.0:
        return None
    positions = json.loads(active['positions_json'] or '[]')
    recoverable_equity = float(active['cash']) + sum(
        float(item.get('costBasis') or item.get('cost') or 0)
        for item in positions if isinstance(item, dict)
    )
    now = utc_now()
    replacement = 'demo_session_' + uuid4().hex
    conn.execute('''
        CREATE TABLE IF NOT EXISTS crypto_demo_invariant_migrations(
            previous_session_id TEXT PRIMARY KEY, replacement_session_id TEXT NOT NULL,
            migrated_at TEXT NOT NULL, previous_initial_balance REAL NOT NULL,
            reason TEXT NOT NULL
        )
    ''')
    conn.execute('''
        UPDATE crypto_demo_sessions
        SET ended_at=?, reset_reason=?, ending_equity=?, updated_at=?
        WHERE session_id=? AND ended_at IS NULL
    ''', (now, 'archived_non_10000_demo_session', recoverable_equity, now, active['session_id']))
    conn.execute('INSERT INTO crypto_demo_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)', (
        replacement, now, 10_000.0, None, None, 10_000.0, '[]', 0, 0, now, None,
    ))
    conn.execute('INSERT INTO crypto_demo_invariant_migrations VALUES(?,?,?,?,?)', (
        active['session_id'], replacement, now, active['initial_balance'],
        '10_000_credit_invariant',
    ))
    return {'previousSessionId': active['session_id'], 'replacementSessionId': replacement}


def normalize_positions(raw):
    positions = json.loads(raw or '[]')
    if not isinstance(positions, list):
        raise ValueError('Invalid legacy position data; original database retained.')
    normalized = []
    for item in positions:
        if not isinstance(item, dict):
            raise ValueError('Invalid legacy position data; original database retained.')
        p = dict(item)
        p['symbol'] = str(p.get('symbol') or '').replace('/', '').replace('-', '').upper()
        p['amount'] = number(p.get('amount'))
        p['costBasis'] = number(p.get('costBasis', p.get('cost')))
        if p['amount'] is None or p['amount'] <= 0 or p['costBasis'] is None or p['costBasis'] < 0:
            raise ValueError('Invalid legacy position amounts; original database retained.')
        p.setdefault('markPrice', number(p.get('entryPrice')))
        p.setdefault('marketPriceTimestamp', None)
        normalized.append(p)
    return json.dumps(normalized, allow_nan=False)


def migrate(db_path, initial_balance, *, test_only_import_legacy_fixture=False):
    if not test_only_import_legacy_fixture and float(initial_balance) != 10_000.0:
        raise ValueError('Production demo ledger requires exactly 10,000 credits.')
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    quarantine_legacy_fake_metrics(path)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    tables = _tables(conn)
    invariant_migration = enforce_active_session_invariant(
        conn, test_only=test_only_import_legacy_fixture
    )
    if invariant_migration:
        conn.commit()
    if 'crypto_demo_migrations' in tables and conn.execute(
        'SELECT 1 FROM crypto_demo_migrations WHERE version=?', (VERSION,)
    ).fetchone():
        ensure_indexes(conn)
        conn.commit()
        conn.close()
        return
    if tables:
        backup = path.with_name(path.name + '.pre-reliability-v2.bak')
        if not backup.exists():
            with closing(sqlite3.connect(backup)) as destination:
                conn.backup(destination)
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS crypto_demo_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS crypto_demo_sessions(
            session_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, initial_balance REAL NOT NULL,
            ended_at TEXT, reset_reason TEXT, cash REAL NOT NULL CHECK(cash >= 0),
            positions_json TEXT NOT NULL, realized_pnl REAL NOT NULL DEFAULT 0,
            max_drawdown REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, ending_equity REAL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS crypto_demo_one_active ON crypto_demo_sessions((1)) WHERE ended_at IS NULL;
        CREATE TABLE IF NOT EXISTS crypto_demo_operations(
            request_id TEXT PRIMARY KEY, operation_id TEXT UNIQUE NOT NULL, operation TEXT NOT NULL,
            fingerprint TEXT NOT NULL, session_id TEXT NOT NULL, status TEXT NOT NULL,
            state TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, expires_at REAL NOT NULL,
            http_status INTEGER, result_json TEXT, error_code TEXT, events_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS crypto_demo_decisions_v2(
            decision_id TEXT PRIMARY KEY, request_id TEXT, session_id TEXT NOT NULL,
            timestamp TEXT NOT NULL, symbol TEXT, source TEXT NOT NULL, record_json TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS crypto_demo_decision_request ON crypto_demo_decisions_v2(request_id) WHERE request_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS crypto_demo_trades_v2(
            trade_id TEXT PRIMARY KEY, request_id TEXT UNIQUE, operation_id TEXT, decision_id TEXT,
            session_id TEXT NOT NULL, timestamp TEXT NOT NULL, symbol TEXT, source TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS crypto_demo_trades_session ON crypto_demo_trades_v2(session_id, timestamp);
        CREATE INDEX IF NOT EXISTS crypto_demo_decisions_filter ON crypto_demo_decisions_v2(symbol, source, timestamp);
    ''')
    ensure_indexes(conn)
    try:
        conn.execute('BEGIN IMMEDIATE')
        if conn.execute('SELECT 1 FROM crypto_demo_migrations WHERE version=?', (VERSION,)).fetchone():
            conn.rollback()
            return
        now = utc_now()
        session = 'demo_session_' + uuid4().hex
        old = conn.execute('SELECT * FROM demo_portfolio_state ORDER BY id DESC LIMIT 1').fetchone() if test_only_import_legacy_fixture and 'demo_portfolio_state' in tables else None
        old = dict(old) if old else None
        conn.execute('INSERT INTO crypto_demo_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)', (
            session, (old or {}).get('timestamp') or now, (old or {}).get('initial_balance', initial_balance),
            None, None,
            (old or {}).get('cash', initial_balance), normalize_positions((old or {}).get('positions_json')),
            (old or {}).get('realized_pnl') or 0, (old or {}).get('max_drawdown') or 0,
            now, None,
        ))
        decision_ids = {}
        if test_only_import_legacy_fixture and 'demo_decisions' in tables:
            for row in conn.execute('SELECT * FROM demo_decisions ORDER BY id').fetchall():
                legacy = dict(row)
                did = 'jev_decision_' + uuid4().hex if legacy.get('source') == 'jev' else 'demo_decision_' + uuid4().hex
                if legacy.get('source') == 'jev':
                    decision_ids[legacy['id']] = did
                safe_legacy = {key: legacy.get(key) for key in ('timestamp', 'symbol', 'decision', 'confidence', 'model_used', 'source', 'valid', 'latency_ms', 'trade_executed')}
                record = {**safe_legacy, 'id': did, 'legacyId': legacy['id'], 'decisionId': did,
                          'portfolioSessionId': session, 'clientRequestId': None, 'tradeId': None,
                          'model': legacy.get('model_used'), 'action': legacy.get('decision'),
                          'latencyMs': legacy.get('latency_ms'), 'executed': bool(legacy.get('trade_executed')),
                          'riskResult': 'legacy_unverified', 'blockedReason': None,
                          'inputMarketTimestamp': None, 'marketDataAgeMs': None, 'errorCode': None,
                          'safeMessage': 'Imported legacy record; historical price timestamps unavailable.'}
                # Legacy blobs are retained only in the original table, not exposed through v2 APIs.
                record.pop('input_json', None)
                record.pop('raw_json', None)
                conn.execute('INSERT INTO crypto_demo_decisions_v2 VALUES(?,?,?,?,?,?,?)',
                             (did, None, session, legacy.get('timestamp') or now, legacy.get('symbol'), legacy.get('source') or 'manual', json.dumps(record)))
        if test_only_import_legacy_fixture and 'demo_trades' in tables:
            for row in conn.execute('SELECT * FROM demo_trades ORDER BY id').fetchall():
                legacy = dict(row)
                tid = 'demo_trade_' + uuid4().hex
                did = decision_ids.get(legacy.get('decision_id')) if legacy.get('source') == 'jev' else None
                safe_legacy = {key: legacy.get(key) for key in ('timestamp', 'symbol', 'side', 'price', 'amount', 'cost', 'fee', 'pnl', 'source', 'mode')}
                record = {**safe_legacy, 'id': tid, 'legacyId': legacy['id'], 'tradeId': tid, 'decisionId': did,
                          'decision_id': did, 'clientRequestId': None, 'operationId': None, 'portfolioSessionId': session,
                          'requestedCredits': legacy.get('cost'), 'executedQuantity': legacy.get('amount'),
                          'executionPrice': legacy.get('price'), 'realizedPnl': legacy.get('pnl'), 'status': 'executed',
                          'createdAt': legacy.get('timestamp'), 'executedAt': legacy.get('timestamp'),
                          'marketPriceTimestamp': None, 'marketDataAgeMs': None, 'riskResult': 'legacy_unverified'}
                conn.execute('INSERT INTO crypto_demo_trades_v2 VALUES(?,?,?,?,?,?,?,?,?)',
                             (tid, None, None, did, session, legacy.get('timestamp') or now, legacy.get('symbol'), legacy.get('source') or 'manual', json.dumps(record)))
                if did:
                    row = conn.execute('SELECT record_json FROM crypto_demo_decisions_v2 WHERE decision_id=?', (did,)).fetchone()
                    record = json.loads(row[0])
                    record['tradeId'] = tid
                    conn.execute('UPDATE crypto_demo_decisions_v2 SET record_json=? WHERE decision_id=?', (json.dumps(record), did))
        conn.execute('INSERT INTO crypto_demo_migrations VALUES(?,?)', (VERSION, now))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
