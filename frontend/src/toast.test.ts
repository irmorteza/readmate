import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import css from "./styles.css?raw";
import { comingSoonMessage, createToaster } from "./toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("toaster", () => {
  it("is hidden until a message is shown", () => {
    expect(createToaster().element.hidden).toBe(true);
  });

  it("shows the message with a polite status role", () => {
    const toaster = createToaster();
    toaster.show("Page scanned");
    expect(toaster.element.hidden).toBe(false);
    expect(toaster.element.getAttribute("role")).toBe("status");
    expect(toaster.element.textContent).toContain("Page scanned");
  });

  it("hides itself after 3 seconds", () => {
    const toaster = createToaster();
    toaster.show("Hello");
    vi.advanceTimersByTime(2999);
    expect(toaster.element.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toaster.element.hidden).toBe(true);
  });

  it("a new message replaces the old one and restarts the timer", () => {
    const toaster = createToaster();
    toaster.show("First");
    vi.advanceTimersByTime(2000);
    toaster.show("Second");
    expect(toaster.element.textContent).toContain("Second");
    expect(toaster.element.textContent).not.toContain("First");
    vi.advanceTimersByTime(2999); // 4999 ms after the first message, 2999 after the second
    expect(toaster.element.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toaster.element.hidden).toBe(true);
  });

  it("the close button hides it at once and the old timer cannot hide a later message", () => {
    const toaster = createToaster();
    toaster.show("First");
    toaster.element.querySelector<HTMLButtonElement>("button[aria-label='Dismiss']")!.click();
    expect(toaster.element.hidden).toBe(true);
    vi.advanceTimersByTime(1000);
    toaster.show("Second");
    vi.advanceTimersByTime(2500); // the first message's timer would have fired by now
    expect(toaster.element.hidden).toBe(false);
  });
});

describe("comingSoonMessage", () => {
  it("formats the message for unimplemented features", () => {
    expect(comingSoonMessage("Saved Words")).toBe("Saved Words is coming soon");
  });
});

describe("stacking", () => {
  const zIndex = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`);
    const rule = css.slice(start, css.indexOf("}", start));
    return Number(rule.match(/z-index:\s*(\d+)/)?.[1]);
  };

  it("is stacked above the drawer, the sheet and the backdrop so coming-soon messages stay visible", () => {
    const toast = zIndex(".toast");
    expect(toast).toBeGreaterThan(zIndex(".drawer-overlay"));
    expect(toast).toBeGreaterThan(zIndex(".sheet"));
    expect(toast).toBeGreaterThan(zIndex(".sheet-backdrop"));
  });
});
