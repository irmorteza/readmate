import { h } from "./dom";

const VISIBLE_MS = 3000;

export const comingSoonMessage = (label: string): string => `${label} is coming soon`;

export interface Toaster {
  element: HTMLElement;
  show(message: string): void;
}

/** One floating message at the top of the screen; a new message replaces the current one. */
export function createToaster(): Toaster {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const text = h("span", { class: "toast-message" });
  const hide = () => {
    clearTimeout(timer);
    element.hidden = true;
  };
  const element = h(
    "div",
    { class: "toast", hidden: true, attrs: { role: "status" } },
    text,
    h("button", {
      type: "button",
      class: "toast-close",
      textContent: "×",
      attrs: { "aria-label": "Dismiss" },
      onclick: hide,
    }),
  );
  return {
    element,
    show(message) {
      clearTimeout(timer);
      text.textContent = message;
      element.hidden = false;
      timer = setTimeout(hide, VISIBLE_MS);
    },
  };
}
