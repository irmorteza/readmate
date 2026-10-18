import { button, h } from "./dom";

export interface HeaderOptions {
  buildSha: string;
  /** Shown as "Reset token" in the settings menu; omit while there is no token yet. */
  onResetToken?: () => void;
}

function applyStatus(el: HTMLElement, online: boolean): void {
  el.className = `status ${online ? "online" : "offline"}`;
  el.replaceChildren(h("span", { class: "dot" }), online ? "Online" : "Offline");
}

export function renderHeader({ buildSha, onResetToken }: HeaderOptions): HTMLElement {
  const status = h("span", { attrs: { role: "status" } });
  applyStatus(status, navigator.onLine);

  const right = h("div", { class: "header-right" }, status);
  if (onResetToken) {
    right.append(
      h(
        "details",
        { class: "menu" },
        h("summary", { textContent: "⚙", attrs: { "aria-label": "Settings" } }),
        h(
          "div",
          { class: "menu-panel" },
          button("Reset token", onResetToken),
          h("p", { class: "version", textContent: `Version ${buildSha}` }),
        ),
      ),
    );
  }

  return h(
    "header",
    { class: "app-header" },
    h(
      "div",
      { class: "brand" },
      h("div", { class: "logo", textContent: "RM" }),
      h(
        "div",
        {},
        h("h1", { textContent: "ReadMate" }),
        h("span", { class: "tagline", textContent: "GERMAN ASSISTANT" }),
      ),
    ),
    right,
  );
}

let watching = false;

/** Keeps every Online/Offline badge on the page in step with the browser's connection state. */
export function watchOnlineStatus(): void {
  if (watching) return;
  watching = true;
  const update = (online: boolean) =>
    document.querySelectorAll<HTMLElement>(".status").forEach((el) => applyStatus(el, online));
  window.addEventListener("online", () => update(true));
  window.addEventListener("offline", () => update(false));
}
