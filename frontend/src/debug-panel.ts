import type { DebugSnapshot, SentenceStatus } from "./debug-snapshot";
import { h } from "./dom";
import { icon } from "./icons";

export interface DebugPanel {
  element: HTMLDetailsElement;
  render(snapshot: DebugSnapshot): void;
  clear(): void;
}

const COPY_LABEL = "Copy JSON";
const MISSING_SENTENCE: Record<Exclude<SentenceStatus, "ok">, string> = {
  absent: "No sentence data (older backend)",
  ignored: "Sentence data was malformed and ignored",
  "not-found": "Word not found in sentences",
};

function section(name: string, title: string, ...content: (Node | string)[]) {
  return h(
    "div",
    { attrs: { "data-debug": name } },
    h("h4", { class: "debug-label", textContent: title }),
    ...content,
  );
}

const text = (value: string) => h("p", { textContent: value });

function keyValues(values: Record<string, unknown> | null) {
  if (!values || Object.keys(values).length === 0) return text("none");
  const list = h("dl", { class: "debug-kv" });
  for (const [key, value] of Object.entries(values)) {
    list.append(
      h("dt", { textContent: key }),
      h("dd", { textContent: typeof value === "string" ? value : JSON.stringify(value) }),
    );
  }
  return list;
}

/** The sentence text with the tapped word in <mark>; unmarked if the pieces do not map 1:1 to wordIds. */
function sentenceText(sentence: NonNullable<DebugSnapshot["sentence"]>) {
  const pieces = sentence.text.split(" ");
  const line = h("p");
  if (pieces.length !== sentence.wordIds.length) {
    line.textContent = sentence.text;
    return line;
  }
  pieces.forEach((piece, i) => {
    if (i > 0) line.append(" ");
    line.append(i === sentence.wordIndex ? h("mark", { textContent: piece }) : piece);
  });
  return line;
}

export function createDebugPanel(deps?: { writeText?: (text: string) => Promise<void> }): DebugPanel {
  // Resolved at click time: navigator.clipboard is missing on plain http (for example a LAN IP).
  const write =
    deps?.writeText ??
    ((value: string) =>
      navigator.clipboard
        ? navigator.clipboard.writeText(value)
        : Promise.reject(new Error("no clipboard")));

  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const body = h("div", { class: "debug-body" });
  const summary = h("summary", {}, "Debug", icon("chevron-right", { size: 16, class: "debug-chevron" }));
  const element = h("details", { class: "debug", hidden: true }, summary, body);

  function copyControls(snapshot: DebugSnapshot) {
    const json = JSON.stringify(snapshot, null, 2);
    const fallback = h("textarea", { class: "debug-fallback", readOnly: true, rows: 8, hidden: true, value: json });
    const copy = h("button", { type: "button", class: "secondary full debug-copy", textContent: COPY_LABEL });
    copy.onclick = () => {
      clearTimeout(resetTimer);
      Promise.resolve()
        .then(() => write(json))
        .then(
          () => {
            copy.textContent = "Copied";
            resetTimer = setTimeout(() => (copy.textContent = COPY_LABEL), 2000);
          },
          () => {
            copy.textContent = "Copy failed — select the text below";
            fallback.hidden = false;
            fallback.focus({ preventScroll: true });
            fallback.select();
          },
        );
    };
    return [copy, fallback];
  }

  return {
    element,
    render(snapshot) {
      const { sentence, lookup } = snapshot;
      body.replaceChildren(
        section("word", "Word", text(`${snapshot.word.text} (id ${snapshot.word.id})`)),
        section(
          "sentence",
          "Sentence",
          ...(sentence
            ? [text(`id ${sentence.id} · ${sentence.kind} · word ${sentence.wordIndex}`), sentenceText(sentence)]
            : [text(MISSING_SENTENCE[snapshot.sentenceStatus === "ok" ? "absent" : snapshot.sentenceStatus])]),
        ),
        section("lines", "Lines", ...snapshot.lineTexts.map(text)),
        section(
          "request",
          "Lookup request",
          h("pre", { textContent: JSON.stringify(lookup.request, null, 2) }),
          h("p", {
            class: "debug-context-length",
            textContent: `Context: ${lookup.contextLength} characters (${lookup.contextSource})`,
          }),
        ),
        section(
          "result",
          "Lookup result",
          text(`${lookup.source} · ${lookup.status}`),
          keyValues(lookup.response),
          h("h4", { class: "debug-label", textContent: "Meta" }),
          keyValues(lookup.meta),
          ...(lookup.error ? [text(`Error: ${lookup.error}`)] : []),
        ),
        ...copyControls(snapshot),
      );
      element.hidden = false;
    },
    clear() {
      body.replaceChildren();
      element.hidden = true;
    },
  };
}
