import { describe, expect, it } from "vitest";
import { declarations } from "./test-css";

// Controls that are visually small get an invisible hit area, so a thumb still has about 44px
// to hit without making the compact header, tabs and bottom bar taller.
const AROUND = {
  ".menu-button": 0.5,
  ".rescan": 0.5,
  ".sheet-close": 0.5,
  ".drawer-close": 0.5,
  ".icon-button": 0.5,
  ".toast-close": 0.75,
} as const;
const VERTICAL = { ".tab": 0.625, ".nav-tab": 0.625, ".chip": 0.625 } as const;

const firstInsetRem = (body: string) => {
  const value = body.match(/inset:\s*(-?[\d.]+)rem/);
  return value ? Number(value[1]) : NaN;
};

describe("hit areas of small controls", () => {
  it.each(Object.entries(AROUND))("%s extends its hit area by at least %srem all around", (sel, rem) => {
    expect(declarations(sel)).toContain("position: relative");
    const before = declarations(`${sel}::before`);
    expect(before).toContain('content: ""');
    expect(before).toContain("position: absolute");
    expect(firstInsetRem(before)).toBeLessThanOrEqual(-rem);
  });

  it.each(Object.entries(VERTICAL))("%s extends its hit area by at least %srem vertically", (sel, rem) => {
    expect(declarations(sel)).toContain("position: relative");
    const before = declarations(`${sel}::before`);
    expect(before).toContain('content: ""');
    expect(before).toContain("position: absolute");
    expect(firstInsetRem(before)).toBeLessThanOrEqual(-rem);
  });
});
