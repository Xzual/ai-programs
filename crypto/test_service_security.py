"""Loopback API mutation authorization and fixed demo balance checks."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def main():
    with tempfile.TemporaryDirectory(prefix='edith-crypto-security-') as temporary:
        token = 'test-only-internal-token'
        os.environ.update({
            'CRYPTO_DB_PATH': str(Path(temporary) / 'security.db'),
            'CRYPTO_DATA_DIR': temporary,
            'CRYPTO_LOG_DIR': temporary,
            'CRYPTO_STARTING_BALANCE': '10000',
            'EDITH_CRYPTO_INTERNAL_TOKEN': token,
        })
        sys.path.insert(0, str(ROOT / 'src'))
        import dashboard

        dashboard.app.testing = False
        client = dashboard.app.test_client()
        assert client.get('/api/health').status_code == 200
        assert client.post('/api/crypto/jev/loop/stop').status_code == 403
        assert client.post(
            '/api/crypto/jev/loop/stop',
            headers={'X-EDITH-Internal-Token': token, 'Origin': 'https://attacker.example'},
        ).status_code == 403
        allowed = client.post(
            '/api/crypto/jev/loop/stop',
            headers={'X-EDITH-Internal-Token': token},
        )
        assert allowed.status_code == 200
        allowed_body = allowed.get_json()
        assert (allowed_body.get('data') or {})['status']['running'] is False

        invalid_env = {**os.environ, 'CRYPTO_STARTING_BALANCE': '123.45'}
        probe = subprocess.run(
            [sys.executable, '-c', 'import config'],
            cwd=ROOT / 'src', env=invalid_env, capture_output=True, text=True, timeout=15,
        )
        assert probe.returncode != 0
        assert 'must be exactly 10000' in (probe.stdout + probe.stderr)

    print('loopback mutation token and fixed 10,000-credit invariant [OK]')


if __name__ == '__main__':
    main()
