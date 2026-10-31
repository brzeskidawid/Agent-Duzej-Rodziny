@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Aktualizacja bibliotek workera ===
call .venv\Scripts\activate.bat
pip install --quiet -r requirements.txt && echo OK - biblioteki zaktualizowane. || echo [BLAD] pip install
echo.
echo Teraz uruchom 3_test.bat
pause
