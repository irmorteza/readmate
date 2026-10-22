import { expect, it } from "vitest";
import example from "../../contract/word-info.example.json";
import schema from "../../contract/word-info.schema.json";
import { isWordInfoResponse } from "./word-info-contract";

const words = example.request.sentence.words.length;
const clone = () => structuredClone(example.response) as Record<string, any>;

it("accepts the golden response", () => expect(isWordInfoResponse(example.response, words)).toBe(true));
// The old backend omits exampleTranslation, so the client treats it as optional.
const CLIENT_OPTIONAL = new Set(["exampleTranslation"]);
it("rejects a copy missing any required key", () => {
  for (const key of schema.$defs.response.required) {
    if (CLIENT_OPTIONAL.has(key)) continue;
    const c = clone();
    delete c[key];
    expect(isWordInfoResponse(c, words), key).toBe(false);
  }
});
it("accepts a response without exampleTranslation (old backend)", () => {
  const c = clone();
  delete c.exampleTranslation;
  expect(isWordInfoResponse(c, words)).toBe(true);
});
it("accepts a string exampleTranslation", () => {
  const c = clone();
  c.exampleTranslation = "این یک مثال است.";
  expect(isWordInfoResponse(c, words)).toBe(true);
});
it.each<[string, (c: Record<string, any>) => void]>([
  ["bad pos", (c) => (c.pos = "Verb")],
  ["bad article", (c) => (c.article = "den")],
  ["index out of range", (c) => (c.separableVerb = { infinitive: "x", wordIndexes: [1, words] })],
  ["one index", (c) => (c.separableVerb = { infinitive: "x", wordIndexes: [1] })],
  ["non-integer index", (c) => (c.separableVerb = { infinitive: "x", wordIndexes: [1, 2.5] })],
  ["bad expression type", (c) => (c.expression = { text: "a", meaning: "b", type: "proverb", wordIndexes: [0, 1] })],
  ["meta missing", (c) => delete c.meta],
  ["translation not a string", (c) => (c.translation = 5)],
  ["exampleTranslation not a string", (c) => (c.exampleTranslation = 5)],
])("rejects %s", (_, breakIt) => {
  const c = clone();
  breakIt(c);
  expect(isWordInfoResponse(c, words)).toBe(false);
});
it("ignores unknown keys", () => expect(isWordInfoResponse({ ...clone(), future: 1 }, words)).toBe(true));
it("rejects non-objects", () => {
  for (const x of [null, [], "x", 1]) expect(isWordInfoResponse(x, words)).toBe(false);
});
it("request keys match the schema", () =>
  expect(Object.keys(example.request).sort()).toEqual([...schema.$defs.request.required].sort()));
