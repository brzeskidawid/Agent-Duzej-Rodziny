"""Diagnostyka logowania do 4Parents. Nie wypisuje hasła — tylko jego długość i pierwszy/ostatni znak."""
import os, sys, json, requests
from dotenv import load_dotenv

load_dotenv(interpolate=False)
API = "https://prodapiv3.4parents.pl"
url = os.getenv("FOURPARENTS_URL", "https://przedszkolemsf.4parents.pl").rstrip("/")
login = os.getenv("FOURPARENTS_LOGIN", "")
pwd = os.getenv("FOURPARENTS_PASSWORD", "")

print("=== Co worker czyta z .env ===")
print(f"FOURPARENTS_URL      : [{url}]")
print(f"FOURPARENTS_LOGIN    : [{login}]   (długość {len(login)})")
mask = f"{pwd[0]}{'*' * max(0, len(pwd) - 2)}{pwd[-1]}" if len(pwd) > 1 else ("(puste)" if not pwd else "*")
print(f"FOURPARENTS_PASSWORD : [{mask}]   (długość {len(pwd)})")
if login != login.strip() or pwd != pwd.strip():
    print("!! UWAGA: login lub hasło ma spację na początku/końcu — usuń ją w .env")
if pwd.startswith(("'", '"')) or pwd.endswith(("'", '"')):
    print("!! UWAGA: w haśle zostały cudzysłowy — w .env zapisz je bez apostrofów")

s = requests.Session()
s.headers.update({"Accept": "application/json", "Origin": url, "Referer": url + "/",
                  "User-Agent": "Mozilla/5.0 AgentDuzejRodziny/1.0"})

for label, l, p in [("tak jak w .env", login, pwd), ("bez spacji", login.strip(), pwd.strip())]:
    if label == "bez spacji" and (l, p) == (login, pwd):
        continue
    r = s.post(f"{API}/users/authenticate", json={"login": l, "password": p}, timeout=30)
    try:
        d = r.json()
    except ValueError:
        d = {"raw": r.text[:200]}
    print(f"\n=== Próba: {label} ===")
    print("HTTP", r.status_code, "| powód:", d.get("failureReason"), "| token:", "JEST" if d.get("token") else "brak")
    if d.get("token"):
        s.headers["Authorization"] = "Bearer " + d["token"]
        kids = s.get(f"{API}/children/myChildren", timeout=30).json()
        print("DZIAŁA. Dzieci:", ", ".join(k.get("firstName", "?") for k in kids))
        sys.exit(0)

print("\nLogowanie nie przeszło. Sprawdź, czy dokładnie te dane działają na stronie:")
print(f"  {url}/logowanie")
input("\nNaciśnij Enter...")
