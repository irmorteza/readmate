from readmate.engines.base import OcrEngine
from readmate.pipeline.hyphenation import merge_hyphenated
from readmate.pipeline.noise import filter_noise
from readmate.pipeline.normalize import normalize
from readmate.pipeline.types import OcrResult


def process_image(image_bytes: bytes, engine: OcrEngine) -> OcrResult:
    result = merge_hyphenated(filter_noise(normalize(engine.recognize(image_bytes))))
    result["engine"] = engine.name
    return result
