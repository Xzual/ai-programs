"""Preflight the unconditional run_agent import closure in isolated state."""
import os
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def main():
    with tempfile.TemporaryDirectory(prefix='edith-crypto-imports-') as temporary:
        os.environ.update({
            'EDITH_CRYPTO_RESOURCE_DIR': str(ROOT),
            'EDITH_CRYPTO_RUNTIME_DATA_DIR': temporary,
            'CRYPTO_DATA_DIR': str(Path(temporary) / 'data'),
            'CRYPTO_LOG_DIR': str(Path(temporary) / 'logs'),
            'CRYPTO_DB_PATH': str(Path(temporary) / 'data' / 'agent_memory.db'),
            'CRYPTO_STARTING_BALANCE': '10000',
            'CRYPTO_TRADING_ENABLED': 'false',
            'CRYPTO_PAPER_TRADING_ENABLED': 'false',
            'CRYPTO_LIVE_TRADING_ENABLED': 'false',
            'BINANCE_TRADING_ENABLED': 'false',
            'ENABLE_LIVE_TRADING': 'false',
            'CRYPTO_OBSIDIAN_ENABLED': 'false',
            'CRYPTO_LEARNING_ENABLED': 'false',
            'CRYPTO_NEWS_ENABLED': 'false',
            'CRYPTO_OLLAMA_ENABLED': 'false',
        })
        Path(os.environ['CRYPTO_DATA_DIR']).mkdir(parents=True)
        Path(os.environ['CRYPTO_LOG_DIR']).mkdir(parents=True)
        sys.path.insert(0, str(ROOT / 'src'))
        import dashboard  # noqa: F401
        import runtime_controller  # noqa: F401
        import market_service  # noqa: F401
        import jev_adapter  # noqa: F401
        import jev_loop  # noqa: F401
    print('packaged Crypto import closure [OK]')


if __name__ == '__main__':
    main()
