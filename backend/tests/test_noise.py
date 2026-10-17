import copy

from helpers import bx, raw_page
from worttap.pipeline.hyphenation import merge_hyphenated
from worttap.pipeline.noise import filter_noise
from worttap.pipeline.normalize import normalize


def make(words, conf=0.99):
    """One line of (text, box[, conf]) words, normalized."""
    page = raw_page([[(t, b) for t, b, *_ in words]], conf=conf)
    for w, spec in zip(page["lines"][0]["words"], words, strict=True):
        if len(spec) == 3:
            w["conf"] = spec[2]
    return normalize(page)


def body(n=5):
    return [(f"Wort{i}", bx(0.05 + 0.1 * i, 0.1)) for i in range(n)]


def texts(r):
    return [b["raw"] for b in r["boxes"]]


def test_punctuation_only_box_removed():
    junk = [("©", bx(0.9, 0.1)), ("|", bx(0.92, 0.1)), (";", bx(0.94, 0.1)), ("“", bx(0.96, 0.1))]
    r = make(body() + junk)
    assert texts(filter_noise(r)) == texts(make(body()))


def test_digit_only_box_kept():
    r = make(body() + [("1984", bx(0.9, 0.1))])
    assert "1984" in texts(filter_noise(r))


def test_low_confidence_removed():
    r = make(body() + [("low", bx(0.9, 0.1), 0.39), ("edge", bx(0.95, 0.1), 0.40)])
    out = texts(filter_noise(r))
    assert "low" not in out and "edge" in out


def test_height_outliers_removed():
    r = make(body() + [("tiny", bx(0.9, 0.1, h=0.01)), ("huge", bx(0.95, 0.1, h=0.09))])
    out = texts(filter_noise(r))
    assert "tiny" not in out and "huge" not in out and len(out) == 5


def test_height_exactly_at_limits_kept():
    r = make(body() + [("lo", bx(0.9, 0.1, h=0.012)), ("hi", bx(0.95, 0.1, h=0.075))])
    out = texts(filter_noise(r))
    assert "lo" in out and "hi" in out


def test_word_removed_when_all_boxes_removed():
    out = filter_noise(make(body() + [("|", bx(0.9, 0.1))]))
    assert len(out["words"]) == 5
    assert all(w["boxIds"] for w in out["words"])


def test_merged_word_survives_with_remaining_box():
    page = raw_page(
        [
            [("Das", bx(0.1, 0.1)), ("Vorstel-", bx(0.3, 0.1))],
            [("lungskraft", bx(0.1, 0.14))],
        ]
    )
    page["lines"][1]["words"][0]["conf"] = 0.2
    out = filter_noise(merge_hyphenated(normalize(page)))
    merged = [w for w in out["words"] if w["text"] == "Vorstellungskraft"]
    assert len(merged) == 1 and merged[0]["boxIds"] == [1]
    assert merged[0]["lineIds"] == [0]


def test_emptied_line_removed():
    page = raw_page([[("Wort", bx(0.1, 0.1)), ("Zwei", bx(0.3, 0.1))], [("|", bx(0.1, 0.14))]])
    out = filter_noise(normalize(page))
    assert [line["id"] for line in out["lines"]] == [0]


def test_ids_not_renumbered_and_line_box_ids_pruned():
    out = filter_noise(make([("|", bx(0.0, 0.1))] + body()))
    assert [b["id"] for b in out["boxes"]] == [1, 2, 3, 4, 5]
    assert out["lines"][0]["boxIds"] == [1, 2, 3, 4, 5]


def test_empty_result_returns_empty():
    r = normalize({"lines": []})
    assert filter_noise(r) == r


def test_input_not_mutated():
    r = make(body() + [("|", bx(0.9, 0.1))])
    before = copy.deepcopy(r)
    filter_noise(r)
    assert r == before
