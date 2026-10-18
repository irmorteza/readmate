import "./styles.css";
import { postOcr } from "./api";
import { createController, errorMessage, type State } from "./app";
import { BUILD_SHA } from "./build-info";
import { createCapture } from "./capture";
import { button, h } from "./dom";
import { renderHeader, watchOnlineStatus } from "./header";
import { prepareImage } from "./image";
import { createResultView } from "./result-view";
import { clearToken, getToken, saveToken } from "./settings";
import { createTranslationService } from "./translation";
import { applyUiScale, describeViewport } from "./viewport";

const root = document.getElementById("app")!;
const translation = createTranslationService();

const controller = createController({
  prepareImage,
  postOcr,
  getToken,
  saveToken,
  clearToken,
  isOnline: () => navigator.onLine,
  createObjectURL: (blob) => URL.createObjectURL(blob),
});

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
const HINT_KEY = "readmate.ios-hint-dismissed";
const hintDismissed = () => {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
};

const card = (...children: (Node | string)[]) => h("div", { class: "card" }, ...children);

function screenNeedsToken(): HTMLElement {
  const input = h("input", { type: "password", placeholder: "Paste token", autocomplete: "off" });
  return h(
    "section",
    { class: "screen" },
    card(
      h("h2", { textContent: "Welcome to ReadMate" }),
      h("p", { class: "muted", textContent: "Paste your access token to start." }),
      input,
      button("Save", () => controller.saveToken(input.value), "primary full"),
    ),
  );
}

function screenIdle(): HTMLElement {
  const actions = h("div", { class: "actions" });
  createCapture(actions, (file) => void controller.chooseFile(file));
  const screen = h(
    "section",
    { class: "screen" },
    card(
      h("h2", { textContent: "Scan a page" }),
      h("p", {
        class: "muted",
        textContent: "Take a photo of a German book or newspaper page, then tap any word.",
      }),
      actions,
    ),
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
    card(
      imageUrl ? h("img", { class: "preview", src: imageUrl, alt: "" }) : "",
      h("p", { class: "spinner", textContent: "Reading text…" }),
    ),
  );
}

function screenError(state: Extract<State, { kind: "error" }>): HTMLElement {
  const screen = h(
    "section",
    { class: "screen" },
    card(h("p", { class: "error", textContent: errorMessage(state.error) })),
  );
  if (state.error.kind === "unauthorized") {
    screen.append(button("Enter token again", () => controller.resetToken(), "primary full"));
  }
  if (state.blob) screen.append(button("Try again", () => void controller.retry(), "primary full"));
  screen.append(button("New photo", () => controller.newPhoto(), "secondary full"));
  return screen;
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
      screen = createResultView(state, { translation, onNewPhoto: () => controller.newPhoto() });
      break;
    case "error":
      screen = screenError(state);
      break;
  }
  const header = renderHeader({
    buildSha: BUILD_SHA,
    onResetToken: state.kind === "needsToken" ? undefined : () => controller.resetToken(),
    diagnostics: describeViewport(),
  });
  root.replaceChildren(h("div", { class: "app" }, header, screen));
}

applyUiScale();
// Only the root font size changes on rotation or resize; the screen itself is not rebuilt, so the
// open tab, selection and sheet survive the URL bar showing or hiding.
window.addEventListener("resize", () => applyUiScale());
watchOnlineStatus();
controller.subscribe(render);
render(controller.getState());
