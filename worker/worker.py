"""
AGENT DUŻEJ RODZINY — worker
=========================
Co uruchomienie: pobiera wpisy i wydarzenia z włączonych źródeł (Librus, 4Parents, ...)
i zapisuje je do Supabase. Dzięki kluczowi (source, external_id) nic się nie dubluje —
worker można uruchamiać dowolnie często.

Uruchomienie:  python worker.py            (jednorazowo)
               python worker.py --loop     (co N minut, N = INTERVAL_MINUTES z .env)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client

from sources.base import Source, Item, Event

log = logging.getLogger("worker")


# --------------------------------------------------------------------------- źródła
def build_sources(env: dict) -> list[Source]:
    """Tworzy instancje źródeł wymienionych w SOURCES (np. 'demo,librus,4parents')."""
    wanted = [s.strip().lower() for s in env.get("SOURCES", "demo").split(",") if s.strip()]
    sources: list[Source] = []
    for name in wanted:
        if name == "demo":
            from sources.demo import DemoSource
            sources.append(DemoSource(child_name=env.get("DEMO_CHILD", "")))
        elif name == "librus":
            from sources.librus import LibrusSource
            sources.append(LibrusSource(
                login=env["LIBRUS_LOGIN"], password=env["LIBRUS_PASSWORD"],
                child_name=env.get("LIBRUS_CHILD", ""),
            ))
        elif name == "4parents":
            from sources.fourparents import FourParentsSource
            sources.append(FourParentsSource(
                login=env["FOURPARENTS_LOGIN"], password=env["FOURPARENTS_PASSWORD"],
                child_map=env.get("FOURPARENTS_CHILD_MAP", ""),
                base_url=env.get("FOURPARENTS_URL", ""),
            ))
        else:
            log.warning("Nieznane źródło w SOURCES: %s (pomijam)", name)
    return sources


# --------------------------------------------------------------------------- zapis
class Store:
    def __init__(self, url: str, service_key: str):
        self.sb = create_client(url, service_key)
        self._children: dict[str, str] | None = None

    def child_id(self, name: str | None) -> str | None:
        """Mapuje imię dziecka (jak w aplikacji) na id; None, gdy brak/nie znaleziono."""
        if not name:
            return None
        if self._children is None:
            rows = self.sb.table("children").select("id,name").execute().data or []
            self._children = {r["name"].strip().lower(): r["id"] for r in rows}
        cid = self._children.get(name.strip().lower())
        if cid is None:
            log.warning("Nie znaleziono dziecka '%s' w aplikacji — wpis trafi bez przypisania", name)
        return cid

    def existing_ids(self, source: str, external_ids: list[str]) -> set[str]:
        """Które z podanych external_id już są w bazie (żeby nie pobierać ponownie treści/załączników)."""
        found: set[str] = set()
        for i in range(0, len(external_ids), 200):
            chunk = external_ids[i:i + 200]
            rows = self.sb.table("items").select("external_id").eq("source", source).in_("external_id", chunk).execute().data or []
            found.update(r["external_id"] for r in rows)
        return found

    def upload_file(self, path: str, content: bytes, content_type: str | None) -> str | None:
        """Zapisuje plik w buckecie 'attachments'. Zwraca ścieżkę lub None przy błędzie."""
        try:
            self.sb.storage.from_("attachments").upload(
                path, content, {"content-type": content_type or "application/octet-stream", "upsert": "true"},
            )
            return path
        except Exception as e:
            log.warning("Nie udało się zapisać załącznika %s: %s", path, e)
            return None

    def upsert_items(self, items: list[Item]) -> int:
        rows = []
        for it in items:
            rows.append({
                "source": it.source, "external_id": it.external_id, "kind": it.kind,
                "title": it.title[:300], "body": it.body, "sender": it.sender,
                "occurred_at": _iso(it.occurred_at), "published_at": _iso(it.published_at) or _iso(datetime.now(timezone.utc)),
                "url": it.url, "raw": it.raw, "child_id": self.child_id(it.child_name),
            })
        if not rows:
            return 0
        # ignore_duplicates=True → istniejące wpisy nie są nadpisywane (zachowujemy np. ręczne zmiany)
        self.sb.table("items").upsert(rows, on_conflict="source,external_id", ignore_duplicates=True).execute()
        return len(rows)

    def upsert_events(self, events: list[Event]) -> int:
        rows = []
        for ev in events:
            rows.append({
                "source": ev.source, "external_id": ev.external_id, "title": ev.title[:300],
                "notes": ev.notes, "starts_at": _iso(ev.starts_at), "ends_at": _iso(ev.ends_at),
                "all_day": ev.all_day, "child_id": self.child_id(ev.child_name),
            })
        if not rows:
            return 0
        # wydarzenia aktualizujemy (zmiana terminu w dzienniku ma się odbić w kalendarzu)
        self.sb.table("events").upsert(rows, on_conflict="source,external_id").execute()
        return len(rows)


def _iso(d: datetime | None) -> str | None:
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.astimezone()  # lokalna strefa komputera
    return d.isoformat()


# --------------------------------------------------------------------------- pętla
def run_once(store: Store, sources: list[Source]) -> None:
    for src in sources:
        t0 = time.time()
        src.store = store  # dostęp do bazy/magazynu plików (deduplikacja, załączniki)
        try:
            items, events = src.fetch()
            n_i = store.upsert_items(items)
            n_e = store.upsert_events(events)
            log.info("%-10s OK  wpisy=%d wydarzenia=%d  (%.1fs)", src.name, n_i, n_e, time.time() - t0)
        except NotImplementedError as e:
            log.warning("%-10s POMINIĘTE: %s", src.name, e)
        except Exception as e:  # jedno źródło nie może położyć pozostałych
            log.exception("%-10s BŁĄD: %s", src.name, e)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", action="store_true", help="działaj w pętli co INTERVAL_MINUTES")
    args = ap.parse_args()

    load_dotenv()
    env = dict(os.environ)
    logging.basicConfig(level=env.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")

    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(k):
            log.error("Brak %s w pliku .env", k)
            return 2

    key = env["SUPABASE_SERVICE_ROLE_KEY"].strip()
    if not (key.startswith("sb_secret_") or key.startswith("eyJ")):
        log.error("SUPABASE_SERVICE_ROLE_KEY w .env nie wygląda na klucz tajny (powinien zaczynać się od sb_secret_). Otwórz .env i wklej klucz z Supabase → Project Settings → API Keys → Secret keys.")
        return 2
    store = Store(env["SUPABASE_URL"], key)
    sources = build_sources(env)
    if not sources:
        log.error("Brak źródeł do uruchomienia (SOURCES w .env)")
        return 2

    interval = int(env.get("INTERVAL_MINUTES", "15"))
    while True:
        run_once(store, sources)
        if not args.loop:
            return 0
        time.sleep(interval * 60)


if __name__ == "__main__":
    sys.exit(main())
