"""
4Parents — konektor.

STATUS: SZKIELET. Droga pobierania (powiadomienia e-mail / wewnętrzne API portalu /
Playwright) zostanie wybrana po sprawdzeniu, co udostępnia portal rodzica.

FOURPARENTS_CHILD_MAP w .env mapuje nazwę dziecka w 4Parents na imię w aplikacji,
np. "Jan Kowalski=Janek;Anna Kowalska=Ania".
"""
from __future__ import annotations

from .base import Source, Item, Event


class FourParentsSource(Source):
    name = "4parents"

    def __init__(self, login: str, password: str, child_map: str = ""):
        self.login = login
        self.password = password
        self.child_map = dict(p.split("=", 1) for p in child_map.split(";") if "=" in p)

    def fetch(self) -> tuple[list[Item], list[Event]]:
        raise NotImplementedError("Konektor 4Parents nie jest jeszcze zaimplementowany — kolejny krok.")
