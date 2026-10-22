import { describe, expect, it, vi } from "vitest";
import { createDrawer } from "./drawer";
import { declarations } from "./test-css";

function make(devMode = false) {
  const deps = {
    version: "abc1234",
    diagnostics: "Page 390×844 · screen 390×844 @2x · touch · UI ×1",
    onScanner: vi.fn(),
    onResetToken: vi.fn(),
    comingSoon: vi.fn(),
    devMode,
    onDevModeChange: vi.fn(),
  };
  const drawer = createDrawer(deps);
  document.body.replaceChildren(drawer.element);
  return { drawer, deps };
}

const item = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label))!;

describe("drawer", () => {
  it("is hidden until opened and hides again on close", () => {
    const { drawer } = make();
    expect(drawer.element.hidden).toBe(true);
    drawer.open();
    expect(drawer.element.hidden).toBe(false);
    drawer.close();
    expect(drawer.element.hidden).toBe(true);
  });

  it("closes when the backdrop or the close button is tapped", () => {
    const { drawer } = make();
    drawer.open();
    drawer.element.querySelector<HTMLElement>(".drawer-backdrop")!.click();
    expect(drawer.element.hidden).toBe(true);
    drawer.open();
    drawer.element.querySelector<HTMLElement>('button[aria-label="Close menu"]')!.click();
    expect(drawer.element.hidden).toBe(true);
  });

  it("Scanner / Reader navigates and closes the drawer", () => {
    const { drawer, deps } = make();
    drawer.open();
    item(drawer.element, "Scanner / Reader").click();
    expect(deps.onScanner).toHaveBeenCalledTimes(1);
    expect(drawer.element.hidden).toBe(true);
  });

  it("each unimplemented item reports coming soon with its own label and shows a Soon badge", () => {
    const { drawer, deps } = make();
    for (const label of ["Saved Words", "Scan History", "Preferences", "Export Flashcards"]) {
      item(drawer.element, label).click();
      expect(deps.comingSoon).toHaveBeenLastCalledWith(label);
    }
    for (const label of ["Saved Words", "Scan History", "Preferences"]) {
      expect(item(drawer.element, label).querySelector(".soon")?.textContent).toBe("Soon");
    }
  });

  it("Reset token calls its handler and closes the drawer", () => {
    const { drawer, deps } = make();
    drawer.open();
    item(drawer.element, "Reset token").click();
    expect(deps.onResetToken).toHaveBeenCalledTimes(1);
    expect(drawer.element.hidden).toBe(true);
  });

  it("shows the version and the viewport diagnostics", () => {
    const { drawer } = make();
    expect(drawer.element.querySelector(".version")?.textContent).toBe("Version abc1234");
    expect(drawer.element.querySelector(".diagnostics")?.textContent).toBe(
      "Page 390×844 · screen 390×844 @2x · touch · UI ×1",
    );
  });

  it("shows the book language as static German without a handler", () => {
    const { drawer, deps } = make();
    const row = drawer.element.querySelector(".nav-item.static")!;
    expect(row.textContent).toContain("Book language:");
    expect(row.textContent).not.toContain("Target Language");
    expect(row.textContent).toContain("German");
    expect(row.tagName).not.toBe("BUTTON");
    (row as HTMLElement).click();
    expect(deps.comingSoon).not.toHaveBeenCalled();
  });

  it("does not claim a number of cards ready for export", () => {
    const { drawer } = make();
    expect(drawer.element.textContent).not.toMatch(/\d+ new words/);
  });
});

describe("drawer dialog behavior", () => {
  function opener() {
    const b = document.createElement("button");
    document.body.append(b);
    b.focus();
    return b;
  }
  const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  it("is announced as a modal dialog", () => {
    const { drawer } = make();
    expect(drawer.element.getAttribute("aria-modal")).toBe("true");
  });

  it("opening focuses the close button and closing returns focus to the opener", () => {
    const { drawer } = make();
    const trigger = opener();
    drawer.open();
    expect(document.activeElement).toBe(drawer.element.querySelector('button[aria-label="Close menu"]'));
    drawer.close();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape closes it while open and is ignored afterwards", () => {
    const { drawer } = make();
    drawer.open();
    escape();
    expect(drawer.element.hidden).toBe(true);
    const keep = opener();
    escape();
    expect(document.activeElement).toBe(keep);
  });

  it("closing twice or opening twice is harmless", () => {
    const { drawer } = make();
    const trigger = opener();
    drawer.open();
    drawer.open();
    drawer.close();
    drawer.close();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not fail when the opener has left the page", () => {
    const { drawer } = make();
    const trigger = opener();
    drawer.open();
    trigger.remove();
    expect(() => drawer.close()).not.toThrow();
  });

  const devSwitch = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input[role="switch"]')!;

  it("shows a Developer mode switch reflecting the stored state", () => {
    expect(devSwitch(make(false).drawer.element).checked).toBe(false);
    const { drawer } = make(true);
    expect(devSwitch(drawer.element).checked).toBe(true);
    expect(devSwitch(drawer.element).closest("label")!.textContent).toContain("Developer mode");
  });

  it("toggling the switch reports the new state and keeps the drawer open", () => {
    const { drawer, deps } = make(false);
    drawer.open();
    devSwitch(drawer.element).click();
    expect(deps.onDevModeChange).toHaveBeenCalledWith(true);
    expect(drawer.element.hidden).toBe(false);
  });

  it("the switch row is at least 2.75rem high", () => {
    expect(declarations(".dev-switch")).toContain("min-height: 2.75rem");
  });
});
