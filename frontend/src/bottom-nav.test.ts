import { describe, expect, it, vi } from "vitest";
import { renderBottomNav } from "./bottom-nav";

function make(over: Partial<Parameters<typeof renderBottomNav>[0]> = {}) {
  const handlers = { onScan: vi.fn(), onReader: vi.fn(), onCards: vi.fn(), onProfile: vi.fn() };
  const nav = renderBottomNav({ active: "scan", readerAvailable: true, ...handlers, ...over });
  return { nav, handlers, buttons: [...nav.querySelectorAll<HTMLButtonElement>("button")] };
}

describe("bottom navigation", () => {
  it("has Scan, Reader, Cards and Profile in that order, each with an icon", () => {
    const { buttons } = make();
    expect(buttons.map((b) => b.textContent)).toEqual(["Scan", "Reader", "Cards", "Profile"]);
    expect(buttons.every((b) => b.querySelector("svg"))).toBe(true);
  });

  it("each button calls its own handler", () => {
    const { buttons, handlers } = make();
    buttons.forEach((b) => b.click());
    expect(handlers.onScan).toHaveBeenCalledTimes(1);
    expect(handlers.onReader).toHaveBeenCalledTimes(1);
    expect(handlers.onCards).toHaveBeenCalledTimes(1);
    expect(handlers.onProfile).toHaveBeenCalledTimes(1);
  });

  it("Reader is disabled without a result and does not call its handler", () => {
    const { buttons, handlers } = make({ readerAvailable: false });
    expect(buttons[1].disabled).toBe(true);
    buttons[1].click();
    expect(handlers.onReader).not.toHaveBeenCalled();
    expect(buttons[0].disabled).toBe(false);
  });

  it("Reader is enabled when a result exists", () => {
    expect(make({ readerAvailable: true }).buttons[1].disabled).toBe(false);
  });

  it("marks the active item for styling and assistive tech", () => {
    const { buttons } = make({ active: "reader" });
    expect(buttons[1].classList.contains("active")).toBe(true);
    expect(buttons[1].getAttribute("aria-current")).toBe("page");
    expect(buttons[0].classList.contains("active")).toBe(false);
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
  });

  it("marks nothing when no item is active", () => {
    const { buttons } = make({ active: null });
    expect(buttons.some((b) => b.classList.contains("active"))).toBe(false);
  });

  it("Cards carries a small dot", () => {
    const { buttons } = make();
    expect(buttons[2].querySelector(".dot")).not.toBeNull();
    expect(buttons[0].querySelector(".dot")).toBeNull();
  });
});
