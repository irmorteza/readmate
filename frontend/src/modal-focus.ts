/**
 * Focus handling shared by the word sheet and the drawer: moving focus into the dialog when it
 * opens, giving it back to whatever opened it when it closes, and closing on Escape.
 */
export interface ModalFocus {
  /** Remember the opener, focus `target`, start listening for Escape. No-op when already active. */
  activate(target: HTMLElement): void;
  /** Stop listening and return focus to the opener if it is still on the page. No-op when inactive. */
  release(): void;
}

export function createModalFocus(onEscape: () => void, dialog?: HTMLElement): ModalFocus {
  let active = false;
  let opener: HTMLElement | null = null;
  const stop = () => {
    active = false;
    document.removeEventListener("keydown", onKey);
    opener = null;
  };
  const onKey = (event: KeyboardEvent) => {
    // The screen is rebuilt on state changes; a dialog that left the page must not linger.
    if (dialog && !dialog.isConnected) return stop();
    if (event.key === "Escape") onEscape();
  };
  return {
    activate(target) {
      if (active) return;
      active = true;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.addEventListener("keydown", onKey);
      target.focus();
    },
    release() {
      if (!active) return;
      const back = opener;
      stop();
      if (back?.isConnected) back.focus();
    },
  };
}
