/** Tiny element builder shared by the screens. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & {
    class?: string;
    attrs?: Record<string, string>;
  } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: className, attrs, ...rest } = props;
  if (className) el.className = className;
  for (const [name, value] of Object.entries(attrs ?? {})) el.setAttribute(name, value);
  Object.assign(el, rest);
  el.append(...children);
  return el;
}

export const button = (label: string, onClick: () => void, cls = ""): HTMLButtonElement =>
  h("button", { type: "button", class: cls, textContent: label, onclick: onClick });
