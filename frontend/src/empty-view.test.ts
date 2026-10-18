import { describe, expect, it, vi } from "vitest";
import { createEmptyView } from "./empty-view";

function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

describe("empty view", () => {
  it("shows the hero, the Instant OCR tag, the title and the description", () => {
    const view = createEmptyView({ onFile: () => {} });
    expect(view.querySelector("h2")?.textContent).toBe("Snap, Read & Learn");
    expect(view.querySelector(".hero svg")).not.toBeNull();
    expect(view.querySelector(".tag")?.textContent).toContain("Instant OCR");
    expect(view.textContent).toContain("Take a photo of any book page or document.");
  });

  it("offers the camera and the gallery, and passes the picked file on", () => {
    const onFile = vi.fn();
    const view = createEmptyView({ onFile });
    const [camera, gallery] = view.querySelectorAll<HTMLInputElement>("input[type=file]");
    expect(camera.getAttribute("capture")).toBe("environment");
    expect(gallery.getAttribute("capture")).toBeNull();
    const a = new File(["a"], "a.jpg");
    const b = new File(["b"], "b.jpg");
    pick(camera, a);
    pick(gallery, b);
    expect(onFile.mock.calls.map((c) => c[0])).toEqual([a, b]);
    expect([...view.querySelectorAll("button")].map((x) => x.textContent)).toEqual([
      "Scan Page with Camera",
      "Upload from Gallery",
    ]);
  });
});
