import { h } from "./dom";
import { icon } from "./icons";

/** Shown while the photo is resized and read: the real preview with a moving laser line. */
export function createScanningView({ imageUrl }: { imageUrl?: string }): HTMLElement {
  const pill = h("div", { class: "scan-pill" }, icon("loader", { size: 16, class: "spin" }));
  pill.append("Extracting German words…");
  return h(
    "section",
    { class: "screen scanning", attrs: { "aria-live": "polite" } },
    h(
      "div",
      { class: "scan-card" },
      ...(imageUrl ? [h("img", { src: imageUrl, alt: "" })] : []),
      h("div", { class: "laser" }),
      pill,
    ),
    h("p", { class: "scan-caption", textContent: "Analyzing Page Layout & OCR" }),
  );
}
