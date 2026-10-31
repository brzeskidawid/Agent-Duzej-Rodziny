@echo off
REM Uruchamiany przez Harmonogram zadań Windows co 15 minut.
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python worker.py >> worker.log 2>&1
