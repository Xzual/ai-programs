"""Focused safety tests for recoverable legacy fake-metric isolation."""
import json
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))

from demo_migration import migrate, quarantine_legacy_fake_metrics, restore_legacy_quarantine


def create_legacy_database(path, balance):
    with closing(sqlite3.connect(path)) as conn:
        conn.executescript('''
            CREATE TABLE portfolio_state(
                id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT,
                balance_usdt REAL, equity REAL, positions TEXT
            );
            CREATE TABLE decisions(
                id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, symbol TEXT,
                action TEXT, confidence REAL, reasoning TEXT
            );
            CREATE TABLE trades(
                id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, symbol TEXT,
                side TEXT, price REAL, amount REAL, cost REAL, status TEXT,
                pnl REAL, decision_id INTEGER, mode TEXT
            );
        ''')
        conn.execute(
            "INSERT INTO portfolio_state(timestamp,balance_usdt,equity,positions) VALUES('legacy',?,?, '[]')",
            (balance, balance),
        )
        conn.execute(
            "INSERT INTO decisions(timestamp,symbol,action,confidence,reasoning) VALUES('legacy','BTC/USDT','BUY',1,'fixture')"
        )
        conn.execute(
            "INSERT INTO trades(timestamp,symbol,side,price,amount,cost,status,pnl,decision_id,mode) "
            "VALUES('legacy','BTC/USDT','BUY',50000,1,50000,'CLOSED',999999,1,'PAPER')"
        )
        conn.commit()


def scalar(path, statement):
    with closing(sqlite3.connect(path)) as conn:
        return conn.execute(statement).fetchone()[0]


