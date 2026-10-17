"""Data shapes shared by the pipeline. Keys use the JSON wire names (camelCase)."""

from typing import Literal, TypedDict


class Box(TypedDict):
    x: float
    y: float
    w: float
    h: float


class RawWord(TypedDict):
    text: str
    conf: float
    box: Box


class RawLine(TypedDict):
    text: str
    conf: float
    box: Box
    words: list[RawWord]


class RawPage(TypedDict):
    lines: list[RawLine]


class OcrLine(TypedDict):
    id: int
    text: str
    box: Box
    boxIds: list[int]


class OcrBox(TypedDict):
    id: int
    raw: str
    lineId: int
    conf: float
    box: Box
    wordId: int


class OcrWord(TypedDict):
    id: int
    text: str
    boxIds: list[int]
    lineIds: list[int]


class OcrResult(TypedDict):
    version: Literal[1]
    engine: str
    lines: list[OcrLine]
    boxes: list[OcrBox]
    words: list[OcrWord]
