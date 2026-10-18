import { h } from "./dom";
import { icon } from "./icons";

export interface HeaderOptions {
  onMenu: () => void;
  onHome: () => void;
}

/** Compact fixed header: logo and title on the left, the menu button on the right. */
export function renderHeader({ onMenu, onHome }: HeaderOptions): HTMLElement {
  const logo = h("div", { class: "logo" }, icon("book-open-check", { size: 16 }));
  const brand = h(
    "button",
    { type: "button", class: "brand", onclick: onHome, attrs: { "aria-label": "ReadMate home" } },
    logo,
    h("h1", { textContent: "ReadMate" }),
    h("span", { class: "pwa-badge", textContent: "PWA" }),
  );
  const menu = h("button", {
    type: "button",
    class: "menu-button",
    onclick: onMenu,
    attrs: { "aria-label": "Open menu" },
  });
  menu.append(icon("menu", { size: 20 }));
  return h("header", { class: "app-header" }, brand, menu);
}
