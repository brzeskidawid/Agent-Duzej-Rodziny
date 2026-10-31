@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Dodaje zadanie do Harmonogramu zadan Windows (co 15 minut) ===
schtasks /Create /F /SC MINUTE /MO 15 /TN "Agent Duzej Rodziny - worker" /TR "\"%~dp0run.bat\"" /ST 00:00
if errorlevel 1 (
  echo [BLAD] Nie udalo sie dodac zadania. Uruchom ten plik "jako administrator" ^(prawy klik^).
) else (
  echo OK - worker bedzie uruchamiany co 15 minut, gdy komputer jest wlaczony.
  echo Log: %~dp0worker.log
)
pause
