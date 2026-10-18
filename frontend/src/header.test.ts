import { describe, expect, it, vi } from "vitest";
import { renderHeader } from "./header";

describe("renderHeader", () => {
  it("shows the logo, the ReadMate title and the PWA badge", () => {
    const header = renderHeader({ onMenu: () => {}, onHome: () => {} });
    expect(header.querySelector(".logo svg")).not.toBeNull();
    expect(header.querySelector("h1")?.textContent).toBe("ReadMate");
    expect(header.querySelector(".pwa-badge")?.textContent).toBe("PWA");
  });

  it("the menu button opens the menu", () => {
    const onMenu = vi.fn();
    const header = renderHeader({ onMenu, onHome: () => {} });
    const button = header.querySelector<HTMLButtonElement>("button.menu-button")!;
    expect(button.getAttribute("aria-label")).toBe("Open menu");
    button.click();
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("the logo goes home", () => {
    const onHome = vi.fn();
    const header = renderHeader({ onMenu: () => {}, onHome });
    header.querySelector<HTMLButtonElement>("button.brand")!.click();
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("has neither the old online badge nor the old settings menu", () => {
    const header = renderHeader({ onMenu: () => {}, onHome: () => {} });
    expect(header.querySelector(".status")).toBeNull();
    expect(header.querySelector(".menu")).toBeNull();
  });
});
