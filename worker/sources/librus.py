"""
Librus Synergia — konektor (biblioteka `librus-synergia`, nieoficjalne API JSON Librusa).

Pobiera z konta rodzica:
  - wiadomości (skrzynka odbiorcza)          -> wpis kind='message'
  - ogłoszenia (tablica ogłoszeń)            -> wpis kind='announcement'
  - zadania domowe                           -> wpis kind='homework' (termin = due_date)
  - terminarz (sprawdziany, wycieczki, ...)  -> wydarzenie w kalendarzu + wpis kind='event'
  - oceny                                    -> wpis kind='grade'

Uwaga: listowanie wiadomości NIE oznacza ich jako przeczytane w Librusie (pobieramy
tylko podgląd treści, jaki daje Librus). Pełną treść zobaczysz w Librusie (link w wpisie).

Sesja (ciasteczka) jest zapisywana w pliku librus_session.json obok workera, żeby nie
logować się przy każdym uruchomieniu (Librus przy częstym logowaniu żąda captchy).
Ten plik daje dostęp do konta — traktuj jak hasło.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import asdict
from datetime import datetime, timedelta

from .base import Source, Item, Event

log = logging.getLogger("worker.librus")

SESSION_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "librus_session.json")
MESSAGES_LIMIT = 40
GRADES_DAYS = 60          # oceny starsze niż tyle dni pomijamy (żeby nie zalać wpisów przy pierwszym uruchomieniu)
LIBRUS_URL = "https://synergia.librus.pl"


def _dt(s: str | None, default_hour: int = 12) -> datetime | None:
    """Librus zwraca '2026-09-05 14:22:11' albo '2026-09-05'."""
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            d = datetime.strptime(s, fmt)
            if fmt == "%Y-%m-%d":
                d = d.replace(hour=default_hour)
            return d.astimezone()  # lokalna strefa komputera
        except ValueError:
            continue
    return None


def _dt_time(date_s: str | None, time_s: str | None) -> datetime | None:
    """Data + osobna godzina ('08:50')."""
    d = _dt(date_s)
    if d is None:
        return None
    if time_s:
        try:
            h, m = time_s.strip().split(":")[:2]
            d = d.replace(hour=int(h), minute=int(m), second=0)
        except ValueError:
            pass
    return d


def _safe_name(name: str) -> str:
    """Nazwa pliku bezpieczna dla ścieżki w magazynie (bez polskich znaków i dziwnych symboli)."""
    import re, unicodedata
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    n = re.sub(r"[^A-Za-z0-9._-]+", "_", n).strip("._") or "plik"
    return n[:120]


def _clean(text: str | None, limit: int = 4000) -> str | None:
    if not text:
        return None
    t = text.replace("\r\n", "\n").strip()
    return t[:limit] if t else None


class LibrusSource(Source):
    name = "librus"

    def __init__(self, login: str, password: str, child_name: str = ""):
        if not login or not password:
            raise ValueError("Brak LIBRUS_LOGIN / LIBRUS_PASSWORD w .env")
        self.login = login
        self.password = password
        self.child_name = child_name or None

    # ------------------------------------------------------------------ public
    def fetch(self) -> tuple[list[Item], list[Event]]:
        return asyncio.run(self._fetch_async())

    # ------------------------------------------------------------------ session
    def _load_session(self):
        from librus_synergia import LibrusSessionData
        try:
            with open(SESSION_FILE, encoding="utf-8") as f:
                return LibrusSessionData(**json.load(f))
        except (OSError, ValueError, TypeError):
            return None

    def _save_session(self, data) -> None:
        try:
            with open(SESSION_FILE, "w", encoding="utf-8") as f:
                json.dump(asdict(data), f)
        except OSError as e:
            log.warning("Nie udało się zapisać sesji Librusa: %s", e)

    # ------------------------------------------------------------------ załączniki
    async def _save_attachment(self, folder: str, filename: str | None, download) -> str | None:
        """Pobiera plik z Librusa i zapisuje w magazynie Supabase. Zwraca ścieżkę lub None."""
        if not self.store:
            return None
        try:
            f = await download()
            if f is None:
                return None
            name = _safe_name(filename or f.filename or "zalacznik")
            return self.store.upload_file(f"{folder}/{name}", f.content, f.content_type)
        except Exception as e:
            log.warning("Załącznik %s: %s", filename, e)
            return None

    # ------------------------------------------------------------------ fetch
    async def _fetch_async(self) -> tuple[list[Item], list[Event]]:
        from librus_synergia import (
            Librus, LibrusCaptchaRequiredError, LibrusInvalidCredentialsError,
            LibrusAccountActionRequiredError, LibrusServerMaintenanceError,
        )

        items: list[Item] = []
        events: list[Event] = []
        try:
            async with Librus(
                self.login, self.password,
                session_data=self._load_session(),
                on_session_update=self._save_session,
                cache_reference_data=True,
            ) as lib:
                me = await lib.me()
                child = self.child_name or me.first_name
                log.info("Librus: zalogowano, uczeń: %s", me.display_name)

                subjects = await lib.subjects()
                teachers = await lib.teachers()

                # --- wiadomości (pełna treść + załączniki tylko dla NOWYCH; otwarcie oznacza w Librusie jako przeczytane)
                try:
                    previews = await lib.messages("inbox", limit=MESSAGES_LIMIT)
                    known = self.store.existing_ids("librus", [f"msg-{m.id}" for m in previews]) if self.store else set()
                    for m in previews:
                        ext = f"msg-{m.id}"
                        if ext in known:
                            continue  # już w bazie — nie dotykamy (nie pobieramy ponownie)
                        body, raw = _clean(m.content), None
                        try:
                            full = await lib.message(m.id, "inbox")
                            if full:
                                body = _clean(full.content) or body
                                files = []
                                for att in full.attachments:
                                    path = await self._save_attachment(
                                        f"librus/{ext}", att.filename,
                                        lambda: lib.download_attachment(att.id, m.id),
                                    )
                                    if path:
                                        files.append({"name": att.filename or "załącznik", "path": path})
                                if files:
                                    raw = {"attachments": files}
                        except Exception as e:
                            log.warning("Librus wiadomość %s: pełna treść/załączniki nieudane (%s) — zapisuję podgląd", m.id, e)
                        items.append(Item(
                            source="librus", external_id=ext, kind="message",
                            title=_clean(m.topic, 300) or "(bez tematu)",
                            body=body, sender=m.sender_name or None,
                            published_at=_dt(m.send_date), child_name=child,
                            url=f"{LIBRUS_URL}/wiadomosci", raw=raw,
                        ))
                except Exception as e:  # jedna sekcja nie może położyć reszty
                    log.warning("Librus wiadomości: %s", e)

                # --- ogłoszenia
                try:
                    for n in await lib.announcements():
                        items.append(Item(
                            source="librus", external_id=f"notice-{n.id}", kind="announcement",
                            title=_clean(n.subject, 300) or "Ogłoszenie",
                            body=_clean(n.content), sender="Szkoła",
                            occurred_at=_dt(n.start_date),
                            published_at=_dt(n.creation_date) or _dt(n.start_date),
                            child_name=child, url=f"{LIBRUS_URL}/ogloszenia",
                        ))
                except Exception as e:
                    log.warning("Librus ogłoszenia: %s", e)

                # --- zadania domowe (+ załączniki dla nowych)
                try:
                    hws = await lib.homework()
                    known = self.store.existing_ids("librus", [f"hw-{h.id}" for h in hws]) if self.store else set()
                    for h in hws:
                        ext = f"hw-{h.id}"
                        subj = ""
                        try:
                            subj = subjects.get(h.lesson_id, "") if h.lesson_id is not None else ""
                        except Exception:
                            subj = ""
                        title = _clean(h.topic, 300) or "Zadanie domowe"
                        if subj:
                            title = f"{subj}: {title}"
                        raw = None
                        if ext not in known and h.attachments:
                            files = []
                            for att in h.attachments:
                                path = await self._save_attachment(
                                    f"librus/{ext}", att.filename,
                                    lambda: lib.download_homework_attachment(att.id),
                                )
                                if path:
                                    files.append({"name": att.filename or "załącznik", "path": path})
                            if files:
                                raw = {"attachments": files}
                        items.append(Item(
                            source="librus", external_id=ext, kind="homework",
                            title=title, body=_clean(h.text),
                            sender=teachers.get(h.teacher_id) if h.teacher_id is not None else None,
                            occurred_at=_dt(h.due_date), published_at=_dt(h.date),
                            child_name=child, url=f"{LIBRUS_URL}/zadania_domowe", raw=raw,
                        ))
                except Exception as e:
                    log.warning("Librus zadania domowe: %s", e)

                # --- terminarz (sprawdziany, kartkówki, wycieczki, zebrania)
                try:
                    cats = await lib.agenda_categories()
                    for a in await lib.agenda():
                        cat = cats.get(a.category_id, "") if a.category_id is not None else ""
                        subj = subjects.get(a.subject_id, "") if a.subject_id is not None else ""
                        head = " · ".join(x for x in (cat, subj) if x) or "Terminarz"
                        content = _clean(a.content, 300) or ""
                        title = f"{head}: {content}" if content else head
                        start = _dt_time(a.date, a.time_from)
                        if start is None:
                            continue
                        events.append(Event(
                            source="librus", external_id=f"agenda-{a.id}", title=title[:300],
                            starts_at=start, all_day=not bool(a.time_from),
                            notes=_clean(a.content), child_name=child,
                        ))
                        items.append(Item(
                            source="librus", external_id=f"agenda-{a.id}", kind="event",
                            title=title[:300], body=_clean(a.content), sender=cat or None,
                            occurred_at=start,
                            child_name=child, url=f"{LIBRUS_URL}/terminarz",
                        ))
                except Exception as e:
                    log.warning("Librus terminarz: %s", e)

                # --- oceny (tylko z ostatnich GRADES_DAYS dni)
                try:
                    gcats = await lib.grade_categories()
                    cutoff = datetime.now().astimezone() - timedelta(days=GRADES_DAYS)
                    for g in await lib.grades():
                        added = _dt(g.add_date)
                        if added and added < cutoff:
                            continue
                        subj = subjects.get(g.subject_id, "Ocena") if g.subject_id is not None else "Ocena"
                        gc = gcats.get(g.category_id) if g.category_id is not None else None
                        cat_name = gc.name if gc else ""
                        kind_note = " (propozycja semestralna)" if g.is_semester_proposition else \
                                    " (propozycja końcowa)" if g.is_final_proposition else \
                                    " (semestralna)" if g.is_semester else " (końcowa)" if g.is_final else ""
                        body_parts = [p for p in ([cat_name] if cat_name else []) + list(g.comments) if p]
                        items.append(Item(
                            source="librus", external_id=f"grade-{g.id}", kind="grade",
                            title=f"{subj}: {g.value}{kind_note}"[:300],
                            body=_clean("\n".join(body_parts)),
                            published_at=added, child_name=child, url=f"{LIBRUS_URL}/oceny",
                        ))
                except Exception as e:
                    log.warning("Librus oceny: %s", e)

        except LibrusInvalidCredentialsError:
            raise RuntimeError("Librus: nieprawidłowy login lub hasło (sprawdź LIBRUS_LOGIN / LIBRUS_PASSWORD w .env)")
        except LibrusCaptchaRequiredError:
            raise RuntimeError("Librus: żąda captchy. Zaloguj się raz ręcznie w przeglądarce na synergia.librus.pl, odczekaj godzinę i spróbuj ponownie")
        except LibrusAccountActionRequiredError as e:
            raise RuntimeError(f"Librus: konto wymaga działania w przeglądarce (np. akceptacja regulaminu / zmiana hasła): {e}")
        except LibrusServerMaintenanceError:
            raise RuntimeError("Librus: przerwa techniczna (503), spróbuję przy następnym uruchomieniu")

        log.info("Librus: wpisy=%d (wiad./ogł./zad./term./oceny), wydarzenia=%d", len(items), len(events))
        return items, events
