import { describe, expect, it, vi } from "vitest";
import { createDrawer } from "./drawer";

function make() {
  const deps = {
    version: "abc1234",
    diagnostics: "Page 390×844 · screen 390×844 @2x · touch · UI ×1",
    onScanner: vi.fn(),
    onResetToken: vi.fn(),
    comingSoon: vi.fn(),
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

  it("shows the target language as static German without a handler", () => {
    const { drawer, deps } = make();
    const row = drawer.element.querySelector(".nav-item.static")!;
    expect(row.textContent).toContain("Target Language:");
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
