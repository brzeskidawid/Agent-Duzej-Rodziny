"""
4Parents — konektor (prywatne API portalu rodzica: prodapiv3.4parents.pl).

Pobiera:
  - wiadomości od nauczycieli (wątki)        -> wpis kind='message'
  - ogłoszenia z tablicy                     -> wpis kind='announcement'
  - wydarzenia (ogłoszenia z datą)           -> wydarzenie w kalendarzu + wpis kind='event'
  - dni wolne / przedszkole nieczynne        -> wydarzenie całodniowe

Prośby typu „przynieś blok na środę" nie mają w 4Parents osobnego pola z terminem,
więc datę wyciągamy z treści (ten sam parser co w Librusie).
"""
from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timedelta

import requests

from .base import Source, Item, Event
from .dates_pl import extract_date

log = logging.getLogger("worker.4parents")

API = "https://prodapiv3.4parents.pl"
THREADS_LIMIT = 30          # ile wątków przejrzeć
MESSAGES_PER_THREAD = 20
POSTS_LIMIT = 60            # ile ogłoszeń z tablicy
EVENT_MONTHS_BACK = 1       # ile miesięcy wstecz brać wydarzenia z kalendarza
EVENT_MONTHS_FWD = 3
TIMEOUT = 30

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\n{3,}")
BRING_RE = re.compile(r"przyni|przynie[śs]|prosz[ęe] o |zabra[ćc]|potrzebn|ubra|str[óo]j|przebranie|wp[łl]at", re.I)


def _text(html_str: str | None, limit: int = 4000) -> str | None:
    if not html_str:
        return None
    t = html_str.replace("</p>", "\n").replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    t = html.unescape(_TAG_RE.sub("", t)).replace("\xa0", " ")
    t = _WS_RE.sub("\n\n", t).strip()
    return t[:limit] or None


def _dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone()
    except ValueError:
        return None


def _date_time(date_s: str | None, time_s: str | None) -> datetime | None:
    if not date_s:
        return None
    try:
        d = datetime.strptime(str(date_s)[:10], "%Y-%m-%d")
    except ValueError:
        return None
    if time_s:
        m = re.match(r"(\d{1,2}):(\d{2})", str(time_s))
        if m:
            d = d.replace(hour=int(m.group(1)), minute=int(m.group(2)))
        else:
            d = d.replace(hour=12)
    else:
        d = d.replace(hour=12)
    return d.astimezone()


def _months(back: int, fwd: int) -> list[str]:
    now = datetime.now()
    out = []
    for off in range(-back, fwd + 1):
        m = now.month - 1 + off
        out.append(f"{now.year + m // 12}-{m % 12 + 1:02d}")
    return out


