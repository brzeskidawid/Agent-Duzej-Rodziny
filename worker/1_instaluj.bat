@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Agent Duzej Rodziny - instalacja workera ===
echo.
set "PY="
py -3 -c "import sys" >nul 2>&1 && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>&1 && set "PY=python"
if not defined PY (
  echo [BLAD] Nie znaleziono prawdziwego Pythona ^(to co odpowiada, to atrapa Windows^).
  echo Zainstaluj "Python 3.12" ze Sklepu Microsoft ^(wydawca: Python Software Foundation^)
  echo albo z https://www.python.org/downloads/ ^(zaznacz "Add python.exe to PATH"^),
  echo i uruchom ten plik ponownie.
  pause
  exit /b 1
)
%PY% --version
if not exist .venv (
  echo Tworze srodowisko .venv ...
  %PY% -m venv .venv || (echo [BLAD] venv & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
echo Instaluje biblioteki ...
python -m pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt || (echo [BLAD] pip install & pause & exit /b 1)
echo.
if not exist .env copy .env.example .env >nul
echo Otwieram plik .env - wklej klucz SUPABASE_SERVICE_ROLE_KEY i zapisz ^(Ctrl+S^), potem zamknij Notatnik.
start /wait notepad .env
echo.
echo === Test workera ===
python worker.py
echo.
echo Jesli wyzej jest "demo OK wpisy=2 wydarzenia=1" - dziala. Sprawdz zakladke Wpisy w aplikacji.
echo Nastepnie uruchom 2_dodaj_do_harmonogramu.bat
pause
