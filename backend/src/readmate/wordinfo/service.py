"""Word-info lookup: cache, daily cap, retry, deadline and response meta.

Provider-neutral: engines are reached only through the registry and the
WordInfoEngine protocol. Words, sentences and responses are never logged.
"""

import logging
import time
from collections.abc import Callable, Mapping

from readmate.engines.base import EngineError, WordInfoEngine
from readmate.engines.word_info_registry import WORD_INFO_ENGINES, load_engine_class
from readmate.wordinfo.prompt import (
    MODEL_OUTPUT_SCHEMA,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    build_user_message,
)
from readmate.wordinfo.request import WordInfoRequest, cache_key
from readmate.wordinfo.secrets import SecretUnavailable
from readmate.wordinfo.store import (
    CacheStore,
    DailyLimitReached,
    DynamoStore,
    LruCache,
    MemoryStore,
    StoreUnavailable,
)
from readmate.wordinfo.validate import InvalidModelOutput, validate_model_output

logger = logging.getLogger("readmate")

RETRY_MIN_REMAINING_MS = 9_500
ENGINE_TIMEOUT_S = 8.0
MAX_ATTEMPTS = 2


def _not_configured() -> "WordInfoError":
    return WordInfoError(503, "NOT_CONFIGURED", "Word lookup is not configured.")


class WordInfoError(Exception):
    def __init__(self, status: int, code: str, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra


class WordInfoService:
    def __init__(
        self,
        engine_factory: Callable[[], WordInfoEngine],
        store: CacheStore,
        model: str,
        daily_cap: int,
        lru: LruCache | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._factory = engine_factory
        self.store = store
        self.model = model
        self.daily_cap = daily_cap
        self._lru = lru if lru is not None else LruCache()
        self._clock = clock
        self._engine: WordInfoEngine | None = None

    def _meta(self, start: float, attempts: int, stops: list, tokens: list) -> dict:
        latency = round((self._clock() - start) * 1000)
        return {
            "cached": attempts == 0,
            "model": self.model,
            "latencyMs": latency,
            "promptVersion": PROMPT_VERSION,
            "attempts": attempts,
            "stopReasons": list(stops),
            "outputTokens": list(tokens),
        }

    def _get_engine(self) -> WordInfoEngine:
        if self._engine is None:
            try:
                self._engine = self._factory()
            except ImportError:
                logger.exception("word-info engine import failed")
                raise _not_configured() from None
            except SecretUnavailable:
                raise _not_configured() from None
        return self._engine

    def lookup(self, req: WordInfoRequest, remaining_ms: Callable[[], int]) -> dict:
        start = self._clock()
        stops: list[str] = []
        tokens: list[int] = []
        st = {"attempts": 0}
        hit = None
        try:
            key = cache_key(req, PROMPT_VERSION, self.model)
            hit = self._lru.get(key)
            if hit is None:
                try:
                    hit = self.store.get(key)
                except StoreUnavailable:
                    logger.warning("word-info store unavailable on get; treating as miss")
                    hit = None
            if hit is not None:
                meta = self._meta(start, 0, [], [])
                st["ms"] = meta["latencyMs"]
                return {**hit, "meta": meta}

            engine = self._get_engine()
            body = self._run(engine, req, remaining_ms, stops, tokens, st)
            try:
                self.store.put(key, body, self.model, PROMPT_VERSION)
            except StoreUnavailable:
                logger.warning("word-info store unavailable on put; answer not cached")
            self._lru.put(key, body)
            meta = self._meta(start, st["attempts"], stops, tokens)
            st["ms"] = meta["latencyMs"]
            return {**body, "meta": meta}
        finally:
            logger.info(
                "word_info cached=%s attempts=%d stops=%s out_tokens=%s ms=%d",
                st["attempts"] == 0 and hit is not None,
                st["attempts"],
                ",".join(stops),
                ",".join(str(t) for t in tokens),
                st["ms"] if "ms" in st else round((self._clock() - start) * 1000),
            )

    def _run(self, engine, req, remaining_ms, stops, tokens, st) -> dict:
        user = build_user_message(req)
        last_kind = "invalid"
        while st["attempts"] < MAX_ATTEMPTS:
            try:
                self.store.increment_daily(self.daily_cap)
            except DailyLimitReached:
                raise WordInfoError(429, "DAILY_LIMIT", "Daily lookup limit reached.") from None
            except StoreUnavailable:
                logger.warning("word-info store unavailable on counter")
                raise _not_configured() from None
            st["attempts"] += 1
            try:
                reply = engine.explain(SYSTEM_PROMPT, user, MODEL_OUTPUT_SCHEMA, ENGINE_TIMEOUT_S)
                stops.append(reply.stop_reason)
                tokens.append(reply.output_tokens)
                return validate_model_output(reply.text, reply.stop_reason, req)
            except EngineError as err:
                last_kind = err.kind
            except InvalidModelOutput:
                last_kind = "invalid"
            if last_kind == "fatal":
                break
            if st["attempts"] >= MAX_ATTEMPTS or remaining_ms() < RETRY_MIN_REMAINING_MS:
                break
        if last_kind == "busy":
            raise WordInfoError(429, "BUSY", "The lookup service is busy. Try again shortly.")
        extra = {"stopReasons": list(stops), "outputTokens": list(tokens)} if stops else None
        raise WordInfoError(502, "LOOKUP_FAILED", "Lookup failed.", extra)


def service_from_env(env: Mapping[str, str]) -> WordInfoService:
    name = env.get("WORD_INFO_ENGINE", "anthropic")
    spec = WORD_INFO_ENGINES.get(name)
    if spec is None:
        raise ValueError(f"unknown word-info engine: {name}")
    model = env.get("WORD_INFO_MODEL", spec.default_model)
    table = env.get("WORD_INFO_TABLE")
    store: CacheStore = DynamoStore(table) if table else MemoryStore()
    cap = int(env.get("WORD_INFO_DAILY_CAP", "500"))
    return WordInfoService(
        lambda: load_engine_class(name).from_env(env, model), store, model, cap, LruCache()
    )