class FourParentsSource(Source):
    name = "4parents"

    def __init__(self, login: str, password: str, child_map: str = "", base_url: str = ""):
        if not login or not password:
            raise ValueError("Brak FOURPARENTS_LOGIN / FOURPARENTS_PASSWORD w .env")
        self.login = login
        self.password = password
        self.base_url = (base_url or "https://przedszkolemsf.4parents.pl").rstrip("/")
        # "Jan=Janek;Estera=Estera" — imię w 4Parents = imię w aplikacji
        self.child_map = {k.strip().lower(): v.strip() for k, v in
                          (p.split("=", 1) for p in child_map.split(";") if "=" in p)}
        self.s = requests.Session()
        self.s.headers.update({
            "Accept": "application/json",
            "Origin": self.base_url,
            "Referer": self.base_url + "/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AgentDuzejRodziny/1.0",
        })

    # ------------------------------------------------------------------ API
    FAIL_MSG = {
        "invalidCredentials": "nieprawidłowy e-mail lub hasło. Użyj dokładnie tych danych, którymi logujecie się w aplikacji 4Parents (konto jest zwykle na Karolinę, nie na Ciebie)",
        "accountLocked": "konto tymczasowo zablokowane po nieudanych próbach — odczekaj kilkanaście minut",
        "accountInactive": "konto nieaktywne — dokończ aktywację w portalu",
        "userBlocked": "konto zablokowane przez placówkę",
        "twoFactorRequired": "konto ma włączone uwierzytelnianie dwuskładnikowe (2FA) — wyłącz je w profilu albo daj znać, dopiszę obsługę kodu",
    }

    def _auth(self) -> None:
        r = self.s.post(f"{API}/users/authenticate",
                        json={"login": self.login.strip(), "password": self.password},
                        timeout=TIMEOUT)
        try:
            data = r.json()
        except ValueError:
            data = {}
        token = data.get("token")
        if token:
            self.s.headers["Authorization"] = "Bearer " + token
            if data.get("acceptanceRequired"):
                log.warning("4Parents: w portalu czeka regulamin do zaakceptowania")
            return
        if data.get("challengeToken") or data.get("failureReason") == "twoFactorRequired":
            raise RuntimeError("4Parents: " + self.FAIL_MSG["twoFactorRequired"])
        reason = data.get("failureReason")
        if reason:
            raise RuntimeError(f"4Parents: {self.FAIL_MSG.get(reason, 'logowanie odrzucone (' + str(reason) + ')')}")
        raise RuntimeError(f"4Parents: logowanie nieudane (HTTP {r.status_code}): {r.text[:200]}")

    def _get(self, path: str):
        r = self.s.get(API + path, timeout=TIMEOUT)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    # ------------------------------------------------------------------ pomocnicze
    def _app_name(self, first_name: str) -> str:
        return self.child_map.get((first_name or "").strip().lower(), first_name)

    def _child_for_groups(self, post: dict, by_group: dict[str, str]) -> str | None:
        """Dziecko, którego dotyczy ogłoszenie (po grupie). None = całe przedszkole."""
        groups = post.get("limitedToGroups") or []
        for g in groups:
            gid = g.get("id") if isinstance(g, dict) else g
            if gid in by_group:
                return by_group[gid]
        return None

    # ------------------------------------------------------------------ fetch
    def fetch(self) -> tuple[list[Item], list[Event]]:
        self._auth()
        items: list[Item] = []
        events: list[Event] = []

        kids = self._get("/children/myChildren") or []
        by_group: dict[str, str] = {}
        for k in kids:
            grp = (k.get("enrolledToGroup") or {}).get("id")
            if grp:
                by_group[grp] = self._app_name(k.get("firstName", ""))
        log.info("4Parents: zalogowano, dzieci: %s", ", ".join(self._app_name(k.get("firstName", "")) for k in kids) or "brak")

        # --- wiadomości (wątki)
        try:
            threads = (self._get(f"/privateMessages/threads/my?limit={THREADS_LIMIT}&offset=0") or {}).get("data") or []
            known = self.store.existing_ids("4parents", []) if self.store else set()
            for th in threads:
                tid = th.get("threadId")
                if not tid:
                    continue
                names = {p.get("id"): (p.get("fullName") or p.get("name")) for p in (th.get("participants") or []) if isinstance(p, dict)}
                detail = self._get(f"/privateMessages/threads/{tid}?limit={MESSAGES_PER_THREAD}&offset=0") or {}
                for msg in (detail.get("data") or []):
                    body = _text((msg.get("content") or {}).get("text"))
                    if not body:
                        continue
                    sent = _dt(msg.get("sentAt"))
                    sender = names.get(msg.get("senderId")) or "Przedszkole"
                    title = body.split("\n", 1)[0][:140] or "Wiadomość"
                    occurred = extract_date(body, sent) if BRING_RE.search(body) else None
                    items.append(Item(
                        source="4parents", external_id=f"msg-{msg.get('id')}", kind="message",
                        title=title, body=body, sender=sender,
                        published_at=sent, occurred_at=occurred,
                        url=f"{self.base_url}/opiekun/wiadomosci/moje",
                    ))
        except Exception as e:
            log.warning("4Parents wiadomości: %s", e)

        # --- ogłoszenia z tablicy
        try:
            board = self._get(f"/boardPosts/mygroups?limit={POSTS_LIMIT}&offset=0") or {}
            for post in (board.get("data") or []):
                body = _text(post.get("content"))
                published = _dt(post.get("publishedAt"))
                ev_at = _date_time(post.get("eventDate"), post.get("eventStartTime"))
                occurred = ev_at or (extract_date(f"{post.get('title','')}\n{body or ''}", published) if BRING_RE.search(f"{post.get('title','')} {body or ''}") else None)
                items.append(Item(
                    source="4parents", external_id=f"post-{post.get('id')}",
                    kind="event" if ev_at else "announcement",
                    title=(post.get("title") or "Ogłoszenie")[:300], body=body,
                    sender=(post.get("author") or {}).get("fullName") or "Przedszkole",
                    published_at=published, occurred_at=occurred,
                    child_name=self._child_for_groups(post, by_group),
                    url=f"{self.base_url}/tablica-ogloszen",
                ))
        except Exception as e:
            log.warning("4Parents ogłoszenia: %s", e)

        # --- wydarzenia w kalendarzu (ogłoszenia z datą, po miesiącach)
        try:
            seen: set[str] = set()
            for ym in _months(EVENT_MONTHS_BACK, EVENT_MONTHS_FWD):
                for post in (self._get(f"/boardPosts/{ym}/mygroups") or []):
                    pid = post.get("id")
                    start = _date_time(post.get("eventDate"), post.get("eventStartTime"))
                    if not pid or pid in seen or not start:
                        continue
                    seen.add(pid)
                    end = _date_time(post.get("eventDate"), post.get("eventEndTime"))
                    child = self._child_for_groups(post, by_group)
                    events.append(Event(
                        source="4parents", external_id=f"post-{pid}",
                        title=(post.get("title") or "Wydarzenie")[:300],
                        starts_at=start, ends_at=end,
                        all_day=not bool(post.get("eventStartTime")),
                        notes=_text(post.get("content"), 500), child_name=child,
                    ))
                    items.append(Item(
                        source="4parents", external_id=f"post-{pid}", kind="event",
                        title=(post.get("title") or "Wydarzenie")[:300], body=_text(post.get("content")),
                        sender=(post.get("author") or {}).get("fullName") or "Przedszkole",
                        published_at=_dt(post.get("publishedAt")), occurred_at=start,
                        child_name=child, url=f"{self.base_url}/wydarzenia",
                    ))
        except Exception as e:
            log.warning("4Parents wydarzenia: %s", e)

        # --- dni wolne (przedszkole nieczynne) od początku roku szkolnego
        try:
            now = datetime.now()
            years = {now.year} | {now.year + 1 if now.month >= 9 else now.year - 1}
            start_limit = (now - timedelta(days=60)).date().isoformat()
            for y in sorted(years):
                for d in (self._get(f"/configuration/daysOff/{y}") or []):
                    date_s = str(d.get("date") or "")[:10]
                    if not date_s or date_s < start_limit:
                        continue
                    when = _date_time(date_s, None)
                    if not when:
                        continue
                    events.append(Event(
                        source="4parents", external_id=f"dayoff-{date_s}",
                        title=(d.get("name") or "Przedszkole nieczynne")[:300],
                        starts_at=when, all_day=True,
                    ))
        except Exception as e:
            log.warning("4Parents dni wolne: %s", e)

        log.info("4Parents: wpisy=%d, wydarzenia=%d", len(items), len(events))
        return items, events