def main():
    with tempfile.TemporaryDirectory(prefix='edith-legacy-isolation-') as temporary:
        root = Path(temporary)
        db_path = root / 'agent_memory.db'
        create_legacy_database(db_path, 1_468_001.0)

        migrate(db_path, 10_000.0)
        assert scalar(db_path, 'SELECT COUNT(*) FROM portfolio_state') == 0
        assert scalar(db_path, 'SELECT COUNT(*) FROM trades') == 0
        assert scalar(db_path, 'SELECT COUNT(*) FROM decisions') == 0
        assert scalar(db_path, 'SELECT initial_balance FROM crypto_demo_sessions') == 10_000.0
        assert scalar(db_path, 'SELECT cash FROM crypto_demo_sessions') == 10_000.0
        assert scalar(db_path, 'SELECT COUNT(*) FROM crypto_demo_trades_v2') == 0

        with closing(sqlite3.connect(db_path)) as conn:
            isolation = conn.execute('''
                SELECT archive_path, archive_sha256, table_counts_json
                FROM crypto_legacy_isolations
            ''').fetchone()
        archive = Path(isolation[0])
        assert archive.parent == root / 'legacy-quarantine'
        assert archive.is_file()
        assert len(isolation[1]) == 64
        assert json.loads(isolation[2]) == {'decisions': 1, 'portfolio_state': 1, 'trades': 1}
        assert scalar(archive, 'PRAGMA integrity_check') == 'ok'
        assert scalar(archive, 'SELECT COUNT(*) FROM portfolio_state') == 1
        assert scalar(archive, 'SELECT COUNT(*) FROM trades') == 1

        before = sorted(path.name for path in archive.parent.iterdir())
        second = quarantine_legacy_fake_metrics(db_path)
        assert second == {'status': 'not_detected', 'quarantined': False}
        migrate(db_path, 10_000.0)
        assert sorted(path.name for path in archive.parent.iterdir()) == before
        assert scalar(db_path, 'SELECT initial_balance FROM crypto_demo_sessions') == 10_000.0

        restored = restore_legacy_quarantine(db_path, archive)
        assert restored['status'] == 'restored'
        assert scalar(db_path, 'SELECT balance_usdt FROM portfolio_state') == 1_468_001.0
        assert scalar(db_path, 'SELECT COUNT(*) FROM trades') == 1
        assert restore_legacy_quarantine(db_path, archive)['status'] == 'already_restored'

        with archive.open('ab') as handle:
            handle.write(b'quarantine-tamper-test')
        try:
            quarantine_legacy_fake_metrics(db_path)
            raise AssertionError('Tampered quarantine must fail closed.')
        except RuntimeError:
            pass
        assert scalar(db_path, 'SELECT balance_usdt FROM portfolio_state') == 1_468_001.0
        assert scalar(db_path, 'SELECT COUNT(*) FROM trades') == 1

        clean_db = root / 'ordinary-user-data.db'
        create_legacy_database(clean_db, 25_000.0)
        migrate(clean_db, 10_000.0)
        assert scalar(clean_db, 'SELECT COUNT(*) FROM portfolio_state') == 1
        assert scalar(clean_db, 'SELECT COUNT(*) FROM trades') == 1
        assert scalar(clean_db, 'SELECT initial_balance FROM crypto_demo_sessions') == 10_000.0
        assert scalar(clean_db, 'SELECT COUNT(*) FROM crypto_demo_trades_v2') == 0

        other_large_db = root / 'unrelated-large-ledger.db'
        create_legacy_database(other_large_db, 1_200_000.0)
        migrate(other_large_db, 10_000.0)
        assert scalar(other_large_db, 'SELECT COUNT(*) FROM portfolio_state') == 1
        assert not list((root / 'legacy-quarantine').glob('unrelated-large-ledger.legacy-*'))

        legitimate_same_balance = root / 'legitimate-1468m-ledger.db'
        create_legacy_database(legitimate_same_balance, 1_468_001.0)
        with closing(sqlite3.connect(legitimate_same_balance)) as conn:
            conn.execute("UPDATE decisions SET reasoning='legitimate user strategy record'")
            conn.commit()
        candidate = quarantine_legacy_fake_metrics(legitimate_same_balance)
        assert candidate['status'] == 'candidate_detected'
        assert candidate['approvalRequired'] is True
        assert scalar(legitimate_same_balance, 'SELECT balance_usdt FROM portfolio_state') == 1_468_001.0
        assert scalar(legitimate_same_balance, 'SELECT COUNT(*) FROM trades') == 1
        assert not list((root / 'legacy-quarantine').glob('legitimate-1468m-ledger.legacy-*'))

        nonstandard = root / 'nonstandard-demo.db'
        create_legacy_database(nonstandard, 25_000.0)
        with closing(sqlite3.connect(nonstandard)) as conn:
            conn.execute('CREATE TABLE demo_portfolio_state(id INTEGER PRIMARY KEY, timestamp TEXT, initial_balance REAL, cash REAL, equity REAL, positions_json TEXT, realized_pnl REAL, max_drawdown REAL)')
            conn.execute("INSERT INTO demo_portfolio_state VALUES(1,'legacy-demo',5000,4900,5000,'[]',0,0)")
            conn.commit()
        migrate(nonstandard, 10_000.0, test_only_import_legacy_fixture=True)
        migrate(nonstandard, 10_000.0)
        with closing(sqlite3.connect(nonstandard)) as conn:
            active = conn.execute('SELECT initial_balance,cash FROM crypto_demo_sessions WHERE ended_at IS NULL').fetchone()
            archived = conn.execute("SELECT reset_reason FROM crypto_demo_sessions WHERE ended_at IS NOT NULL").fetchone()
            migration_count = conn.execute('SELECT COUNT(*) FROM crypto_demo_invariant_migrations').fetchone()[0]
        assert active == (10_000.0, 10_000.0)
        assert archived[0] == 'archived_non_10000_demo_session'
        assert migration_count == 1

    print('legacy fake metrics quarantined recoverably; 10,000 CR ledger remains isolated [OK]')


if __name__ == '__main__':
    main()
