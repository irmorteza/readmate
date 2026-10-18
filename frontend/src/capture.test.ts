import { describe, expect, it, vi } from "vitest";
import { createCapture } from "./capture";

function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

describe("createCapture", () => {
  it("offers a camera button and a gallery button with icons", () => {
    const root = document.createElement("div");
    createCapture(root, () => {});
    const inputs = root.querySelectorAll<HTMLInputElement>("input[type=file]");
    expect(inputs).toHaveLength(2);
    expect([...inputs].map((i) => i.getAttribute("capture"))).toEqual(["environment", null]);
    expect([...inputs].every((i) => i.accept === "image/*")).toBe(true);
    const buttons = [...root.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Scan Page with Camera",
      "Upload from Gallery",
    ]);
    expect(buttons[0].classList.contains("primary")).toBe(true);
    expect(buttons[1].classList.contains("secondary")).toBe(true);
    expect(buttons.every((b) => b.querySelector("svg"))).toBe(true);
  });

  it("calls onFile with the picked file from either input", () => {
    const root = document.createElement("div");
    const onFile = vi.fn();
    createCapture(root, onFile);
    const [camera, gallery] = root.querySelectorAll<HTMLInputElement>("input[type=file]");
    const a = new File(["a"], "a.jpg");
    const b = new File(["b"], "b.jpg");
    pick(camera, a);
    pick(gallery, b);
    expect(onFile.mock.calls.map((c) => c[0])).toEqual([a, b]);
  });
});
