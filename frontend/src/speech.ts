type SpeechHost = {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

export const SPEECH_UNSUPPORTED_MESSAGE = "Audio pronunciation is not supported in this browser";

/**
 * Speaks `text` with the browser's speech synthesis, cancelling any running utterance first.
 * Returns false (never throws) when there is nothing to say or speech is unavailable or fails.
 */
export function speak(text: string, lang = "de-DE", win: SpeechHost = window): boolean {
  if (!text.trim()) return false;
  const synthesis = win.speechSynthesis;
  const Utterance = win.SpeechSynthesisUtterance;
  if (!synthesis || !Utterance) return false;
  try {
    synthesis.cancel();
    const utterance = new Utterance(text);
    utterance.lang = lang;
    utterance.rate = 0.85;
    synthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
