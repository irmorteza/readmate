import type { OcrResult } from "./contract";

const box = (x: number, y: number, w = 0.1, h = 0.03) => ({ x, y, w, h });

/** Ids have gaps, as filter_noise leaves them: boxes [3,7,12], words [2,9], lines [1,5]. */
export const gappedResult: OcrResult = {
  version: 1,
  engine: "fake",
  lines: [
    { id: 1, text: "Das Vorstel- war", box: box(0.1, 0.1, 0.5), boxIds: [3, 7] },
    { id: 5, text: "lungskraft groß", box: box(0.1, 0.14, 0.5), boxIds: [12] },
  ],
  boxes: [
    { id: 3, raw: "Vorstel-", lineId: 1, conf: 0.99, box: box(0.3, 0.1), wordId: 2 },
    { id: 7, raw: "war", lineId: 1, conf: 0.99, box: box(0.5, 0.1), wordId: 9 },
    { id: 12, raw: "lungskraft", lineId: 5, conf: 0.99, box: box(0.1, 0.14), wordId: 2 },
  ],
  words: [
    { id: 2, text: "Vorstellungskraft", boxIds: [3, 12], lineIds: [1, 5] },
    { id: 9, text: "war", boxIds: [7], lineIds: [1] },
  ],
};

export const sentenceResult: OcrResult = {
  ...gappedResult,
  sentences: [{ id: 0, kind: "sentence", wordIds: [2, 9], text: "Vorstellungskraft war" }],
};

export const emptyResult: OcrResult = {
  version: 1,
  engine: "fake",
  lines: [],
  boxes: [],
  words: [],
};
