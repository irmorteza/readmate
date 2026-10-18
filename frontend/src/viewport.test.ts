import { afterEach, describe, expect, it } from "vitest";
import { applyUiScale, computeUiScale, describeViewport } from "./viewport";

afterEach(() => document.documentElement.style.removeProperty("font-size"));

describe("computeUiScale", () => {
  it("is 1 on a normal phone, where the page is as wide as the screen", () => {
    expect(computeUiScale(390, 390, true)).toBe(1);
    expect(computeUiScale(412, 412, true)).toBe(1);
  });

  it("scales up when a touch device lays the page out much wider than its screen", () => {
    expect(computeUiScale(980, 412, true)).toBeCloseTo(980 / 412, 5);
  });

  it("never scales a mouse-driven desktop", () => {
    expect(computeUiScale(1920, 1920, false)).toBe(1);
    expect(computeUiScale(980, 412, false)).toBe(1);
  });

  it("leaves a tablet and small differences alone", () => {
    expect(computeUiScale(800, 800, true)).toBe(1);
    expect(computeUiScale(480, 412, true)).toBe(1); // ratio 1.17 is under the threshold
  });

  it("caps the scale and ignores missing screen sizes", () => {
    expect(computeUiScale(3000, 300, true)).toBe(3);
    expect(computeUiScale(980, 0, true)).toBe(1);
    expect(computeUiScale(0, 412, true)).toBe(1);
  });
});

function fakeWindow(innerWidth: number, screenWidth: number, coarse: boolean) {
  return {
    innerWidth,
    innerHeight: 800,
    devicePixelRatio: 2,
    screen: { width: screenWidth, height: 900 },
    matchMedia: () => ({ matches: coarse }),
  } as unknown as Window;
}

describe("applyUiScale", () => {
  it("sets the root font size in proportion to the scale and returns it", () => {
    const scale = applyUiScale(fakeWindow(980, 490, true));
    expect(scale).toBe(2);
    expect(document.documentElement.style.fontSize).toBe("32px");
  });

  it("removes the override again when no scaling is needed", () => {
    applyUiScale(fakeWindow(980, 490, true));
    expect(applyUiScale(fakeWindow(390, 390, true))).toBe(1);
    expect(document.documentElement.style.fontSize).toBe("");
  });
});

describe("describeViewport", () => {
  it("reports the numbers needed to diagnose a layout problem", () => {
    expect(describeViewport(fakeWindow(980, 412, true))).toBe(
      "Page 980×800 · screen 412×900 @2x · touch · UI ×2.38",
    );
  });

  it("rounds a noisy device pixel ratio", () => {
    const win = fakeWindow(980, 412, true);
    (win as unknown as { devicePixelRatio: number }).devicePixelRatio = 2.0000000596046448;
    expect(describeViewport(win)).toContain("@2x");
    (win as unknown as { devicePixelRatio: number }).devicePixelRatio = 2.625;
    expect(describeViewport(win)).toContain("@2.63x");
  });
});
