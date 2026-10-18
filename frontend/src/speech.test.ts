import { describe, expect, it } from "vitest";
import { speak, SPEECH_UNSUPPORTED_MESSAGE } from "./speech";

class FakeUtterance {
  lang = "";
  rate = 1;
  constructor(public text: string) {}
}

function fakeWindow(options: { throwOnSpeak?: boolean } = {}) {
  const calls: string[] = [];
  const spoken: FakeUtterance[] = [];
  const win = {
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      cancel: () => calls.push("cancel"),
      speak: (u: FakeUtterance) => {
        calls.push("speak");
        if (options.throwOnSpeak) throw new Error("audio busy");
        spoken.push(u);
      },
    },
  } as unknown as Window;
  return { win, calls, spoken };
}

describe("speak", () => {
  it("speaks German text slightly slowed down and reports success", () => {
    const { win, spoken } = fakeWindow();
    expect(speak("Wortschatz", "de-DE", win)).toBe(true);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("Wortschatz");
    expect(spoken[0].lang).toBe("de-DE");
    expect(spoken[0].rate).toBe(0.85);
  });

  it("defaults to German", () => {
    const { win, spoken } = fakeWindow();
    speak("Lesen", undefined, win);
    expect(spoken[0].lang).toBe("de-DE");
  });

  it("cancels a running utterance before speaking", () => {
    const { win, calls } = fakeWindow();
    speak("Lesen", "de-DE", win);
    expect(calls).toEqual(["cancel", "speak"]);
  });

  it("tapped twice quickly speaks twice without error", () => {
    const { win, calls } = fakeWindow();
    expect(speak("Lesen", "de-DE", win)).toBe(true);
    expect(speak("Lesen", "de-DE", win)).toBe(true);
    expect(calls).toEqual(["cancel", "speak", "cancel", "speak"]);
  });

  it("returns false when speech synthesis is missing", () => {
    expect(speak("Lesen", "de-DE", {} as unknown as Window)).toBe(false);
    const noUtterance = { speechSynthesis: { cancel() {}, speak() {} } } as unknown as Window;
    expect(speak("Lesen", "de-DE", noUtterance)).toBe(false);
  });

  it("returns false instead of throwing when speaking fails", () => {
    const { win } = fakeWindow({ throwOnSpeak: true });
    expect(speak("Lesen", "de-DE", win)).toBe(false);
  });

  it("does nothing for empty text", () => {
    const { win, calls } = fakeWindow();
    expect(speak("   ", "de-DE", win)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("has a user-facing message for the unsupported case", () => {
    expect(SPEECH_UNSUPPORTED_MESSAGE).toBe("Audio pronunciation is not supported in this browser");
  });
});
