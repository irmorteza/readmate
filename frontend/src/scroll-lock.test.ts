import { describe, expect, it } from "vitest";
import { declarations } from "./test-css";

describe("background scroll while a dialog is open", () => {
  it.each([
    ".app-viewport-container:has(.sheet:not([hidden])) .content",
    ".app-viewport-container:has(.drawer-overlay:not([hidden])) .content",
  ])("%s does not scroll", (selector) => {
    expect(declarations(selector)).toContain("overflow: hidden");
  });

  it.each([".sheet", ".drawer-panel"])("%s does not chain its scrolling to the page behind", (selector) => {
    expect(declarations(selector)).toContain("overscroll-behavior: contain");
  });
});

describe("the app container", () => {
  it("can never be scrolled, not even by the browser bringing a focused element into view", () => {
    // overflow: hidden still lets focus() scroll it; clip does not.
    expect(declarations(".app-viewport-container")).toContain("overflow: clip");
  });
});

