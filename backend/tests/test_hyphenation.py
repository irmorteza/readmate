import copy

from helpers import bx, raw_page
from readmate.pipeline.hyphenation import merge_hyphenated
from readmate.pipeline.normalize import normalize


def make_result(lines):
    return normalize(raw_page(lines))


def word_texts(result):
    return [w["text"] for w in result["words"]]


def test_lowercase_continuation_merges():
    r = make_result(
        [
            [("Das", bx(0.1, 0.1)), ("Vorstel-", bx(0.3, 0.1))],
            [("lungskraft", bx(0.1, 0.14)), ("war", bx(0.4, 0.14))],
        ]
    )
    out = merge_hyphenated(r)
    assert word_texts(out) == ["Das", "Vorstellungskraft", "war"]
    merged = out["words"][1]
    assert merged["boxIds"] == [1, 2]
    assert merged["lineIds"] == [0, 1]
    assert out["boxes"][1]["wordId"] == merged["id"]
    assert out["boxes"][2]["wordId"] == merged["id"]


def test_uppercase_continuation_keeps_hyphen():
    r = make_result(
        [
            [("Herr", bx(0.1, 0.1)), ("Max-", bx(0.3, 0.1))],
            [("Planck", bx(0.1, 0.14))],
        ]
    )
    assert word_texts(merge_hyphenated(r)) == ["Herr", "Max-Planck"]


def test_last_line_without_next_line_unchanged():
    r = make_result([[("Das", bx(0.1, 0.1)), ("Vorstel-", bx(0.3, 0.1))]])
    assert merge_hyphenated(r) == r


def test_en_dash_and_lone_hyphen_ignored():
    for tail in ["–", "—", "-", "Wort–"]:
        r = make_result(
            [
                [("Das", bx(0.1, 0.1)), (tail, bx(0.3, 0.1))],
                [("lungskraft", bx(0.1, 0.14))],
            ]
        )
        assert merge_hyphenated(r) == r, tail


def test_two_columns_do_not_merge_across_columns():
    r = make_result(
        [
            [("Das", bx(0.1, 0.1)), ("De-", bx(0.3, 0.1))],
            [("tails", bx(0.6, 0.14)), ("mehr", bx(0.8, 0.14))],
        ]
    )
    assert merge_hyphenated(r) == r


def test_picks_same_column_line_even_when_other_column_is_nearer():
    r = make_result(
        [
            [("Das", bx(0.1, 0.1)), ("De-", bx(0.3, 0.1))],
            [("tails", bx(0.6, 0.14)), ("mehr", bx(0.8, 0.14))],
            [("tails", bx(0.1, 0.17)), ("mehr", bx(0.3, 0.17))],
        ]
    )
    out = merge_hyphenated(r)
    assert out["words"][1]["text"] == "Details"
    assert out["words"][1]["boxIds"] == [1, 4]


def test_gap_over_one_and_half_line_heights_not_merged():
    r = make_result(
        [
            [("Das", bx(0.1, 0.1)), ("De-", bx(0.3, 0.1))],
            [("tails", bx(0.1, 0.3))],
        ]
    )
    assert merge_hyphenated(r) == r


def test_input_not_mutated():
    r = make_result(
        [
            [("Das", bx(0.1, 0.1)), ("Vorstel-", bx(0.3, 0.1))],
            [("lungskraft", bx(0.1, 0.14))],
        ]
    )
    before = copy.deepcopy(r)
    merge_hyphenated(r)
    assert r == before


def test_next_line_first_box_not_a_letter_not_merged():
    for first in ["|", "3"]:
        r = make_result(
            [
                [("Das", bx(0.1, 0.1)), ("De-", bx(0.3, 0.1))],
                [(first, bx(0.1, 0.14)), ("tails", bx(0.2, 0.14))],
            ]
        )
        assert merge_hyphenated(r) == r, first


def test_box_merged_at_most_once():
    r = make_result(
        [
            [("an-", bx(0.1, 0.1))],
            [("ge-", bx(0.1, 0.14))],
            [("halten", bx(0.1, 0.18))],
        ]
    )
    assert word_texts(merge_hyphenated(r)) == ["ange-", "halten"]


def test_four_reference_pairs_on_synthetic_lines():
    r = make_result(
        [
            [("war", bx(0.1, 0.10)), ("an-", bx(0.3, 0.10))],
            [("gehaltenem", bx(0.1, 0.14)), ("und", bx(0.4, 0.14)), ("auf-", bx(0.6, 0.14))],
            [("zufangen", bx(0.1, 0.18)), ("die", bx(0.4, 0.18)), ("De-", bx(0.6, 0.18))],
            [("tails", bx(0.1, 0.22)), ("seine", bx(0.4, 0.22)), ("Vorstel-", bx(0.6, 0.22))],
            [("lungskraft", bx(0.1, 0.26))],
        ]
    )
    texts = word_texts(merge_hyphenated(r))
    for expected in ["angehaltenem", "aufzufangen", "Details", "Vorstellungskraft"]:
        assert expected in texts


def test_suspended_hyphen_before_conjunction_not_merged():
    for stem, rest in [("Vor-", "und"), ("Bus-", "und"), ("Ein-", "oder"), ("Ein-", "Und")]:
        r = make_result(
            [
                [("Die", bx(0.1, 0.1)), (stem, bx(0.3, 0.1))],
                [(rest, bx(0.1, 0.14)), ("Nachteile", bx(0.3, 0.14))],
            ]
        )
        assert merge_hyphenated(r) == r, (stem, rest)


def test_first_surviving_box_far_from_line_start_not_merged():
    r = make_result(
        [
            [("Das", bx(0.1, 0.1)), ("Vorstel-", bx(0.3, 0.1))],
            [("war", bx(0.5, 0.14))],
        ]
    )
    r["lines"][1]["box"] = {"x": 0.1, "y": 0.14, "w": 0.5, "h": 0.03}  # real first box was dropped
    assert merge_hyphenated(r) == r
