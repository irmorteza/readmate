import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHeader, watchOnlineStatus } from "./header";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function setOnline(value: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
}

describe("renderHeader", () => {
  it("shows the logo, the ReadMate title and the German assistant tagline", () => {
    const header = renderHeader({ buildSha: "abc1234" });
    expect(header.querySelector(".logo")?.textContent).toBe("RM");
    expect(header.querySelector("h1")?.textContent).toBe("ReadMate");
    expect(header.textContent).toContain("GERMAN ASSISTANT");
  });

  it("shows an Online badge when the browser is online and Offline when it is not", () => {
    setOnline(true);
    expect(renderHeader({ buildSha: "x" }).querySelector(".status")?.textContent).toContain(
      "Online",
    );
    setOnline(false);
    const offline = renderHeader({ buildSha: "x" }).querySelector(".status")!;
    expect(offline.textContent).toContain("Offline");
    expect(offline.classList.contains("offline")).toBe(true);
  });

  it("has a settings menu with Reset token and the build version when a handler is given", () => {
    const onResetToken = vi.fn();
    const header = renderHeader({ buildSha: "abc1234", onResetToken });
    expect(header.querySelector(".menu")?.textContent).toContain("Version abc1234");
    const reset = [...header.querySelectorAll("button")].find((b) => b.textContent === "Reset token");
    reset!.click();
    expect(onResetToken).toHaveBeenCalledTimes(1);
  });

  it("has no settings menu without a token to reset", () => {
    expect(renderHeader({ buildSha: "x" }).querySelector(".menu")).toBeNull();
  });
});

describe("watchOnlineStatus", () => {
  it("updates every badge on the page when the connection changes", () => {
    setOnline(true);
    document.body.append(renderHeader({ buildSha: "x" }), renderHeader({ buildSha: "y" }));
    watchOnlineStatus();
    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    const badges = [...document.querySelectorAll(".status")];
    expect(badges).toHaveLength(2);
    expect(badges.every((b) => b.textContent?.includes("Offline"))).toBe(true);
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    expect(badges.every((b) => b.textContent?.includes("Online"))).toBe(true);
  });
});

describe("diagnostics line", () => {
  it("shows the viewport diagnostics in the settings menu when given", () => {
    const header = renderHeader({
      buildSha: "abc1234",
      onResetToken: () => {},
      diagnostics: "Page 980×800 · screen 412×900 @2x · touch · UI ×2.38",
    });
    const line = header.querySelector(".menu .diagnostics");
    expect(line?.textContent).toBe("Page 980×800 · screen 412×900 @2x · touch · UI ×2.38");
  });

  it("omits it when not given", () => {
    const header = renderHeader({ buildSha: "x", onResetToken: () => {} });
    expect(header.querySelector(".diagnostics")).toBeNull();
  });
});
