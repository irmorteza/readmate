import "./styles.css";
import { postOcr } from "./api";
import { createController, errorMessage, type State } from "./app";
import { renderBottomNav } from "./bottom-nav";
import { BUILD_SHA } from "./build-info";
import { button, h } from "./dom";
import { getDevMode, setDevMode, subscribeDevMode } from "./dev-mode";
import { createDrawer } from "./drawer";
import { createEmptyView } from "./empty-view";
import { renderHeader } from "./header";
import { prepareImage } from "./image";
import { createResultView } from "./result-view";
import { createScanningView } from "./scanning-view";
import { clearToken, getToken, saveToken } from "./settings";
import { speak, SPEECH_UNSUPPORTED_MESSAGE } from "./speech";
import { comingSoonMessage, createToaster } from "./toast";
import { createTranslationService } from "./translation";
import { applyUiScale, describeViewport } from "./viewport";

const root = document.getElementById("app")!;
const translation = createTranslationService();
const toaster = createToaster(); // one toaster for the whole session; it survives screen changes

const controller = createController({
  prepareImage,
  postOcr,
  getToken,
  saveToken,
  clearToken,
  isOnline: () => navigator.onLine,
  createObjectURL: (blob) => URL.createObjectURL(blob),
});

const comingSoon = (label: string) => toaster.show(comingSoonMessage(label));
const pronounce = (text: string) => {
  if (!speak(text)) toaster.show(SPEECH_UNSUPPORTED_MESSAGE);
};

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
  const screen = createEmptyView({ onFile: (file) => void controller.chooseFile(file) });
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

function screenFor(state: State): HTMLElement {
  switch (state.kind) {
    case "needsToken":
      return screenNeedsToken();
    case "idle":
      return screenIdle();
    case "resizing":
      return createScanningView({});
    case "uploading":
      return createScanningView({ imageUrl: state.imageUrl });
    case "result":
      return createResultView(state, {
        translation,
        onNewPhoto: () => controller.newPhoto(),
        speak: pronounce,
        comingSoon,
        devMode: { get: getDevMode, subscribe: subscribeDevMode },
        build: BUILD_SHA,
      });
    case "error":
      return screenError(state);
  }
}

function render(state: State): void {
  // The drawer is rebuilt with every screen, so it starts closed and shows fresh diagnostics.
  const drawer = createDrawer({
    version: BUILD_SHA,
    diagnostics: describeViewport(),
    onScanner: () => controller.newPhoto(),
    onResetToken: () => controller.resetToken(),
    comingSoon,
    devMode: getDevMode(),
    onDevModeChange: setDevMode,
  });
  const header = renderHeader({ onMenu: drawer.open, onHome: () => controller.newPhoto() });
  const nav =
    state.kind === "needsToken"
      ? []
      : [
          renderBottomNav({
            active: state.kind === "result" ? "reader" : "scan",
            readerAvailable: controller.hasLastResult(),
            onScan: () => controller.newPhoto(),
            onReader: () => controller.showLastResult(),
            onCards: () => comingSoon("Cards"),
            onProfile: drawer.open,
          }),
        ];
  root.replaceChildren(
    h(
      "div",
      { class: "app-viewport-container" },
      header,
      h("main", { class: "content" }, screenFor(state)),
      ...nav,
      drawer.element,
      toaster.element,
    ),
  );
}

applyUiScale();
// Only the root font size changes on rotation or resize; the screen itself is not rebuilt, so the
// open tab, selection and sheet survive the URL bar showing or hiding.
window.addEventListener("resize", () => applyUiScale());
controller.subscribe(render);
render(controller.getState());
