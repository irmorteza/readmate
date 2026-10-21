from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

from readmate.pipeline.types import RawPage


class OcrEngine(Protocol):
    name: str

    def recognize(self, image_bytes: bytes) -> RawPage: ...


@dataclass(frozen=True)
class EngineReply:
    text: str
    stop_reason: str
    input_tokens: int
    output_tokens: int


class EngineError(Exception):
    """An engine call failed. `detail` is a safe class or status string, never provider text."""

    def __init__(self, kind: Literal["transient", "busy", "fatal"], detail: str):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail


class WordInfoEngine(Protocol):
    name: str
    model: str

    def explain(self, system: str, user: str, schema: dict, timeout_s: float) -> EngineReply: ...

    @classmethod
    def from_env(cls, env: Mapping[str, str], model: str) -> "WordInfoEngine":
        """Read the engine's own provider settings; may raise SecretUnavailable."""
        ...
