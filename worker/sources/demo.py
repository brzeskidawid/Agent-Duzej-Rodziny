"""Źródło testowe — sprawdza, czy cały łańcuch worker → Supabase → aplikacja działa."""
from __future__ import annotations

from datetime import datetime, timedelta

from .base import Source, Item, Event


class DemoSource(Source):
    name = "demo"

    def __init__(self, child_name: str = ""):
        self.child_name = child_name or None

    def fetch(self):
        now = datetime.now().astimezone()
        items = [
            Item(source="demo", external_id="demo-msg-1", kind="message",
                 title="Testowa wiadomość z workera",
                 body="Jeśli to widzisz w aplikacji, worker poprawnie zapisuje do Supabase.",
                 sender="Worker", published_at=now, child_name=self.child_name),
            Item(source="demo", external_id="demo-hw-1", kind="homework",
                 title="Testowe zadanie domowe na pojutrze",
                 occurred_at=now + timedelta(days=2), published_at=now, child_name=self.child_name),
        ]
        events = [
            Event(source="demo", external_id="demo-ev-1", title="Testowe wydarzenie (worker)",
                  starts_at=(now + timedelta(days=3)).replace(hour=9, minute=0),
                  ends_at=(now + timedelta(days=3)).replace(hour=11, minute=0),
                  all_day=False, child_name=self.child_name),
        ]
        return items, events
