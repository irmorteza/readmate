import json
import unicodedata
from dataclasses import replace

import pytest

from readmate.wordinfo.request import (
    MAX_BODY_BYTES,
    BadRequest,
    WordInfoRequest,
    cache_key,
    parse_request,
)

VALID = {
    "word": "stellte",
    "wordIndex": 1,
    "sentence": {"kind": "sentence", "words": ["Sie", "stellte", "ihn", "ihrer", "Mutter", "vor."]},
    "target": "en",
}


def body(**over):
    data = json.loads(json.dumps(VALID))
    for key, value in over.items():
        if key == "sentence" and isinstance(value, dict):
            data["sentence"].update(value)
        else:
            data[key] = value
    return json.dumps(data).encode()


def test_valid_request_parses():
    req = parse_request(body())
    assert req == WordInfoRequest(
        "stellte", 1, "sentence", ("Sie", "stellte", "ihn", "ihrer", "Mutter", "vor."), "en"
    )


def test_unknown_keys_are_ignored():
    data = json.loads(body())
    data["extra"] = 1
    data["sentence"]["more"] = [1]
    assert parse_request(json.dumps(data).encode()).word == "stellte"


@pytest.mark.parametrize("raw", [b"null", b"[]", b'"x"', b"3", b"{", b"\xff"])
def test_non_object_or_invalid_json_is_400(raw):
    with pytest.raises(BadRequest):
        parse_request(raw)


def test_body_over_16_kb_is_400():
    raw = body() + b" " * (MAX_BODY_BYTES + 1 - len(body()))
    assert len(raw) == MAX_BODY_BYTES + 1
    with pytest.raises(BadRequest):
        parse_request(raw)


def test_body_of_exactly_16_kb_is_accepted():
    raw = body()
    raw += b" " * (MAX_BODY_BYTES - len(raw))
    assert len(raw) == MAX_BODY_BYTES
    assert parse_request(raw).word == "stellte"


@pytest.mark.parametrize("idx", [True, 1.0, "1", -1, 6, None])
def test_bad_word_index_is_400(idx):
    with pytest.raises(BadRequest):
        parse_request(body(wordIndex=idx))


@pytest.mark.parametrize("words", [[], ["a"] * 121, ["a", 3], ["a", ""], ["a", "   "], ["x" * 65]])
def test_bad_words_are_400(words):
    with pytest.raises(BadRequest):
        parse_request(body(word="a", wordIndex=0, sentence={"words": words}))


def test_words_must_be_a_list():
    with pytest.raises(BadRequest):
        parse_request(body(sentence={"words": "Sie stellte"}))


def test_120_words_and_600_chars_are_accepted():
    words = ["a" * 4] * 119 + ["a" * 5]  # 119*4 + 5 + 119 spaces = 600
    assert len(" ".join(words)) == 600 and len(words) == 120
    req = parse_request(body(word="aaaa", wordIndex=0, sentence={"words": words}))
    assert len(req.words) == 120


def test_601_joined_chars_is_400():
    words = ["a" * 4] * 119 + ["a" * 6]
    assert len(" ".join(words)) == 601
    with pytest.raises(BadRequest):
        parse_request(body(word="aaaa", wordIndex=0, sentence={"words": words}))


@pytest.mark.parametrize("target", ["de", "", None])
def test_bad_target_is_400(target):
    with pytest.raises(BadRequest):
        parse_request(body(target=target))


@pytest.mark.parametrize("kind", ["paragraph", "", None])
def test_bad_kind_is_400(kind):
    with pytest.raises(BadRequest):
        parse_request(body(sentence={"kind": kind}))


@pytest.mark.parametrize("kind", ["sentence", "fragment", "incomplete"])
def test_all_kinds_are_accepted(kind):
    assert parse_request(body(sentence={"kind": kind})).kind == kind


def test_word_must_occur_in_words_at_index():
    with pytest.raises(BadRequest):
        parse_request(body(word="Mutter"))  # index 1 is "stellte"
    assert parse_request(body(word="vor", wordIndex=5)).word == "vor"  # substring of "vor."


@pytest.mark.parametrize("word", [None, 3, "", "   "])
def test_bad_word_is_400(word):
    with pytest.raises(BadRequest):
        parse_request(body(word=word))


def test_word_over_64_chars_is_400():
    long = "x" * 65
    with pytest.raises(BadRequest):
        parse_request(body(word=long, wordIndex=0, sentence={"words": [long]}))
    ok = "x" * 64
    assert parse_request(body(word=ok, wordIndex=0, sentence={"words": [ok]})).word == ok


def test_nfd_input_matches_nfc_and_gives_same_key():
    nfd_text = "Verfügung"
    nfc_text = "Verfügung"
    assert nfd_text != nfc_text
    assert unicodedata.normalize("NFC", nfd_text) == nfc_text
    sent_nfd = {"kind": "fragment", "words": [nfd_text]}
    sent_nfc = {"kind": "fragment", "words": [nfc_text]}
    nfd = parse_request(body(word=nfd_text, wordIndex=0, sentence=sent_nfd))
    nfc = parse_request(body(word=nfc_text, wordIndex=0, sentence=sent_nfc))
    assert nfd.word == nfc_text and nfd.words == (nfc_text,)
    assert nfd == nfc and cache_key(nfd, "wi-1", "m") == cache_key(nfc, "wi-1", "m")


def test_whitespace_inside_a_word_is_collapsed():
    req = parse_request(body(word=" a \t b ", wordIndex=0, sentence={"words": [" a \t b "]}))
    assert req.word == "a b" and req.words == ("a b",)


def test_cache_key_changes_with_every_component():
    base = parse_request(body())
    k = cache_key(base, "wi-1", "claude-haiku-5-5")
    assert len(k) == 64 and all(c in "0123456789abcdef" for c in k)
    variants = [
        cache_key(base, "wi-2", "claude-haiku-5-5"),
        cache_key(base, "wi-1", "other"),
        cache_key(replace(base, kind="fragment"), "wi-1", "claude-haiku-5-5"),
        cache_key(replace(base, word_index=5, word="vor"), "wi-1", "claude-haiku-5-5"),
        cache_key(replace(base, words=base.words[:-1] + ("vor!",)), "wi-1", "claude-haiku-5-5"),
    ]
    assert len({k, *variants}) == 6


def test_cache_key_does_not_depend_on_word_field():
    a = parse_request(body(word="stell"))
    b = parse_request(body(word="stellte"))
    assert a.word != b.word
    assert cache_key(a, "wi-1", "m") == cache_key(b, "wi-1", "m")


def _raw(word, w0):
    tmpl = (
        '{"word": "WORD", "wordIndex": 0, "target": "en", '
        '"sentence": {"kind": "fragment", "words": ["W0"]}}'
    )
    return tmpl.replace("WORD", word).replace("W0", w0).encode()


def test_lone_surrogate_in_words_is_400():
    raw = _raw(r"\ud800", r"\ud800")
    with pytest.raises(BadRequest):
        parse_request(raw)


def test_lone_surrogate_in_word_only_is_400():
    raw = _raw(r"\ud800", r"a\ud800")
    with pytest.raises(BadRequest):
        parse_request(raw)


def test_deeply_nested_json_is_400():
    with pytest.raises(BadRequest):
        parse_request(b"[" * 16000)
