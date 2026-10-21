import type { OcrResult } from "./contract";
import { buildDebugSnapshot, type LookupOutcome } from "./debug-snapshot";
import { buildLookupRequest } from "./lookup-request";
import { createSelection, type WordSelectedEvent } from "./selection";

export function snap(result: OcrResult, wordId: number, outcome: LookupOutcome = { status: "pending" }) {
  let event!: WordSelectedEvent;
  createSelection(result, (e) => (event = e)).select(wordId);
  const { request, contextSource } = buildLookupRequest(event);
  return buildDebugSnapshot({ build: "abc1234", result, event, request, contextSource, source: "stub", outcome });
}

/** jsdom has no clipboard; define or remove one on the real navigator object. */
export function setClipboard(value: { writeText(text: string): Promise<void> } | undefined) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}
