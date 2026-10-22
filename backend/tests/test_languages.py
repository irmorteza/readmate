import copy
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import sync_languages  # noqa: E402

from readmate.wordinfo.languages import (  # noqa: E402
    CODES,
    DEFAULT,
    LANGUAGES,
    Language,
    by_code,
)

ROOT = Path(__file__).resolve().parents[2]


def source():
    return json.loads((ROOT / "contract/languages.json").read_text(encoding="utf-8"))


def test_repo_copies_are_in_sync():
    assert sync_languages.stale(ROOT) == [], "run python scripts/sync_languages.py"


def test_contract_file_passes_check():
    sync_languages.check(source())


def test_schema_target_enum_is_the_codes_in_order():
    schema = json.loads((ROOT / "contract/word-info.schema.json").read_text(encoding="utf-8"))
    assert schema["$defs"]["request"]["properties"]["target"] == {"enum": list(CODES)}


def test_loader_matches_spec_list():
    assert CODES == ("en", "de", "fa", "ar", "tr", "uk", "ru", "pl", "es", "fr", "it", "zh-Hans")
    assert DEFAULT == "en"
    assert by_code("fa") == Language("fa", "Persian", "فارسی", "rtl", "translate")
    assert by_code("de").mode == "explain" and by_code("ar").dir == "rtl"
    assert [x.code for x in LANGUAGES if x.dir == "rtl"] == ["fa", "ar"]
    with pytest.raises(KeyError):
        by_code("xx")


def _dup_code(d):
    d["languages"][1]["code"] = "en"


def _empty_english(d):
    d["languages"][0]["english"] = ""


def _bad_dir(d):
    d["languages"][0]["dir"] = "auto"


def _bad_mode(d):
    d["languages"][0]["mode"] = "gloss"


def _extra_entry_key(d):
    d["languages"][0]["extra"] = "x"


def _missing_entry_key(d):
    del d["languages"][0]["native"]


def _bad_default(d):
    d["default"] = "xx"


def _extra_top_key(d):
    d["other"] = 1


def _no_languages(d):
    d["languages"] = []


def _code_with_space(d):
    d["languages"][0]["code"] = "e n"


def _code_empty(d):
    d["languages"][0]["code"] = ""


def _non_string(d):
    d["languages"][0]["native"] = 5


@pytest.mark.parametrize(
    "mutate",
    [
        _dup_code,
        _empty_english,
        _bad_dir,
        _bad_mode,
        _extra_entry_key,
        _missing_entry_key,
        _bad_default,
        _extra_top_key,
        _no_languages,
        _code_with_space,
        _code_empty,
        _non_string,
    ],
)
def test_check_rejects(mutate):
    data = copy.deepcopy(source())
    mutate(data)
    with pytest.raises(ValueError):
        sync_languages.check(data)


OUTPUTS = [
    "backend/src/readmate/wordinfo/languages.json",
    "frontend/src/languages.json",
    "contract/word-info.schema.json",
]


def make_tree(tmp_path):
    (tmp_path / "contract").mkdir()
    languages = (ROOT / "contract/languages.json").read_bytes()
    (tmp_path / "contract/languages.json").write_bytes(languages)
    schema = (ROOT / "contract/word-info.schema.json").read_text(encoding="utf-8")
    schema = re.sub(r'"target": \{.*\}', '"target": { "const": "en" }', schema)
    (tmp_path / "contract/word-info.schema.json").write_text(schema, encoding="utf-8", newline="\n")
    return schema


def test_sync_writes_all_outputs_and_is_idempotent(tmp_path):
    before = make_tree(tmp_path)
    assert set(sync_languages.stale(tmp_path)) == set(OUTPUTS)
    assert sorted(sync_languages.sync(tmp_path)) == sorted(OUTPUTS)
    assert sync_languages.stale(tmp_path) == []
    assert sync_languages.sync(tmp_path) == []
    after = (tmp_path / "contract/word-info.schema.json").read_text(encoding="utf-8")
    changed = [
        (a, b) for a, b in zip(before.split("\n"), after.split("\n"), strict=True) if a != b
    ]
    assert len(changed) == 1 and '"target": { "enum": ["en", "de"' in changed[0][1]


def test_stale_ignores_line_endings(tmp_path):
    make_tree(tmp_path)
    sync_languages.sync(tmp_path)
    p = tmp_path / "frontend/src/languages.json"
    p.write_bytes(p.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
    assert sync_languages.stale(tmp_path) == []
