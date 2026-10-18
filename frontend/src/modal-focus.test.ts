import { afterEach, describe, expect, it, vi } from "vitest";
import { createModalFocus } from "./modal-focus";

const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

describe("modal focus", () => {
  it("stops reacting to Escape once its dialog has been removed from the page", () => {
    const onEscape = vi.fn();
    const dialog = document.createElement("div");
    const close = document.createElement("button");
    dialog.append(close);
    document.body.replaceChildren(dialog);
    const focus = createModalFocus(onEscape, dialog);
    focus.activate(close);
    dialog.remove(); // the screen was rebuilt while the dialog was open
    escape();
    expect(onEscape).not.toHaveBeenCalled();
    escape();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("still closes on Escape while the dialog is on the page", () => {
    const onEscape = vi.fn();
    const dialog = document.createElement("div");
    const close = document.createElement("button");
    dialog.append(close);
    document.body.replaceChildren(dialog);
    const focus = createModalFocus(onEscape, dialog);
    focus.activate(close);
    escape();
    expect(onEscape).toHaveBeenCalledTimes(1);
    focus.release();
  });
});

describe("focus must not scroll the page", () => {
  afterEach(() => vi.restoreAllMocks());

  it("moves focus into the dialog without scrolling any ancestor", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const dialog = document.createElement("div");
    const close = document.createElement("button");
    dialog.append(close);
    document.body.replaceChildren(dialog);
    const focus = createModalFocus(() => {}, dialog);
    focus.activate(close);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    focus.release();
  });

  it("gives focus back to the opener without scrolling either", () => {
    const opener = document.createElement("button");
    const dialog = document.createElement("div");
    const close = document.createElement("button");
    dialog.append(close);
    document.body.replaceChildren(opener, dialog);
    opener.focus();
    const focus = createModalFocus(() => {}, dialog);
    focus.activate(close);
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    focus.release();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(opener);
  });
});

