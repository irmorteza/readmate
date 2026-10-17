import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, saveToken } from "./settings";

beforeEach(() => {
  localStorage.clear();
  clearToken();
});
afterEach(() => vi.restoreAllMocks());

describe("token settings", () => {
  it("trims surrounding whitespace and newlines before saving", () => {
    expect(saveToken("  abc123\n")).toBe("abc123");
    expect(getToken()).toBe("abc123");
    expect(localStorage.getItem("worttap.token")).toBe("abc123");
  });

  it("rejects a whitespace-only token without saving", () => {
    expect(saveToken(" \n\t")).toBeNull();
    expect(getToken()).toBeNull();
  });

  it("returns null when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getToken()).toBeNull();
  });

  it("keeps the token in memory when localStorage writes throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(saveToken("tok")).toBe("tok");
    expect(getToken()).toBe("tok");
  });

  it("clearToken removes it", () => {
    saveToken("tok");
    clearToken();
    expect(getToken()).toBeNull();
  });
});
