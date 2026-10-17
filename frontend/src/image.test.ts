import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { computeTargetSize, prepareImage } from "./image";

describe("computeTargetSize", () => {
  it("scales a landscape image so the long edge is 2000", () => {
    expect(computeTargetSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
  });
  it("scales a portrait image so the long edge is 2000", () => {
    expect(computeTargetSize(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });
  it("leaves small images unchanged", () => {
    expect(computeTargetSize(1000, 800)).toEqual({ width: 1000, height: 800 });
  });
  it("never returns a zero dimension", () => {
    const { width, height } = computeTargetSize(100000, 10);
    expect(width).toBe(2000);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});

function stubImage(outcome: "load" | "error", size = { w: 4000, h: 3000 }) {
  class FakeImage {
    naturalWidth = size.w;
    naturalHeight = size.h;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_: string) {
      setTimeout(() => (outcome === "load" ? this.onload?.() : this.onerror?.()));
    }
  }
  vi.stubGlobal("Image", FakeImage);
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => {};
}

describe("prepareImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects with an unreadable AppError when the browser cannot decode the file", async () => {
    stubImage("error");
    const err = await prepareImage(new File(["x"], "a.heic")).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.kind).toBe("unreadable");
  });

  it("resizes, exports JPEG 0.85, and retries at 0.7 when over 4 MB", async () => {
    stubImage("load");
    const qualities: number[] = [];
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as any;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string, q?: number) {
      qualities.push(q as number);
      expect(type).toBe("image/jpeg");
      cb(new Blob([new Uint8Array(q === 0.85 ? 5_000_000 : 900_000)]));
    } as any;
    const out = await prepareImage(new File(["x"], "a.jpg"));
    expect(qualities).toEqual([0.85, 0.7]);
    expect(out.width).toBe(2000);
    expect(out.height).toBe(1500);
    expect(out.blob.size).toBe(900_000);
  });

  it("does not retry when the first export is under 4 MB", async () => {
    stubImage("load", { w: 1000, h: 800 });
    const qualities: number[] = [];
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as any;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, _t?: string, q?: number) {
      qualities.push(q as number);
      cb(new Blob([new Uint8Array(100_000)]));
    } as any;
    await prepareImage(new File(["x"], "a.jpg"));
    expect(qualities).toEqual([0.85]);
  });
});
