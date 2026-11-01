"""Wyłuskiwanie terminu z polskiego tekstu (wiadomości nauczycieli).

Obsługiwane formy: '6 listopada', '6 listopada 2026', '06.11', '6.11.2026', '6/11',
'w piątek' / 'w przyszły piątek' (najbliższy taki dzień po dacie wysłania), 'jutro', 'pojutrze'.
Zwraca datetime (godz. 12:00, strefa lokalna) albo None.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

_MONTHS = {
    "stycznia": 1, "lutego": 2, "marca": 3, "kwietnia": 4, "maja": 5, "czerwca": 6,
    "lipca": 7, "sierpnia": 8, "września": 9, "wrzesnia": 9, "października": 10, "pazdziernika": 10,
    "listopada": 11, "grudnia": 12,
    # mianownik / skróty
    "styczeń": 1, "luty": 2, "marzec": 3, "kwiecień": 4, "maj": 5, "czerwiec": 6, "lipiec": 7,
    "sierpień": 8, "wrzesień": 9, "październik": 10, "listopad": 11, "grudzień": 12,
    "sty": 1, "lut": 2, "mar": 3, "kwi": 4, "cze": 6, "lip": 7, "sie": 8, "wrz": 9, "paź": 10, "paz": 10, "lis": 11, "gru": 12,
}
_WEEKDAYS = {
    "poniedziałek": 0, "poniedzialek": 0, "wtorek": 1, "środę": 2, "srode": 2, "środa": 2, "sroda": 2,
    "czwartek": 3, "piątek": 4, "piatek": 4, "sobotę": 5, "sobote": 5, "sobota": 5, "niedzielę": 6, "niedziele": 6, "niedziela": 6,
}
_RE_WORD = re.compile(r"\b(\d{1,2})\s*(?:\.\s*)?(" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\b(?:\s*(\d{4}))?", re.I)
_RE_NUM = re.compile(r"\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b")
_RE_WD = re.compile(r"\b(?:w|we)\s+(?:(?:przysz[łl][yaą]|najbli[żz]sz[yaą]|nadchodz[ąa]c[yaą]|ten|t[ęea])\s+)?(" + "|".join(sorted(_WEEKDAYS, key=len, reverse=True)) + r")\b", re.I)
_RE_REL = re.compile(r"\b(pojutrze|jutro|dzisiaj|dzi[śs])\b", re.I)


def _mk(day: int, month: int, year: int | None, ref: datetime) -> datetime | None:
    try:
        if year is None:
            # rok taki, żeby data była najbliżej daty wysłania (od -45 dni do +330 dni)
            for y in (ref.year, ref.year + 1, ref.year - 1):
                d = datetime(y, month, day, 12, 0)
                if -45 <= (d - ref.replace(tzinfo=None)).days <= 330:
                    return d.astimezone()
            return None
        if year < 100:
            year += 2000
        return datetime(year, month, day, 12, 0).astimezone()
    except ValueError:
        return None


def extract_date(text: str | None, ref: datetime | None) -> datetime | None:
    if not text:
        return None
    ref = (ref or datetime.now().astimezone())
    ref_naive = ref.replace(tzinfo=None)
    candidates: list[tuple[int, datetime]] = []
    for m in _RE_WORD.finditer(text):
        d = _mk(int(m.group(1)), _MONTHS[m.group(2).lower()], int(m.group(3)) if m.group(3) else None, ref)
        if d:
            candidates.append((m.start(), d))
    for m in _RE_NUM.finditer(text):
        day, month = int(m.group(1)), int(m.group(2))
        if not (1 <= day <= 31 and 1 <= month <= 12):
            continue
        d = _mk(day, month, int(m.group(3)) if m.group(3) else None, ref)
        if d:
            candidates.append((m.start(), d))
    if candidates:
        candidates.sort(key=lambda c: c[0])
        return candidates[0][1]
    m = _RE_WD.search(text)
    if m:
        wd = _WEEKDAYS[m.group(1).lower()]
        delta = (wd - ref_naive.weekday()) % 7 or 7
        return (ref_naive + timedelta(days=delta)).replace(hour=12, minute=0, second=0, microsecond=0).astimezone()
    m = _RE_REL.search(text)
    if m:
        _sl = m.group(1).lower()
        _d = 2 if _sl == "pojutrze" else 0 if _sl.startswith("dzi") else 1
        return (ref_naive + timedelta(days=_d)).replace(hour=12, minute=0, second=0, microsecond=0).astimezone()
    return None
