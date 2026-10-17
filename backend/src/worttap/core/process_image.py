from worttap.engines.base import OcrEngine
from worttap.pipeline.hyphenation import merge_hyphenated
from worttap.pipeline.noise import filter_noise
from worttap.pipeline.normalize import normalize
from worttap.pipeline.types import OcrResult


def process_image(image_bytes: bytes, engine: OcrEngine) -> OcrResult:
    result = merge_hyphenated(filter_noise(normalize(engine.recognize(image_bytes))))
    result["engine"] = engine.name
    return result
