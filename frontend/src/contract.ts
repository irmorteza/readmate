// Mirrors contract/ocr-result.schema.json (the single source of truth).

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

export interface OcrResult {
  version: 1;
  engine: string;
  lines: OcrLine[];
  boxes: OcrBox[];
  words: OcrWord[];
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

export function isOcrResult(x: unknown): x is OcrResult {
  return (
    isRecord(x) &&
    x.version === 1 &&
    typeof x.engine === "string" &&
    Array.isArray(x.lines) &&
    x.lines.every(isLine) &&
    Array.isArray(x.boxes) &&
    x.boxes.every(isBoxEntry) &&
    Array.isArray(x.words) &&
    x.words.every(isWord)
  );
}
