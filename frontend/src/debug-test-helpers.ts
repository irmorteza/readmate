import type { OcrResult } from "./contract";
import { buildDebugSnapshot, type LookupOutcome } from "./debug-snapshot";
import { buildLookup } from "./lookup-request";
import { createSelection, type WordSelectedEvent } from "./selection";

export function snap(result: OcrResult, wordId: number, outcome: LookupOutcome = { status: "pending" }) {
  let event!: WordSelectedEvent;
  createSelection(result, (e) => (event = e)).select(wordId);
  const lookup = buildLookup(event, result);
  return buildDebugSnapshot({ build: "abc1234", result, event, lookup, source: "stub", outcome });
}

/** jsdom has no clipboard; define or remove one on the real navigator object. */
export function setClipboard(value: { writeText(text: string): Promise<void> } | undefined) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}
