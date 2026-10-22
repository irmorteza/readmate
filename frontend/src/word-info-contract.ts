// Mirrors contract/word-info.schema.json (the single source of truth).
// Unknown keys are ignored on purpose: an additive server must not break this client.
import type { SentenceKind } from "./contract";

export type { SentenceKind };

export interface WordInfoRequest {
  word: string;
  wordIndex: number;
  sentence: { kind: SentenceKind; words: string[] };
  target: "en";
}

export type Pos =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "pronoun"
  | "preposition"
  | "conjunction"
  | "article"
  | "numeral"
  | "particle"
  | "interjection"
  | "proper-noun"
  | "other";

export type ExpressionType = "collocation" | "idiom" | "verb-pattern" | "fixed-phrase";

export interface SeparableVerb {
  infinitive: string;
  wordIndexes: number[];
}

export interface Expression {
  text: string;
  meaning: string;
  type: ExpressionType;
  wordIndexes: number[];
}

export interface WordInfoMeta {
  cached: boolean;
  model: string;
  latencyMs: number;
  promptVersion: string;
  attempts: number;
  stopReasons: string[];
  outputTokens: number[];
}

export interface WordInfoResponse {
  version: 1;
  word: string;
  lemma: string;
  pos: Pos;
  phonetic: string;
  translation: string;
  senseInContext: string;
  article: "der" | "die" | "das" | null;
  plural: string | null;
  exampleDe: string;
  exampleEn: string;
  separableVerb: SeparableVerb | null;
  expression: Expression | null;
  meta: WordInfoMeta;
}

const POS: readonly unknown[] = [
  "noun", "verb", "adjective", "adverb", "pronoun", "preposition", "conjunction",
  "article", "numeral", "particle", "interjection", "proper-noun", "other",
];
const EXPRESSION_TYPES: readonly unknown[] = ["collocation", "idiom", "verb-pattern", "fixed-phrase"];
const ARTICLES: readonly unknown[] = ["der", "die", "das"];

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isString = (x: unknown): x is string => typeof x === "string";
const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

const isIndexes = (x: unknown, wordCount: number): x is number[] =>
  Array.isArray(x) &&
  x.length >= 2 &&
  x.length <= 12 &&
  x.every((i) => Number.isInteger(i) && i >= 0 && i < wordCount);

function isMeta(x: unknown): x is WordInfoMeta {
  return (
    isRecord(x) &&
    typeof x.cached === "boolean" &&
    isString(x.model) &&
    isNumber(x.latencyMs) &&
    isString(x.promptVersion) &&
    isNumber(x.attempts) &&
    Array.isArray(x.stopReasons) &&
    x.stopReasons.every(isString) &&
    Array.isArray(x.outputTokens) &&
    x.outputTokens.every(isNumber)
  );
}

export function isWordInfoResponse(x: unknown, wordCount: number): x is WordInfoResponse {
  if (!isRecord(x)) return false;
  const { separableVerb: sv, expression: ex } = x;
  return (
    x.version === 1 &&
    [x.word, x.lemma, x.phonetic, x.translation, x.senseInContext, x.exampleDe, x.exampleEn].every(isString) &&
    POS.includes(x.pos) &&
    (x.article === null || ARTICLES.includes(x.article)) &&
    (x.plural === null || isString(x.plural)) &&
    (sv === null ||
      (isRecord(sv) && isString(sv.infinitive) && isIndexes(sv.wordIndexes, wordCount))) &&
    (ex === null ||
      (isRecord(ex) &&
        isString(ex.text) &&
        isString(ex.meaning) &&
        EXPRESSION_TYPES.includes(ex.type) &&
        isIndexes(ex.wordIndexes, wordCount))) &&
    isMeta(x.meta)
  );
}
