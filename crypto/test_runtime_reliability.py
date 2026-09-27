"""Explicit live-public-data QA on a temporary 10,000-credit demo service.

Runs a real Jev request if configured; never loads or resets the user's ledger.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from uuid import uuid4
from secrets import token_urlsafe

import requests

ROOT = Path(__file__).resolve().parents[1]


def run():
    with tempfile.TemporaryDirectory(prefix='edith-crypto-runtime-', ignore_cleanup_errors=True) as temp:
        with socket.socket() as port_probe:
            port_probe.bind(('127.0.0.1', 0))
            port = port_probe.getsockname()[1]
        crypto_token = token_urlsafe(32)
        env = {**os.environ, 'CRYPTO_DB_PATH': str(Path(temp) / 'isolated.db'), 'CRYPTO_PORT': str(port),
               'CRYPTO_LOG_DIR': temp, 'CRYPTO_DATA_DIR': temp, 'CRYPTO_MODE': 'OBSERVER_ONLY',
               'EDITH_CRYPTO_RESOURCE_DIR': str(ROOT / 'crypto'),
               'EDITH_CRYPTO_RUNTIME_DATA_DIR': temp,
               'TRADING_MODE': 'OBSERVER_ONLY', 'CRYPTO_TRADING_ENABLED': 'false',
               'CRYPTO_PAPER_TRADING_ENABLED': 'false', 'CRYPTO_LIVE_TRADING_ENABLED': 'false',
               'ENABLE_LIVE_TRADING': 'false', 'BINANCE_TRADING_ENABLED': 'false',
               'CRYPTO_DEMO_TRADING_ENABLED': 'true', 'CRYPTO_STARTING_BALANCE': '10000',
               'CRYPTO_OBSIDIAN_ENABLED': 'false', 'CRYPTO_LEARNING_ENABLED': 'false',
               'CRYPTO_NEWS_ENABLED': 'false', 'CRYPTO_OLLAMA_ENABLED': 'false',
               'EDITH_CRYPTO_INTERNAL_TOKEN': crypto_token}
        with open(Path(temp) / 'service.log', 'w', encoding='utf-8') as log:
            def start_service():
                return subprocess.Popen([sys.executable, str(ROOT / 'crypto/run_agent.py')], env=env,
                                        cwd=ROOT, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            def stop_service(process):
                if os.name == 'nt' and process.poll() is None:
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                elif process.poll() is None:
                    process.terminate()
                process.wait(timeout=30)
            process = start_service()
            base = f'http://127.0.0.1:{port}'
            def get(path):
                r = requests.get(base + '/api/crypto/' + path, timeout=45)
                r.raise_for_status()
                return r.json()
            def post(path, body):
                return requests.post(base + '/api/crypto/' + path, json=body, timeout=90,
                                     headers={'X-EDITH-Internal-Token': crypto_token})
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError('Isolated service stopped before readiness')
                    try:
                        if requests.get(base + '/api/health', timeout=1).ok:
                            break
                    except requests.RequestException:
                        pass
                    time.sleep(.2)
                initial = get('portfolio')['portfolio']
                assert initial['currentCash'] == 10000
                assert get('jev/loop')['running'] is False
                payload = {'clientRequestId': str(uuid4()), 'symbol': 'BTCUSDT', 'quoteAmount': 100, 'source': 'manual'}
                buy = post('demo/buy', payload).json()
                assert buy['ok'] and buy['tradeExecuted'], {'stage': 'BUY', 'code': buy.get('errorCode'), 'risk': buy.get('execution')}
                replay = post('demo/buy', payload).json()
                assert replay == buy
                recovered = get('operations/' + payload['clientRequestId'])
                assert recovered['result'] == buy
                assert len(get('trades')['trades']) == 1
                held = post('demo/hold', {'clientRequestId': str(uuid4()), 'symbol': 'BTCUSDT'}).json()
                assert held['ok'] and not held['tradeExecuted']
                assert len(get('trades')['trades']) == 1
                valued = get('portfolio')['portfolio']
                assert valued['openPositions'][0]['currentPriceTimestamp']
                request_id = str(uuid4())
                jev = post('decision/run', {'clientRequestId': request_id, 'symbol': 'BTCUSDT'}).json()
                decision = jev.get('decision')
                assert decision and decision['decisionId'].startswith('jev_decision_')
                assert get('operations/' + request_id)['result'] == jev
                if decision['executed']:
                    trade = get('trades/' + decision['tradeId'])['trade']
                    assert trade['decisionId'] == decision['decisionId'] and trade['source'] == 'jev'
                status = get('status')
                assert status['realOrderEndpointsAvailable'] is False and status['liveExecutionEnabled'] is False
                health = requests.get(base + '/api/health', timeout=5).json()
                assert health['runtime']['resourceLayout']['ready'] is True
                assert health['runtime']['resourceLayout']['stateSeparatedFromResources'] is True
                trade_count = len(get('trades')['trades'])
                stop_service(process)
                process = start_service()
                for _ in range(100):
                    try:
                        if requests.get(base + '/api/health', timeout=1).ok:
                            break
                    except requests.RequestException:
                        pass
                    time.sleep(.2)
                assert get('operations/' + payload['clientRequestId'])['result'] == buy
                assert post('demo/buy', payload).json() == buy
                assert post('decision/run', {'clientRequestId': request_id, 'symbol': 'BTCUSDT'}).json() == jev
                assert len(get('trades')['trades']) == trade_count
                assert get('jev/status')['available'] is not True, 'stored decision replay must not call provider again'
                report = {'isolated': True, 'userAccountUntouched': True, 'startingCash': initial['currentCash'], 'port': port,
                          'buy': {k: buy.get(k) for k in ['clientRequestId', 'operationId', 'tradeId', 'fee']},
                          'replayMatched': True, 'operationRecoveryMatched': True, 'processRestartReplay': True, 'holdDecisionId': held['decisionId'],
                          'portfolioValuationStatus': valued['valuationStatus'],
                          'priceTimestamp': valued['openPositions'][0]['currentPriceTimestamp'],
                          'jev': {k: decision.get(k) for k in ['decisionId', 'action', 'model', 'latencyMs', 'valid', 'executed', 'tradeId', 'errorCode', 'riskResult']},
                          'realOrdersAvailable': False, 'features': status['features']}
                if os.getenv('CRYPTO_TEST_WRITE_ARTIFACT', 'true').strip().lower() == 'true':
                    out = ROOT / 'artifacts/crypto-terminal/reliability-runtime.json'
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_text(json.dumps(report, indent=2), encoding='utf-8')
                print(json.dumps(report, indent=2))
            finally:
                stop_service(process)


if __name__ == '__main__':
    run()
