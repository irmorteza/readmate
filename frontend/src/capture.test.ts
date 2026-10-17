import { describe, expect, it, vi } from "vitest";
import { createCapture } from "./capture";

function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

describe("createCapture", () => {
  it("offers Take photo (camera) and Choose photo (gallery) inputs", () => {
    const root = document.createElement("div");
    createCapture(root, () => {});
    const inputs = root.querySelectorAll<HTMLInputElement>("input[type=file]");
    expect(inputs).toHaveLength(2);
    expect([...inputs].map((i) => i.getAttribute("capture"))).toEqual(["environment", null]);
    expect([...inputs].every((i) => i.accept === "image/*")).toBe(true);
    expect([...root.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Take photo",
      "Choose photo",
    ]);
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
