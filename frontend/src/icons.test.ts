import { describe, expect, it } from "vitest";
import { ICON_NAMES, icon } from "./icons";

describe("icon", () => {
  it("renders an svg with drawing elements for every icon name", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(26);
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.tagName.toLowerCase(), name).toBe("svg");
      expect(svg.childElementCount, name).toBeGreaterThan(0);
    }
  });

  it("uses the size option for width and height (default 20) and the class option", () => {
    expect(icon("camera").getAttribute("width")).toBe("20");
    expect(icon("camera").getAttribute("height")).toBe("20");
    const big = icon("camera", { size: 32, class: "hero" });
    expect(big.getAttribute("width")).toBe("32");
    expect(big.getAttribute("height")).toBe("32");
    expect(big.classList.contains("hero")).toBe(true);
  });

  it("draws with the current text color and is hidden from assistive tech", () => {
    const svg = icon("menu");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("returns a fresh element each call", () => {
    expect(icon("x")).not.toBe(icon("x"));
  });
});
