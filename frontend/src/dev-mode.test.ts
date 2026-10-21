import { afterEach, expect, it, vi } from "vitest";
import { getDevMode, setDevMode, subscribeDevMode } from "./dev-mode";

afterEach(() => {
  vi.restoreAllMocks();
  setDevMode(false);
  localStorage.clear();
});

it("is off by default", () => expect(getDevMode()).toBe(false));

it("persists '1' when on and removes the key when off", () => {
  setDevMode(true);
  expect(localStorage.getItem("readmate.devMode")).toBe("1");
  expect(getDevMode()).toBe(true);
  setDevMode(false);
  expect(localStorage.getItem("readmate.devMode")).toBeNull();
});

it("reads a stored value", () => {
  localStorage.setItem("readmate.devMode", "1");
  expect(getDevMode()).toBe(true);
});

it("keeps the value in memory when localStorage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  setDevMode(true);
  expect(getDevMode()).toBe(true);
});

it("notifies subscribers until they unsubscribe", () => {
  const seen: boolean[] = [];
  const off = subscribeDevMode((on) => seen.push(on));
  setDevMode(true);
  off();
  setDevMode(false);
  expect(seen).toEqual([true]);
});
