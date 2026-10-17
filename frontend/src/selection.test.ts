import { describe, expect, it, vi } from "vitest";
import { createSelection } from "./selection";
import { gappedResult } from "./test-fixtures";

describe("createSelection", () => {
  it("emits onWordSelected with word, boxes and the texts of all its lines", () => {
    const onWordSelected = vi.fn();
    const sel = createSelection(gappedResult, onWordSelected);
    sel.select(2);
    expect(onWordSelected).toHaveBeenCalledTimes(1);
    const event = onWordSelected.mock.calls[0][0];
    expect(event.word.text).toBe("Vorstellungskraft");
    expect(event.boxes.map((b: { id: number }) => b.id)).toEqual([3, 12]);
    expect(event.lineTexts).toEqual(["Das Vorstel- war", "lungskraft groß"]);
  });

  it("looks ids up by value, never as array indexes (ids have gaps)", () => {
    const sel = createSelection(gappedResult, () => {});
    sel.select(9); // array index 9 does not exist; the word with id 9 is words[1]
    expect(sel.current()).toBe(9);
  });

  it("ignores an unknown word id", () => {
    const onWordSelected = vi.fn();
    const sel = createSelection(gappedResult, onWordSelected);
    sel.select(1);
    expect(sel.current()).toBeNull();
    expect(onWordSelected).not.toHaveBeenCalled();
  });

  it("notifies subscribers on select and clear, and supports unsubscribe", () => {
    const sel = createSelection(gappedResult, () => {});
    const seen: Array<number | null> = [];
    const off = sel.subscribe((id) => seen.push(id));
    sel.select(2);
    sel.clear();
    off();
    sel.select(9);
    expect(seen).toEqual([2, null]);
  });
});
