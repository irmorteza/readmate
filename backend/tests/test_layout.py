from pathlib import Path

from helpers import bx, raw_page, text_line
from readmate.engines.fake import FakeEngine
from readmate.pipeline.hyphenation import merge_hyphenated
from readmate.pipeline.layout import analyze_layout
from readmate.pipeline.noise import filter_noise
from readmate.pipeline.normalize import normalize

FIXTURES = Path(__file__).parent / "fixtures"
FULL = "eins zwei drei vier fünf"


def prepared(page):
    return merge_hyphenated(filter_noise(normalize(page)))


def page_of(*lines):
    return raw_page(list(lines))


def test_large_gap_is_boundary():
    r = prepared(page_of(text_line(FULL, 0.10), text_line(FULL, 0.25)))
    assert analyze_layout(r).boundary_after == {0}


def _four(short_right=0.4, indent=None):
    return page_of(
        text_line(FULL, 0.10),
        text_line(FULL, 0.14, right=short_right),
        text_line(FULL, 0.18, x=indent or 0.1),
        text_line(FULL, 0.22),
    )


def test_short_line_then_indented_line_is_boundary():
    layout = analyze_layout(prepared(_four(indent=0.14)))
    assert 1 in layout.boundary_after


def test_short_line_alone_is_not_boundary():
    layout = analyze_layout(prepared(_four()))
    assert layout.boundary_after == set()
    assert 1 in layout.short


def test_hyphen_line_is_never_boundary():
    r = prepared(
        page_of(
            text_line(FULL, 0.10),
            text_line(FULL, 0.14),
            text_line("eins zwei Vor-", 0.18, right=0.4),
            text_line("stellung hier", 0.30),
        )
    )
    assert analyze_layout(r).boundary_after == set()


def test_skewed_page_has_no_false_indents():
    lines = [text_line(FULL, 0.10 + 0.04 * i, x=0.07 - 0.04 * i / 11) for i in range(12)]
    layout = analyze_layout(prepared(page_of(*lines)))
    assert layout.boundary_after == set()
    assert layout.short == set()


def test_book_fixture_layout():
    r = prepared(FakeEngine(FIXTURES / "book_page.textract.json").recognize(b""))
    layout = analyze_layout(r)
    assert layout.boundary_after == {11, 17, 21}
    assert {11, 17, 21, 22} <= layout.short


def test_single_line_column_uses_own_left_edge():
    layout = analyze_layout(prepared(page_of(text_line(FULL, 0.10))))
    assert layout.short == set()
    assert layout.boundary_after == set()


def test_zero_width_box_does_not_divide_by_zero():
    r = prepared(
        page_of(
            text_line(FULL, 0.10),
            [("x", bx(0.5, 0.14, w=0))],
            text_line(FULL, 0.18),
            text_line(FULL, 0.22),
        )
    )
    analyze_layout(r)


def test_lines_out_of_vertical_order():
    r = prepared(page_of(text_line(FULL, 0.18), text_line(FULL, 0.14), text_line(FULL, 0.10)))
    assert analyze_layout(r).boundary_after == set()
