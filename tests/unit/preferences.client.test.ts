import { describe, expect, it } from "vitest";

import {
  PREFERENCE_STORAGE_KEYS,
  createPreferencesService,
  isAppPreferenceStorageKey,
} from "../../src/services/preferences.client";
import {
  DEFAULT_READER_SETTINGS,
  DEFAULT_TRANSLATION_SETTINGS,
} from "../../src/types/storage";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
}

const translation = {
  apiKey: "private-test-value",
  userPrompt: "고유명사를 유지해 주세요.",
  translationMode: "quality" as const,
};
const reader = { viewMode: "both" as const, fontSize: 21, lineHeight: 1.9 };
const position = {
  canonicalUrl: "https://www.69shuba.com/txt/48273/32028706",
  scrollPosition: 480,
  updatedAt: "2026-09-04T01:00:00.000Z",
};

describe("local preferences service", () => {
  it("restores explicitly saved settings and reading position in a new instance", () => {
    const storage = new MemoryStorage();
    const first = createPreferencesService(storage);

    expect(first.savePreferences({ translation, reader })).toEqual({ ok: true });
    expect(first.saveReadingPosition(position)).toEqual({ ok: true });

    const second = createPreferencesService(storage);
    expect(second.loadPreferences()).toEqual({ translation, reader });
    expect(second.loadReadingPosition()).toEqual(position);
    expect(storage.values.size).toBe(3);
  });

  it("recovers missing, malformed, and schema-invalid values with safe defaults", () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCE_STORAGE_KEYS.translation, "not-json-private-value");
    storage.setItem(PREFERENCE_STORAGE_KEYS.reader, JSON.stringify({ viewMode: "invalid" }));
    storage.setItem(PREFERENCE_STORAGE_KEYS.readingPosition, JSON.stringify({ canonicalUrl: "secret" }));

    const service = createPreferencesService(storage);
    expect(service.loadPreferences()).toEqual({
      translation: DEFAULT_TRANSLATION_SETTINGS,
      reader: DEFAULT_READER_SETTINGS,
    });
    expect(service.loadReadingPosition()).toBeNull();
  });

  it("returns safe failures without persisting partial settings or secret details", () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCE_STORAGE_KEYS.translation, JSON.stringify(DEFAULT_TRANSLATION_SETTINGS));
    storage.setItem(PREFERENCE_STORAGE_KEYS.reader, JSON.stringify(DEFAULT_READER_SETTINGS));
    storage.setItem = (key, value) => {
      if (key === PREFERENCE_STORAGE_KEYS.reader) throw new DOMException(value, "QuotaExceededError");
      storage.values.set(key, value);
    };

    const result = createPreferencesService(storage).savePreferences({ translation, reader });

    expect(result).toEqual({ ok: false, error: { code: "STORAGE_FULL", message: "설정을 저장할 수 없습니다.", retryable: true } });
    expect(JSON.stringify(result)).not.toContain(translation.apiKey);
    expect(storage.getItem(PREFERENCE_STORAGE_KEYS.translation)).toBe(JSON.stringify(DEFAULT_TRANSLATION_SETTINGS));
    expect(storage.getItem(PREFERENCE_STORAGE_KEYS.reader)).toBe(JSON.stringify(DEFAULT_READER_SETTINGS));
  });

  it("removes only app-owned local preference keys", () => {
    const storage = new MemoryStorage();
    storage.setItem("another-app:key", "keep");
    for (const key of Object.values(PREFERENCE_STORAGE_KEYS)) storage.setItem(key, "remove");

    expect(createPreferencesService(storage).clearPreferences()).toEqual({ ok: true });
    expect(storage.getItem("another-app:key")).toBe("keep");
    for (const key of Object.values(PREFERENCE_STORAGE_KEYS)) expect(storage.getItem(key)).toBeNull();
  });

  it("removes only the API Key while preserving other preferences and reading position", () => {
    const storage = new MemoryStorage();
    const service = createPreferencesService(storage);
    service.savePreferences({ translation, reader });
    service.saveReadingPosition(position);

    expect(service.clearApiKey()).toEqual({ ok: true });
    expect(service.loadPreferences()).toEqual({
      translation: { ...translation, apiKey: "" },
      reader,
    });
    expect(service.loadReadingPosition()).toEqual(position);
  });

  it("identifies only app setting keys for cross-tab synchronization", () => {
    expect(isAppPreferenceStorageKey(PREFERENCE_STORAGE_KEYS.translation)).toBe(true);
    expect(isAppPreferenceStorageKey(PREFERENCE_STORAGE_KEYS.reader)).toBe(true);
    expect(isAppPreferenceStorageKey(PREFERENCE_STORAGE_KEYS.readingPosition)).toBe(false);
    expect(isAppPreferenceStorageKey("another-app:key")).toBe(false);
    expect(isAppPreferenceStorageKey(null)).toBe(false);
  });

  it("returns safe results when storage access and serialization fail", () => {
    const inaccessible = new MemoryStorage();
    inaccessible.getItem = () => { throw new Error("private storage detail"); };
    const service = createPreferencesService(inaccessible);
    expect(service.loadPreferences()).toEqual({
      translation: DEFAULT_TRANSLATION_SETTINGS,
      reader: DEFAULT_READER_SETTINGS,
    });
    expect(service.loadReadingPosition()).toBeNull();

    const unserializable = { ...position, toJSON: () => { throw new Error("private position"); } };
    const result = createPreferencesService(new MemoryStorage()).saveReadingPosition(unserializable);
    expect(result).toEqual({ ok: false, error: { code: "STORAGE_FULL", message: "읽기 위치를 저장할 수 없습니다.", retryable: true } });
    expect(JSON.stringify(result)).not.toContain("private position");
  });
});
