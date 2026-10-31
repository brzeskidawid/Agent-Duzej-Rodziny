"""
Librus Synergia — konektor.

STATUS: SZKIELET. Logika logowania i pobierania zostanie dopisana w kolejnym kroku,
po wyborze biblioteki (kandydaci: librus-apix, własny klient do gateway/api/2.0).

Docelowo fetch() zwraca:
  - wiadomości (kind='message')      - ogłoszenia (kind='announcement')
  - zadania domowe (kind='homework') - terminarz jako Event
  - oceny (kind='grade')             - nieobecności (kind='attendance')
"""
from __future__ import annotations

from .base import Source, Item, Event


class LibrusSource(Source):
    name = "librus"

    def __init__(self, login: str, password: str, child_name: str = ""):
        self.login = login
        self.password = password
        self.child_name = child_name or None

    def fetch(self) -> tuple[list[Item], list[Event]]:
        raise NotImplementedError("Konektor Librus nie jest jeszcze zaimplementowany — kolejny krok.")
