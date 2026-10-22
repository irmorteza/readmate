"""Target languages, loaded from the generated copy of contract/languages.json."""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Language:
    code: str
    english: str
    native: str
    dir: str
    mode: str


_DATA = json.loads(Path(__file__).with_name("languages.json").read_text(encoding="utf-8"))

LANGUAGES: tuple[Language, ...] = tuple(Language(**entry) for entry in _DATA["languages"])
BY_CODE: Mapping[str, Language] = {language.code: language for language in LANGUAGES}
CODES: tuple[str, ...] = tuple(language.code for language in LANGUAGES)
DEFAULT: str = _DATA["default"]


def by_code(code: str) -> Language:
    return BY_CODE[code]
