import { sentencesIgnored, type OcrResult } from "./contract";
import type { ContextSource, LookupRequest } from "./lookup-request";
import type { SelectedSentence, WordSelectedEvent } from "./selection";

export type SentenceStatus = "ok" | "absent" | "ignored" | "not-found";

export type LookupOutcome =
  | { status: "pending" }
  | { status: "ok"; response: Record<string, unknown>; meta?: Record<string, unknown> | null }
  | { status: "error"; error: string };

/** Exactly what the debug panel's Copy JSON copies. Built from plain data only: no token, no headers. */
export interface DebugSnapshot {
  format: "readmate-debug/1";
  build: string;
  engine: string;
  word: { id: number; text: string };
  sentenceStatus: SentenceStatus;
  sentence: SelectedSentence | null;
  lineTexts: string[];
  lookup: {
    request: LookupRequest;
    contextSource: ContextSource;
    contextLength: number;
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
  request: LookupRequest;
  contextSource: ContextSource;
  source: string;
  outcome: LookupOutcome;
}): DebugSnapshot {
  const { result, event, request, outcome } = input;
  return {
    format: "readmate-debug/1",
    build: input.build,
    engine: result.engine,
    word: { id: event.word.id, text: event.word.text },
    sentenceStatus: sentenceStatus(result, event),
    sentence: event.sentence ?? null,
    lineTexts: event.lineTexts,
    lookup: {
      request,
      contextSource: input.contextSource,
      contextLength: request.context.length,
      status: outcome.status,
      source: input.source,
      response: outcome.status === "ok" ? outcome.response : null,
      meta: outcome.status === "ok" ? (outcome.meta ?? null) : null,
      error: outcome.status === "error" ? outcome.error : null,
    },
  };
}
