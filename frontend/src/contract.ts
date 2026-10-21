// Mirrors contract/ocr-result.schema.json (the single source of truth).
// One deliberate difference: a malformed optional `sentences` field is dropped by
// parseOcrResult instead of rejecting the whole result, so it can never break word display.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrLine {
  id: number;
  text: string;
  box: Box;
  boxIds: number[];
}

export interface OcrBox {
  id: number;
  raw: string;
  lineId: number;
  conf: number;
  box: Box;
  wordId: number;
}

export interface OcrWord {
  id: number;
  text: string;
  boxIds: number[];
  lineIds: number[];
}

export type SentenceKind = "sentence" | "fragment" | "incomplete";

export interface OcrSentence {
  id: number;
  kind: SentenceKind;
  wordIds: number[];
  text: string;
}

export interface OcrResult {
  version: 1;
  engine: string;
  lines: OcrLine[];
  boxes: OcrBox[];
  words: OcrWord[];
  sentences?: OcrSentence[];
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const isId = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
const isUnit = (x: unknown): x is number => typeof x === "number" && x >= 0 && x <= 1;
const isIdList = (x: unknown): x is number[] => Array.isArray(x) && x.every(isId);

function isBox(x: unknown): x is Box {
  return isRecord(x) && isUnit(x.x) && isUnit(x.y) && isUnit(x.w) && isUnit(x.h);
}

function isLine(x: unknown): x is OcrLine {
  return (
    isRecord(x) && isId(x.id) && typeof x.text === "string" && isBox(x.box) && isIdList(x.boxIds)
  );
}

function isBoxEntry(x: unknown): x is OcrBox {
  return (
    isRecord(x) &&
    isId(x.id) &&
    typeof x.raw === "string" &&
    isId(x.lineId) &&
    isUnit(x.conf) &&
    isBox(x.box) &&
    isId(x.wordId)
  );
}

function isWord(x: unknown): x is OcrWord {
  return (
    isRecord(x) &&
    isId(x.id) &&
    typeof x.text === "string" &&
    isIdList(x.boxIds) &&
    isIdList(x.lineIds)
  );
}

const SENTENCE_KINDS: readonly unknown[] = ["sentence", "fragment", "incomplete"];

function isSentence(x: unknown, wordIds: Set<number>): x is OcrSentence {
  return (
    isRecord(x) &&
    isId(x.id) &&
    SENTENCE_KINDS.includes(x.kind) &&
    isIdList(x.wordIds) &&
    x.wordIds.length > 0 &&
    x.wordIds.every((id) => wordIds.has(id)) &&
    typeof x.text === "string"
  );
}

export function isOcrResult(x: unknown): x is OcrResult {
  if (
    !(
      isRecord(x) &&
      x.version === 1 &&
      typeof x.engine === "string" &&
      Array.isArray(x.lines) &&
      x.lines.every(isLine) &&
      Array.isArray(x.boxes) &&
      x.boxes.every(isBoxEntry) &&
      Array.isArray(x.words) &&
      x.words.every(isWord)
    )
  ) {
    return false;
  }
  if (!("sentences" in x)) return true;
  const ids = new Set((x.words as OcrWord[]).map((w) => w.id));
  return Array.isArray(x.sentences) && x.sentences.every((s) => isSentence(s, ids));
}

const ignored = new WeakSet<OcrResult>();

/** Like isOcrResult, but drops a malformed `sentences` field instead of rejecting the result. */
export function parseOcrResult(x: unknown): OcrResult | null {
  if (isOcrResult(x)) return x;
  if (isRecord(x) && "sentences" in x) {
    const { sentences: _, ...rest } = x;
    if (isOcrResult(rest)) {
      console.warn("readmate: ignoring malformed sentences");
      ignored.add(rest);
      return rest;
    }
  }
  return null;
}

/** True when parseOcrResult dropped a malformed `sentences` field from this result. */
export function sentencesIgnored(result: OcrResult): boolean {
  return ignored.has(result);
}
