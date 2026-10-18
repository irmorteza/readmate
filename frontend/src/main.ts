import "./styles.css";
import { postOcr } from "./api";
import {
  createController,
  errorMessage,
  isEmptyResult,
  NO_TEXT_MESSAGE,
  type State,
} from "./app";
import { BUILD_SHA } from "./build-info";
import { createCapture } from "./capture";
import { prepareImage } from "./image";
import { renderOverlay, type ZoomLevel } from "./overlay";
import { createSelection } from "./selection";
import { clearToken, getToken, saveToken } from "./settings";

const root = document.getElementById("app")!;

const controller = createController({
  prepareImage,
  postOcr,
  getToken,
  saveToken,
  clearToken,
  isOnline: () => navigator.onLine,
  createObjectURL: (blob) => URL.createObjectURL(blob),
});

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) el.className = className;
  Object.assign(el, rest);
  el.append(...children);
  return el;
}

const button = (label: string, onClick: () => void, cls = "") =>
  h("button", { type: "button", class: cls, textContent: label, onclick: onClick });

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
const HINT_KEY = "readmate.ios-hint-dismissed";
const hintDismissed = () => {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
};

function settingsMenu(): HTMLElement {
  return h(
    "details",
    { class: "menu" },
    h("summary", { textContent: "Settings" }),
    button("Reset token", () => controller.resetToken()),
    h("p", { class: "version", textContent: `Version ${BUILD_SHA}` }),
  );
}

function screenNeedsToken(): HTMLElement {
  const input = h("input", { type: "password", placeholder: "Paste token", autocomplete: "off" });
  return h(
    "section",
    { class: "screen" },
    h("h1", { textContent: "ReadMate" }),
    h("p", { textContent: "Paste your access token to start." }),
    input,
    button("Save", () => controller.saveToken(input.value), "primary"),
  );
}

function screenIdle(): HTMLElement {
  const actions = h("div", { class: "actions" });
  createCapture(actions, (file) => void controller.chooseFile(file));
  const screen = h(
    "section",
    { class: "screen" },
    h("h1", { textContent: "ReadMate" }),
    actions,
    settingsMenu(),
  );
  if (isIos && !(navigator as { standalone?: boolean }).standalone && !hintDismissed()) {
    const hint = h(
      "p",
      { class: "hint" },
      'To install: tap Share, then "Add to Home Screen". ',
      button("Dismiss", () => {
        try {
          localStorage.setItem(HINT_KEY, "1");
        } catch {
          // hint just reappears
        }
        hint.remove();
      }),
    );
    screen.append(hint);
  }
  return screen;
}

function screenBusy(imageUrl?: string): HTMLElement {
  return h(
    "section",
    { class: "screen" },
    imageUrl ? h("img", { class: "preview", src: imageUrl, alt: "" }) : "",
    h("p", { class: "spinner", textContent: "Reading text…" }),
  );
}

function screenError(state: Extract<State, { kind: "error" }>): HTMLElement {
  const screen = h(
    "section",
    { class: "screen" },
    h("p", { class: "error", textContent: errorMessage(state.error) }),
  );
  if (state.error.kind === "unauthorized") {
    screen.append(button("Enter token again", () => controller.resetToken(), "primary"));
  }
  if (state.blob) screen.append(button("Try again", () => void controller.retry(), "primary"));
  screen.append(button("New photo", () => controller.newPhoto()));
  return screen;
}

function screenResult(state: Extract<State, { kind: "result" }>): HTMLElement {
  const { result, imageUrl } = state;
  if (isEmptyResult(result)) {
    return h(
      "section",
      { class: "screen" },
      h("p", { textContent: NO_TEXT_MESSAGE }),
      button("New photo", () => controller.newPhoto(), "primary"),
    );
  }

  const sheet = h("div", { class: "sheet", hidden: true });
  const stageHost = h("div", { class: "stage-host" });
  const selection = createSelection(result, ({ word }) => {
    const copy = button("Copy", () => {
      navigator.clipboard
        .writeText(word.text)
        .then(() => (copy.textContent = "Copied"))
        .catch(() => (copy.textContent = "Copy failed"));
    });
    sheet.replaceChildren(h("strong", { textContent: word.text }), copy);
    sheet.hidden = false;
  });
  selection.subscribe((id) => {
    if (id === null) sheet.hidden = true;
  });
  const overlay = renderOverlay(stageHost, imageUrl, result, selection);

  const zoomButton = (label: string, level: ZoomLevel) =>
    button(label, () => overlay.setZoom(level));
  const outlines = h("input", { type: "checkbox", onchange: () => overlay.setOutlines(outlines.checked) });

  return h(
    "section",
    { class: "screen result" },
    h(
      "div",
      { class: "toolbar" },
      zoomButton("Fit", 1),
      zoomButton("2×", 2),
      zoomButton("3×", 3),
      h("label", {}, outlines, " Outlines"),
      button("New photo", () => controller.newPhoto(), "primary"),
      settingsMenu(),
    ),
    stageHost,
    sheet,
  );
}

function render(state: State): void {
  let screen: HTMLElement;
  switch (state.kind) {
    case "needsToken":
      screen = screenNeedsToken();
      break;
    case "idle":
      screen = screenIdle();
      break;
    case "resizing":
      screen = screenBusy();
      break;
    case "uploading":
      screen = screenBusy(state.imageUrl);
      break;
    case "result":
      screen = screenResult(state);
      break;
    case "error":
      screen = screenError(state);
      break;
  }
  root.replaceChildren(screen);
}

controller.subscribe(render);
render(controller.getState());
