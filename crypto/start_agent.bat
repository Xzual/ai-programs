@echo off
title EDITH Crypto Observer
echo ==========================================
echo    EDITH CRYPTO OBSERVER SERVICE
echo ==========================================
echo.
set CRYPTO_MODE=OBSERVER_ONLY
set CRYPTO_TRADING_ENABLED=false
set CRYPTO_PAPER_TRADING_ENABLED=false
set CRYPTO_LIVE_TRADING_ENABLED=false
set CRYPTO_OBSIDIAN_ENABLED=true
set EDITH_OBSIDIAN_VAULT_PATH=D:\EDİTH\EDİTH

:: Check if virtual environment exists
if not exist ".venv\Scripts\python.exe" (
    echo Sanal ortam bulunamadi! Olusturuluyor...
    uv venv --python 3.12
    echo.
)

echo Bagimliliklar kontrol ediliyor...
uv pip install -r requirements.txt
echo.

:: Create necessary directories
if not exist "data" mkdir data
if not exist "logs" mkdir logs
echo.

echo Observer API service baslatiliyor...
echo Dashboard: http://localhost:5000
echo Trading: DISABLED
echo Observer: STOPPED - EDITH UI ile manuel baslatilir
echo.
.venv\Scripts\python.exe run_agent.py
pause
