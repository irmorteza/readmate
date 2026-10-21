import logging

from readmate.engines.base import OcrEngine
from readmate.pipeline.hyphenation import merge_hyphenated
from readmate.pipeline.noise import filter_noise
from readmate.pipeline.normalize import normalize
from readmate.pipeline.sentences import fallback_sentences, segment_sentences
from readmate.pipeline.types import OcrResult

logger = logging.getLogger("readmate")


def process_image(image_bytes: bytes, engine: OcrEngine) -> OcrResult:
    result = merge_hyphenated(filter_noise(normalize(engine.recognize(image_bytes))))
    result["engine"] = engine.name
    # Sentence grouping is an extra: whatever goes wrong here must not fail the OCR response.
    try:
        result["sentences"] = segment_sentences(result)
    except Exception:
        logger.exception("sentence segmentation failed")
        try:
            result["sentences"] = fallback_sentences(result)
        except Exception:
            logger.exception("sentence fallback failed")
            result["sentences"] = []
    return result
