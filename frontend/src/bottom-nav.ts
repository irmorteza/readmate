import { h } from "./dom";
import { icon, type IconName } from "./icons";

export interface BottomNavOptions {
  active: "scan" | "reader" | null;
  /** Reader needs a result to go back to; without one the button is disabled. */
  readerAvailable: boolean;
  onScan: () => void;
  onReader: () => void;
  onCards: () => void;
  onProfile: () => void;
}

export function renderBottomNav(opts: BottomNavOptions): HTMLElement {
  const tab = (
    key: string,
    iconName: IconName,
    label: string,
    onClick: () => void,
    extra: { active?: boolean; disabled?: boolean; dot?: boolean } = {},
  ) => {
    const el = h("button", {
      type: "button",
      class: `nav-tab${extra.active ? " active" : ""}`,
      disabled: extra.disabled ?? false,
      onclick: onClick,
      attrs: { "data-nav": key, ...(extra.active ? { "aria-current": "page" } : {}) },
    });
    el.append(icon(iconName, { size: 16 }), label);
    if (extra.dot) el.append(h("span", { class: "dot" }));
    return el;
  };

  return h(
    "nav",
    { class: "bottom-nav", attrs: { "aria-label": "Main" } },
    tab("scan", "camera", "Scan", opts.onScan, { active: opts.active === "scan" }),
    tab("reader", "book-open", "Reader", opts.onReader, {
      active: opts.active === "reader",
      disabled: !opts.readerAvailable,
    }),
    tab("cards", "layers", "Cards", opts.onCards, { dot: true }),
    tab("profile", "user", "Profile", opts.onProfile),
  );
}
