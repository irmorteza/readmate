"""Registry of word-info engines. Provider modules are imported lazily by name."""

import importlib
from typing import NamedTuple


class EngineSpec(NamedTuple):
    module: str
    cls: str
    default_model: str


WORD_INFO_ENGINES: dict[str, EngineSpec] = {
    "anthropic": EngineSpec(
        "readmate.engines.anthropic_word_info", "AnthropicWordInfoEngine", "claude-haiku-5-5"
    ),
    "fake": EngineSpec("readmate.engines.fake_word_info", "FakeWordInfoEngine", "fake"),
}


def load_engine_class(name: str) -> type:
    spec = WORD_INFO_ENGINES.get(name)
    if spec is None:
        raise ValueError(f"unknown word-info engine: {name}")
    return getattr(importlib.import_module(spec.module), spec.cls)
