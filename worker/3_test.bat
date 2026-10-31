@echo off
chcp 65001 >nul
cd /d "%~dp0"
call .venv\Scripts\activate.bat
echo === Test workera (jednorazowe uruchomienie) ===
python worker.py
echo.
pause
