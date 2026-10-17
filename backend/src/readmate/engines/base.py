from typing import Protocol

from readmate.pipeline.types import RawPage


class OcrEngine(Protocol):
    name: str

    def recognize(self, image_bytes: bytes) -> RawPage: ...
