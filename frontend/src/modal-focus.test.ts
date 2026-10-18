import { describe, expect, it, vi } from "vitest";
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
