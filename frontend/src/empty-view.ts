import { createCapture } from "./capture";
import { h } from "./dom";
import { icon } from "./icons";

export interface EmptyViewDeps {
  onFile: (file: File) => void;
}

/** The first screen: explains the app and offers the camera and the gallery. */
export function createEmptyView({ onFile }: EmptyViewDeps): HTMLElement {
  const tag = h("div", { class: "tag" }, icon("sparkles", { size: 14 }));
  tag.append("Instant OCR");
  const actions = h("div", { class: "actions" });
  createCapture(actions, onFile);
  return h(
    "section",
    { class: "screen empty" },
    h(
      "div",
      { class: "hero-wrap" },
      h("div", { class: "hero" }, icon("scan-text", { size: 64, class: "hero-icon" })),
      tag,
    ),
    h("h2", { class: "empty-title", textContent: "Snap, Read & Learn" }),
    h("p", {
      class: "empty-text",
      textContent:
        "Take a photo of any book page or document. Tap words for instant translation, audio phonetics & flashcards.",
    }),
    actions,
  );
}
