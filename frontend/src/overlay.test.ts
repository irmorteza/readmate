import { beforeEach, describe, expect, it } from "vitest";
import { boxToCss, renderOverlay } from "./overlay";
import { createSelection } from "./selection";
import { emptyResult, gappedResult } from "./test-fixtures";

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.replaceChildren(container);
});

const el = (id: number) => container.querySelector<HTMLElement>(`[data-box-id="${id}"]`)!;
const selectedIds = () =>
  [...container.querySelectorAll<HTMLElement>(".box.selected")].map((e) => Number(e.dataset.boxId));

function mount(result = gappedResult) {
  const selection = createSelection(result, () => {});
  const overlay = renderOverlay(container, "blob:img", result, selection);
  return { selection, overlay };
}

describe("boxToCss", () => {
  it("maps a 0-1 box to percentage strings", () => {
    expect(boxToCss({ x: 0.1, y: 0.25, w: 0.5, h: 0.05 })).toEqual({
      left: "10%",
      top: "25%",
      width: "50%",
      height: "5%",
    });
  });
});

describe("renderOverlay", () => {
  it("renders the image and one positioned element per box", () => {
    mount();
    expect(container.querySelector("img")!.getAttribute("src")).toBe("blob:img");
    expect(container.querySelectorAll(".box")).toHaveLength(3);
    expect(el(7).style.left).toBe("50%");
  });

  it("renders no boxes for an empty result", () => {
    mount(emptyResult);
    expect(container.querySelectorAll(".box")).toHaveLength(0);
  });

  it("clicking a box selects its word, resolved by id value (ids have gaps)", () => {
    const { selection } = mount();
    el(7).click();
    expect(selection.current()).toBe(9);
    expect(selectedIds()).toEqual([7]);
  });

  it("selecting a merged word highlights both of its boxes", () => {
    mount();
    el(12).click();
    expect(selectedIds()).toEqual([3, 12]);
  });

  it("clicking another word moves the highlight", () => {
    mount();
    el(3).click();
    el(7).click();
    expect(selectedIds()).toEqual([7]);
  });

  it("clicking the stage background clears the selection", () => {
    const { selection } = mount();
    el(3).click();
    container.querySelector<HTMLElement>(".overlay-stage")!.click();
    expect(selection.current()).toBeNull();
    expect(selectedIds()).toEqual([]);
  });

  it("zoom changes the stage width and outlines toggle a class", () => {
    const { overlay } = mount();
    const stage = container.querySelector<HTMLElement>(".overlay-stage")!;
    overlay.setZoom(2);
    expect(stage.style.width).toBe("200%");
    overlay.setZoom(1);
    expect(stage.style.width).toBe("100%");
    overlay.setOutlines(true);
    expect(stage.classList.contains("outlines")).toBe(true);
  });
});
