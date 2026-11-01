"""Diagnostyka logowania 4Parents. Porownuje SUROWA linie z .env z tym, co parsuje dotenv.
Nie wypisuje hasla - tylko dlugosc, pierwszy/ostatni znak i znaki specjalne."""
import os, sys, requests
from pathlib import Path
from dotenv import load_dotenv

API = "https://prodapiv3.4parents.pl"
ENV = Path(__file__).with_name(".env")
KEY = "FOURPARENTS_PASSWORD"


def shape(p):
    """Bezpieczny odcisk hasla: litery -> a/A, cyfry -> 9, reszta doslownie."""
    return "".join("a" if c.islower() else "A" if c.isupper() else "9" if c.isdigit() else c for c in p)


def mask(p):
    return f"{p[0]}{'*' * max(0, len(p) - 2)}{p[-1]}" if len(p) > 1 else (p or "(puste)")


# --- 1. surowa linia z pliku -------------------------------------------------
raw, occurrences = None, 0
if ENV.exists():
    for line in ENV.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        if line.strip().startswith(KEY) and "=" in line:
            occurrences += 1
            raw = line.split("=", 1)[1].rstrip("\r\n")
else:
    print(f"!! Nie znaleziono pliku {ENV}")
    input("Enter...")
    sys.exit(1)

# --- 2. to, co widzi worker --------------------------------------------------
load_dotenv(ENV, interpolate=False)
login = os.getenv("FOURPARENTS_LOGIN", "")
parsed = os.getenv(KEY, "")
url = os.getenv("FOURPARENTS_URL", "https://przedszkolemsf.4parents.pl").rstrip("/")

print("=== .env ===")
print(f"URL   : [{url}]")
print(f"LOGIN : [{login}]  (dlugosc {len(login)})")
if occurrences > 1:
    print(f"!! UWAGA: {KEY} wystepuje {occurrences} razy - liczy sie ostatni wpis")

print("\n=== HASLO ===")
print(f"surowa linia z pliku : {mask(raw or '')}   dlugosc {len(raw or '')}   wzor {shape(raw or '')}")
print(f"co wczytal worker    : {mask(parsed)}   dlugosc {len(parsed)}   wzor {shape(parsed)}")

cands = [("worker (dotenv)", parsed)]
if raw is not None and raw != parsed:
    print("\n>>> ROZNICA! dotenv zmienil haslo podczas wczytywania - to jest przyczyna bledu.")
    cands.append(("surowa linia", raw))
    r2 = raw.strip().strip('"').strip("'")
    if r2 not in (raw, parsed):
        cands.append(("surowa bez cudzyslowow", r2))
else:
    print("\n(dotenv wczytal haslo 1:1 z pliku)")

# --- 3. proby logowania ------------------------------------------------------
s = requests.Session()
s.headers.update({"Accept": "application/json", "Content-Type": "application/json",
                  "Origin": url, "Referer": url + "/",
                  "User-Agent": "Mozilla/5.0 AgentDuzejRodziny/1.0"})

for label, pwd in cands:
    if not pwd:
        continue
    r = s.post(f"{API}/users/authenticate", json={"userName": login.strip(), "password": pwd}, timeout=30)
    try:
        d = r.json()
    except ValueError:
        d = {}
    ok = bool(d.get("token"))
    print(f"\n--- proba: {label} (dlugosc {len(pwd)}) ---")
    print("HTTP", r.status_code, "| powod:", d.get("failureReason"), "| token:", "JEST" if ok else "brak")
    if ok:
        s.headers["Authorization"] = "Bearer " + d["token"]
        kids = s.get(f"{API}/children/myChildren", timeout=30).json()
        names = ", ".join(k.get("firstName", "?") for k in kids) if isinstance(kids, list) else "?"
        print(f"\nDZIALA! Dzieci: {names}")
        if label != "worker (dotenv)":
            print(">>> Poprawne hasto to surowa zawartosc linii. Zaraz poprawie sposob wczytywania .env.")
        input("\nEnter...")
        sys.exit(0)

print("\nZadna wersja hasla nie przeszla.")
input("\nEnter...")
