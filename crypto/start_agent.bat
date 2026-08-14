@echo off
title Otonom Kripto Trading Agent
echo ==========================================
echo    OTONOM KRIPTO TRADING AGENT
echo ==========================================
echo.

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

echo Agent baslatiliyor...
echo Dashboard: http://localhost:5000
echo.
.venv\Scripts\python.exe run_agent.py
pause
