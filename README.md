# Agent Dużej Rodziny — instrukcja wdrożenia

Wspólny kalendarz, tablica zadań i czat dla dwojga rodziców, z miejscem na automatyczne
zaciąganie wpisów z Librusa i 4Parents. Całość: **Supabase** (baza + logowanie) →
**aplikacja webowa / PWA** (hosting statyczny) → **worker** (Python na Twoim komputerze).

```
agent-duzej-rodziny/
├─ supabase/schema.sql     ← schemat bazy: wklejasz w SQL Editorze
├─ web/                    ← aplikacja (statyczne pliki, bez budowania)
│   ├─ index.html, app.js, styles.css
│   ├─ config.js           ← TU wpisujesz adres Supabase i klucz anon
│   ├─ manifest.webmanifest, sw.js, icon.svg   (PWA — „dodaj do ekranu głównego")
└─ worker/                 ← pobieranie z dzienników (Python)
    ├─ worker.py, sources/, requirements.txt
    ├─ .env.example        ← kopiujesz jako .env i uzupełniasz
    └─ run.bat             ← do Harmonogramu zadań Windows
```

Czas: ok. 20–30 minut klikania. Koszt: 0 zł (darmowe plany Supabase i Vercel wystarczą).

---

## 1. Supabase — projekt i baza (10 min)

1. Wejdź na **https://supabase.com** → *Start your project* → zaloguj się (GitHub lub e-mail).
2. **New project**: nazwa `agent-duzej-rodziny`, region *Central EU (Frankfurt)*, wygeneruj hasło do bazy
   (zapisz je, choć rzadko będzie potrzebne). Poczekaj ~2 min na utworzenie.
3. W menu po lewej: **SQL Editor** → *New query* → wklej **całą** zawartość `supabase/schema.sql` → **Run**.
   Powinno zakończyć się bez błędów (`Success. No rows returned`).
4. **Authentication → Providers → Email**: upewnij się, że *Email* jest włączony, i **wyłącz** *Confirm email*
   (nie chcemy maili potwierdzających dla dwóch kont rodzinnych).
5. **Authentication → Sign In / Providers** (lub *Settings*): **wyłącz** *Allow new users to sign up* —
   tylko Ty tworzysz konta, nikt obcy nie zarejestruje się w Waszej aplikacji.

## 2. Dwa konta rodzinne (3 min)

1. **Authentication → Users → Add user → Create new user**: e-mail i hasło dla Ciebie; zaznacz *Auto Confirm User*.
2. To samo dla żony (inny e-mail).
3. Wróć do **SQL Editor** i wklej (podmień e-maile oraz imiona; kolory możesz zostawić):

```sql
insert into public.family_members (user_id, display_name, color)
select id, 'Dawid', '#0ea5e9' from auth.users where email = 'TWOJ@EMAIL.PL';

insert into public.family_members (user_id, display_name, color)
select id, 'IMIĘ ŻONY', '#ec4899' from auth.users where email = 'EMAIL@ZONY.PL';
```

Sprawdź: **Table Editor → family_members** powinno pokazać 2 wiersze. Bez tego kroku aplikacja
po zalogowaniu powie „Konto nie jest w rodzinie".

## 3. Klucze do aplikacji (1 min)

**Project Settings (ikona zębatki) → API**. Potrzebujesz dwóch rzeczy:

- **Project URL** — np. `https://abcdefgh.supabase.co`
- **anon public** key — długi ciąg zaczynający się od `eyJ...`

Wpisz je w `web/config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',
};
```

Klucz **anon** jest publiczny z założenia — bezpieczeństwo zapewnia RLS w bazie (dostęp tylko dla
kont z tabeli `family_members`). Klucza **service_role** NIGDY nie wpisuj do aplikacji webowej —
on jest tylko dla workera.

## 4. Hosting aplikacji — Vercel (5 min)

Najprościej, bez GitHuba:

1. Wejdź na **https://vercel.com** → załóż konto.
2. **Add New → Project** → na dole *„…or deploy a template / import"* — w nowszym interfejsie
   wystarczy **przeciągnąć folder `web/`** na stronę nowego projektu (drag & drop).
   Jeśli nie widzisz pola do upuszczenia folderu: zainstaluj `npm i -g vercel`, w folderze `web/`
   wpisz `vercel` i potwierdź domyślne odpowiedzi.
3. Po chwili dostajesz adres `https://cos-tam.vercel.app`. Otwórz, zaloguj się swoim kontem.

Alternatywy równie dobre: **Netlify Drop** (https://app.netlify.com/drop — przeciągasz folder,
gotowe) albo **Cloudflare Pages**. Aplikacja to czyste pliki statyczne, więc zadziała wszędzie.

> **Własna domena** — opcjonalnie, w ustawieniach projektu Vercel/Netlify.

