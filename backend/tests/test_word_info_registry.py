import sys

import pytest

from readmate.engines.fake_word_info import FakeWordInfoEngine
from readmate.engines.word_info_registry import WORD_INFO_ENGINES, load_engine_class


def test_load_fake_engine_class():
    assert load_engine_class("fake") is FakeWordInfoEngine


def test_unknown_engine_raises_value_error():
    with pytest.raises(ValueError):
        load_engine_class("nope")


def test_import_error_propagates(monkeypatch):
    monkeypatch.setitem(sys.modules, "readmate.engines.fake_word_info", None)
    with pytest.raises(ImportError):
        load_engine_class("fake")


def test_anthropic_spec():
    spec = WORD_INFO_ENGINES["anthropic"]
    assert spec.module == "readmate.engines.anthropic_word_info"
    assert spec.cls == "AnthropicWordInfoEngine"
    assert spec.default_model == "claude-haiku-5-5"
