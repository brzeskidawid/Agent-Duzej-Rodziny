@echo off
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python worker.py >> worker.log 2>&1