## 5. Na telefonie (2 min)

- **iPhone (Safari):** otwórz adres → *Udostępnij* → **Do ekranu początkowego**.
- **Android (Chrome):** otwórz adres → menu ⋮ → **Dodaj do ekranu głównego** / *Zainstaluj aplikację*.

Zrób to na obu telefonach. Aplikacja zapamiętuje logowanie.

## 6. Pierwsze kroki w aplikacji

1. ⚙ **Ustawienia → Dodaj dziecko** — czwórka dzieci, każde ze swoim kolorem i placówką.
2. **+** → zadanie / wydarzenie / wpis. Każde zadanie ma pole **Kto robi** (Ty / żona).
3. Zakładki: **Dziś** (po terminie, najbliższe 7 dni, nieprzeczytane wpisy) · **Kalendarz** (tydzień)
   · **Zadania** (Otwarte / Moje / Partnera / Zrobione) · **Wpisy** (strumień z dzienników)
   · **Czat**.
4. Przy każdym wpisie i wydarzeniu jest przycisk **→ zadanie** — jednym kliknięciem robi z kartki
   ze szkoły zadanie z terminem i osobą.

Wszystko odświeża się na żywo na obu telefonach (Supabase Realtime).

## 7. Worker — pobieranie z dzienników (na razie tryb testowy)

Worker działa na Twoim komputerze; hasła do dzienników zostają u Ciebie w pliku `.env`.

### Instalacja (Windows, jednorazowo)

1. Zainstaluj **Python 3.11+** z https://www.python.org/downloads/ (zaznacz *Add python.exe to PATH*).
2. Otwórz PowerShell w folderze `worker/`:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   copy .env.example .env
   ```
3. Otwórz `.env` w Notatniku i uzupełnij:
   - `SUPABASE_URL` — ten sam co w `config.js`
   - `SUPABASE_SERVICE_ROLE_KEY` — **Project Settings → API → service_role** (klucz tajny!)
   - `SOURCES=demo`, `DEMO_CHILD=` imię jednego z dzieci (dokładnie jak w aplikacji)
4. Test:
   ```powershell
   python worker.py
   ```
   W logu: `demo OK wpisy=2 wydarzenia=1`. W aplikacji w zakładce **Wpisy** pojawią się dwa testowe
   wpisy, a w kalendarzu jedno wydarzenie. Jeśli tak — cały łańcuch działa.

### Harmonogram (co 15 minut)

**Harmonogram zadań** (Task Scheduler) → *Utwórz zadanie*:
- Wyzwalacze: *Codziennie*, powtarzaj co **15 minut** przez *Czas nieokreślony*
- Akcje: *Uruchom program* → `C:\...\worker\run.bat`
- Ustawienia: *Uruchom, nawet jeśli użytkownik nie jest zalogowany* (opcjonalnie)

Alternatywnie, gdy komputer po prostu stoi włączony: `python worker.py --loop`.

### Co dalej: Librus i 4Parents

`sources/librus.py` i `sources/fourparents.py` to na razie szkielety z gotowym interfejsem
(`fetch()` → wpisy + wydarzenia). Konektory dopisujemy w kolejnych krokach; po ich dodaniu
wystarczy w `.env` ustawić `SOURCES=librus,4parents` i uzupełnić loginy. Testowe wpisy `demo`
możesz potem usunąć w **Table Editor → items** (filtr `source = demo`) lub zostawić.

---

## Bezpieczeństwo — w skrócie

| Element | Gdzie | Uwagi |
|---|---|---|
| klucz **anon** | `web/config.js` (publiczny) | bezpieczny dzięki RLS |
| klucz **service_role** | tylko `worker/.env` | omija RLS — nigdy w aplikacji, nigdy w repo |
| hasła do Librusa / 4Parents | tylko `worker/.env` na Twoim komputerze | |
| rejestracja nowych kont | wyłączona w Supabase | tylko Ty dodajesz użytkowników |

## Rozwiązywanie problemów

- **„Brak konfiguracji"** — nie uzupełniono `config.js` (lub wgrano starą wersję).
- **„Nieprawidłowy e-mail lub hasło"** — sprawdź użytkownika w *Authentication → Users*; jeśli
  *Confirm email* było włączone, konto może czekać na potwierdzenie (kliknij *Confirm* przy użytkowniku).
- **„Konto nie jest w rodzinie"** — brak wiersza w `family_members` (krok 2.3).
- **Czat/zadania nie odświeżają się u drugiej osoby** — *Database → Replication*: tabele `messages`,
  `tasks`, `events`, `items` muszą być w publikacji `supabase_realtime` (schema.sql to robi; sprawdź).
- **Worker: „Nie znaleziono dziecka"** — imię w `.env` musi być identyczne jak w aplikacji.
