import { expect, it } from "vitest";
import { buildLookupRequest } from "./lookup-request";
import type { SelectedSentence, WordSelectedEvent } from "./selection";
import { gappedResult } from "./test-fixtures";

const event = (sentence?: SelectedSentence): WordSelectedEvent => ({
  word: gappedResult.words[0], boxes: [], lineTexts: ["Das Vorstel- war", "lungskraft groß"], sentence,
});

it("uses the sentence text as context when there is a sentence", () => {
  expect(buildLookupRequest(event({ id: 0, kind: "sentence", text: "Vorstellungskraft war", wordIds: [2, 9], wordIndex: 0 })))
    .toEqual({ request: { word: "Vorstellungskraft", context: "Vorstellungskraft war" }, contextSource: "sentence" });
});

it("falls back to the joined line texts without a sentence", () => {
  expect(buildLookupRequest(event()))
    .toEqual({ request: { word: "Vorstellungskraft", context: "Das Vorstel- war lungskraft groß" }, contextSource: "lines" });
});
