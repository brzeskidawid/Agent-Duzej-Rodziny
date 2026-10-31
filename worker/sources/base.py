"""Wspólny interfejs źródeł. Każde źródło zwraca listę Item (wpisy) i Event (wydarzenia)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Any


@dataclass
class Item:
    source: str                     # 'librus' | '4parents' | ...
    external_id: str                # stabilny identyfikator w systemie źródłowym
    kind: str                       # message | announcement | homework | event | grade | attendance | other
    title: str
    body: Optional[str] = None
    sender: Optional[str] = None
    occurred_at: Optional[datetime] = None   # termin, którego dotyczy wpis (np. data zadania)
    published_at: Optional[datetime] = None  # kiedy wpis pojawił się w dzienniku
    url: Optional[str] = None
    child_name: Optional[str] = None         # imię dziecka dokładnie jak w aplikacji
    raw: Optional[dict[str, Any]] = None     # surowe dane (diagnostyka)


@dataclass
class Event:
    source: str
    external_id: str
    title: str
    starts_at: datetime
    ends_at: Optional[datetime] = None
    all_day: bool = True
    notes: Optional[str] = None
    child_name: Optional[str] = None


class Source:
    """Klasa bazowa. Implementacja musi nadpisać `name` i `fetch()`."""
    name: str = "base"

    def fetch(self) -> tuple[list[Item], list[Event]]:
        raise NotImplementedError
