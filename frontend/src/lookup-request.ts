import type { WordSelectedEvent } from "./selection";

export interface LookupRequest {
  word: string;
  context: string;
}

export type ContextSource = "sentence" | "lines";

/** The sentence is the best context; without one, fall back to the word's lines. */
export function buildLookupRequest(event: WordSelectedEvent): {
  request: LookupRequest;
  contextSource: ContextSource;
} {
  const word = event.word.text;
  return event.sentence
    ? { request: { word, context: event.sentence.text }, contextSource: "sentence" }
    : { request: { word, context: event.lineTexts.join(" ") }, contextSource: "lines" };
}
