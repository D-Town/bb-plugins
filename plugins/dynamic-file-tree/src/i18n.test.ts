// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createTranslator, detectLocale, formatMtime, resolveLocale, resolveLocalePreference } from "./i18n";

afterEach(() => {
  document.documentElement.lang = "";
});

describe("locale selection", () => {
  it.each([
    ["en", "en"],
    ["en-US", "en"],
    ["de", "de"],
    ["de-DE", "de"],
    ["fr-FR", "en"],
    ["", "en"],
    [null, "en"],
  ] as const)("normalizes %j to %s", (language, expected) => {
    expect(resolveLocale(language)).toBe(expected);
  });

  it("prefers the host document language when it is available", () => {
    document.documentElement.lang = "de-DE";
    expect(detectLocale()).toBe("de");
  });

  it("allows an explicit language preference to override the host locale", () => {
    expect(resolveLocalePreference("en", "de")).toBe("en");
    expect(resolveLocalePreference("de", "en")).toBe("de");
    expect(resolveLocalePreference("auto", "de")).toBe("de");
  });
});

describe("translations", () => {
  it("provides complete English and German core labels", () => {
    expect(createTranslator("en").items(3)).toBe("3 items");
    expect(createTranslator("de").items(3)).toBe("3 Elemente");
    expect(createTranslator("en").settings).toBe("File tree settings");
    expect(createTranslator("de").settings).toBe("Dateibaum-Einstellungen");
  });

  it("formats relative modification times in the selected locale", () => {
    const now = 1_700_000_000_000;
    expect(formatMtime(now - 2 * 60_000, "en", now)).toContain("2");
    expect(formatMtime(now - 2 * 60_000, "en", now)).toMatch(/ago|minutes?/i);
    expect(formatMtime(now - 2 * 60_000, "de", now)).toContain("2");
    expect(formatMtime(now - 2 * 60_000, "de", now)).toMatch(/vor|Min\./i);
  });
});
