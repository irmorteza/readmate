const MIN_RATIO = 1.25; // below this the page is "about as wide as the screen"
const MAX_SCALE = 3;

/**
 * How much to enlarge the UI. A touch device whose browser lays the page out much wider than
 * the screen (e.g. "Desktop site", about 980 px on a 412 px phone) would show everything tiny;
 * scaling the root font size by that ratio keeps the UI at its normal size on the screen.
 */
export function computeUiScale(innerWidth: number, screenWidth: number, coarse: boolean): number {
  if (!coarse || innerWidth <= 0 || screenWidth <= 0) return 1;
  const ratio = innerWidth / screenWidth;
  return ratio >= MIN_RATIO ? Math.min(ratio, MAX_SCALE) : 1;
}

const isCoarse = (win: Window) => win.matchMedia("(pointer: coarse)").matches;

/** Sets the root font size (all sizes in styles.css are rem) and returns the scale used. */
export function applyUiScale(win: Window = window): number {
  const scale = computeUiScale(win.innerWidth, win.screen.width, isCoarse(win));
  const root = win.document?.documentElement ?? document.documentElement;
  if (scale === 1) root.style.removeProperty("font-size");
  else root.style.fontSize = `${16 * scale}px`;
  return scale;
}

/** One line for the settings menu, so a layout problem can be diagnosed from a screenshot. */
export function describeViewport(win: Window = window): string {
  const scale = computeUiScale(win.innerWidth, win.screen.width, isCoarse(win));
  const touch = isCoarse(win) ? "touch" : "mouse";
  return (
    `Page ${win.innerWidth}×${win.innerHeight} · screen ${win.screen.width}×${win.screen.height}` +
    ` @${win.devicePixelRatio}x · ${touch} · UI ×${Math.round(scale * 100) / 100}`
  );
}
