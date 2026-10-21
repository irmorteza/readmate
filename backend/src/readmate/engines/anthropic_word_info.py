"""Anthropic word-info engine. The only module in the package that imports `anthropic`."""

from collections.abc import Mapping

import anthropic

from readmate.engines.base import EngineError, EngineReply
from readmate.wordinfo.secrets import SecretUnavailable, get_api_key


class AnthropicWordInfoEngine:
    name = "anthropic"
    MAX_TOKENS = 1500

    def __init__(self, api_key: str, model: str, effort: str = "low", client: object | None = None):
        self.model = model
        self.effort = effort
        if client is None:
            client = anthropic.Anthropic(
                api_key=api_key,
                max_retries=0,
                timeout=anthropic.Timeout(8.0, connect=2.0),
            )
        self._client = client

    @classmethod
    def from_env(cls, env: Mapping[str, str], model: str) -> "AnthropicWordInfoEngine":
        param = env.get("ANTHROPIC_API_KEY_PARAM")
        if not param:
            raise SecretUnavailable
        return cls(get_api_key(param), model, env.get("WORD_INFO_EFFORT", "low"))

    def explain(self, system: str, user: str, schema: dict, timeout_s: float) -> EngineReply:
        try:
            message = self._client.messages.create(
                model=self.model,
                max_tokens=self.MAX_TOKENS,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={
                    "effort": self.effort,
                    "format": {"type": "json_schema", "schema": schema},
                },
                timeout=timeout_s,
            )
        except anthropic.APIConnectionError as e:
            raise EngineError("transient", _detail(e)) from None
        except anthropic.RateLimitError as e:
            raise EngineError("busy", _detail(e)) from None
        except anthropic.APIStatusError as e:
            status = e.status_code
            if status == 529:
                kind = "busy"
            elif status >= 500:
                kind = "transient"
            else:
                kind = "fatal"
            raise EngineError(kind, _detail(e)) from None
        text = next((b.text for b in message.content if b.type == "text"), "")
        return EngineReply(
            text, message.stop_reason, message.usage.input_tokens, message.usage.output_tokens
        )


def _detail(e: Exception) -> str:
    return f"{type(e).__name__}:{getattr(e, 'status_code', '')}"
