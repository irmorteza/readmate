import { describe, expect, it } from "vitest";
import { createScanningView } from "./scanning-view";

describe("scanning view", () => {
  it("shows the animated laser, the pill and the caption", () => {
    const view = createScanningView({});
    expect(view.querySelector(".laser")).not.toBeNull();
    expect(view.querySelector(".scan-pill")?.textContent).toBe("Extracting German words…");
    expect(view.textContent).toContain("Analyzing Page Layout & OCR");
    expect(view.querySelector(".scan-pill svg")).not.toBeNull();
  });

  it("shows the photo only when there is one", () => {
    expect(createScanningView({}).querySelector("img")).toBeNull();
    const img = createScanningView({ imageUrl: "blob:photo" }).querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:photo");
  });

  it("announces the wait politely", () => {
    expect(createScanningView({}).getAttribute("aria-live")).toBe("polite");
  });
});
