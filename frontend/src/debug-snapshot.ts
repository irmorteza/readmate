import { sentencesIgnored, type OcrResult } from "./contract";
import type { BuiltLookup, ContextSource } from "./lookup-request";
import type { SelectedSentence, WordSelectedEvent } from "./selection";
import type { WordInfo } from "./translation";
import type { WordInfoRequest } from "./word-info-contract";

export type SentenceStatus = "ok" | "absent" | "ignored" | "not-found";

export type LookupOutcome =
  | { status: "pending" }
  | { status: "ok"; response: Record<string, unknown>; meta?: Record<string, unknown> | null }
  | { status: "error"; error: string };

/** An ok outcome from a lookup result: `meta` moves out of the response into its own field. */
export function okOutcome(info: WordInfo): LookupOutcome {
  const { meta, ...response } = info;
  return { status: "ok", response, meta: meta ?? null };
}

/** Exactly what the debug panel's Copy JSON copies. Built from plain data only: no token, no headers. */
export interface DebugSnapshot {
  format: "readmate-debug/2";
  build: string;
  engine: string;
  word: { id: number; text: string };
  sentenceStatus: SentenceStatus;
  sentence: SelectedSentence | null;
  lineTexts: string[];
  lookup: {
    request: WordInfoRequest;
    contextSource: ContextSource;
    contextLength: number;
    windowed: boolean;
    target: string;
    status: "pending" | "ok" | "error";
    source: string;
    response: Record<string, unknown> | null;
    meta: Record<string, unknown> | null;
    error: string | null;
  };
}

function sentenceStatus(result: OcrResult, event: WordSelectedEvent): SentenceStatus {
  if (event.sentence) return "ok";
  if (sentencesIgnored(result)) return "ignored";
  if (result.sentences === undefined) return "absent";
  return "not-found";
}

export function buildDebugSnapshot(input: {
  build: string;
  result: OcrResult;
  event: WordSelectedEvent;
  lookup: BuiltLookup;
  source: string;
  outcome: LookupOutcome;
}): DebugSnapshot {
  const { result, event, lookup, outcome } = input;
  return {
    format: "readmate-debug/2",
    build: input.build,
    engine: result.engine,
    word: { id: event.word.id, text: event.word.text },
    sentenceStatus: sentenceStatus(result, event),
    sentence: event.sentence ?? null,
    lineTexts: event.lineTexts,
    lookup: {
      request: lookup.request,
      contextSource: lookup.contextSource,
      contextLength: lookup.context.length,
      windowed: lookup.windowed,
      target: lookup.request.target,
      status: outcome.status,
      source: input.source,
      response: outcome.status === "ok" ? outcome.response : null,
      meta: outcome.status === "ok" ? (outcome.meta ?? null) : null,
      error: outcome.status === "error" ? outcome.error : null,
    },
  };
}
