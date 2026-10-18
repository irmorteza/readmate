import { describe, expect, it } from "vitest";
import { shortSha } from "./build-info";

describe("shortSha", () => {
  it("defaults to dev when the build SHA is missing or blank", () => {
    expect(shortSha(undefined)).toBe("dev");
    expect(shortSha("")).toBe("dev");
    expect(shortSha("   ")).toBe("dev");
  });

  it("keeps the first 7 characters of a full commit SHA", () => {
    expect(shortSha("0123456789abcdef0123")).toBe("0123456");
  });

  it("leaves short values untouched", () => {
    expect(shortSha("dev")).toBe("dev");
    expect(shortSha("abc")).toBe("abc");
  });
});
