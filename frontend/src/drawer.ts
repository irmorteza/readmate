import { button, h } from "./dom";
import { icon, type IconName } from "./icons";
import { createModalFocus } from "./modal-focus";

export interface DrawerDeps {
  version: string;
  diagnostics: string;
  onScanner: () => void;
  onResetToken: () => void;
  comingSoon: (label: string) => void;
}

export interface Drawer {
  element: HTMLElement;
  open(): void;
  close(): void;
}

export function createDrawer(deps: DrawerDeps): Drawer {
  const close = () => {
    element.hidden = true;
    focus.release();
  };
  const open = () => {
    element.hidden = false;
    focus.activate(closeButton);
  };

  const row = (iconName: IconName, label: string, onClick: () => void, soon = false) => {
    const el = h("button", { type: "button", class: "nav-item", onclick: onClick });
    el.append(icon(iconName, { size: 16 }), h("span", { class: "nav-label", textContent: label }));
    if (soon) el.append(h("span", { class: "soon", textContent: "Soon" }));
    return el;
  };

  const scanner = row("camera", "Scanner / Reader", () => {
    deps.onScanner();
    close();
  });
  scanner.classList.add("active");

  const language = h("div", { class: "nav-item static" }, icon("languages", { size: 16 }));
  language.append(
    h("span", { class: "nav-label" }, "Target Language: ", h("strong", { textContent: "German" })),
  );

  const exportButton = button("", () => deps.comingSoon("Export Flashcards"), "secondary full");
  exportButton.append(icon("download", { size: 16 }), "Export Flashcards (.apkg)");

  const closeButton = h("button", {
    type: "button",
    class: "drawer-close",
    onclick: close,
    attrs: { "aria-label": "Close menu" },
  });
  closeButton.append(icon("x", { size: 20 }));

  const panel = h(
    "div",
    { class: "drawer-panel" },
    h(
      "div",
      { class: "drawer-head" },
      h("div", { class: "avatar", textContent: "RM" }),
      h("h3", { textContent: "German Learner" }),
      closeButton,
    ),
    h(
      "nav",
      { class: "drawer-nav" },
      scanner,
      row("bookmark", "Saved Words", () => deps.comingSoon("Saved Words"), true),
      row("history", "Scan History", () => deps.comingSoon("Scan History"), true),
      language,
      row("sliders", "Preferences", () => deps.comingSoon("Preferences"), true),
    ),
    h(
      "div",
      { class: "drawer-foot" },
      h(
        "div",
        { class: "anki-card" },
        h("p", { class: "anki-title", textContent: "Anki Export" }),
        h("p", { class: "anki-text", textContent: "Flashcard export is coming soon." }),
      ),
      exportButton,
      button(
        "Reset token",
        () => {
          deps.onResetToken();
          close();
        },
        "secondary full",
      ),
      h("p", { class: "version", textContent: `Version ${deps.version}` }),
      h("p", { class: "version diagnostics", textContent: deps.diagnostics }),
    ),
  );

  const element = h(
    "div",
    { class: "drawer-overlay", hidden: true, attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Menu" } },
    panel,
    h("div", { class: "drawer-backdrop", onclick: close }),
  );
  const focus = createModalFocus(() => close(), element);
  return { element, open, close };
}
