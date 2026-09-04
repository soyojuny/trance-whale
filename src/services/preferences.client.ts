import "client-only";

import {
  DEFAULT_READER_SETTINGS,
  DEFAULT_TRANSLATION_SETTINGS,
  LastReadingPositionSchema,
  ReaderSettingsSchema,
  TranslationSettingsSchema,
  type LastReadingPosition,
  type ReaderSettings,
  type TranslationSettings,
} from "../types/storage";

export const PREFERENCE_STORAGE_KEYS = {
  translation: "trance-whale:preferences:translation:v1",
  reader: "trance-whale:preferences:reader:v1",
  readingPosition: "trance-whale:reading-position:v1",
} as const;

export type Preferences = {
  translation: TranslationSettings;
  reader: ReaderSettings;
};

type StorageFailure = {
  ok: false;
  error: {
    code: "STORAGE_FULL";
    message: string;
    retryable: true;
  };
};

export type StorageResult = { ok: true } | StorageFailure;

const SETTINGS_KEYS: ReadonlySet<string> = new Set([
  PREFERENCE_STORAGE_KEYS.translation,
  PREFERENCE_STORAGE_KEYS.reader,
]);

const APP_KEYS = Object.values(PREFERENCE_STORAGE_KEYS);

function storageFailure(message: string): StorageFailure {
  return { ok: false, error: { code: "STORAGE_FULL", message, retryable: true } };
}

function parseStored<T>(storage: Storage, key: string, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): T | undefined {
  try {
    const value = storage.getItem(key);
    if (value === null) return undefined;
    const parsed = schema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function restore(storage: Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // The caller already receives a safe failure. A blocked storage cannot be repaired here.
  }
}

export function isAppPreferenceStorageKey(key: string | null): boolean {
  return key !== null && SETTINGS_KEYS.has(key);
}

export function loadPreferences(storage: Storage = globalThis.localStorage): Preferences {
  const translation = parseStored(storage, PREFERENCE_STORAGE_KEYS.translation, TranslationSettingsSchema);
  const reader = parseStored(storage, PREFERENCE_STORAGE_KEYS.reader, ReaderSettingsSchema);

  return {
    translation: translation ?? { ...DEFAULT_TRANSLATION_SETTINGS },
    reader: reader ?? { ...DEFAULT_READER_SETTINGS },
  };
}

export function savePreferences(
  preferences: Preferences,
  storage: Storage = globalThis.localStorage,
): StorageResult {
  const translation = TranslationSettingsSchema.safeParse(preferences.translation);
  const reader = ReaderSettingsSchema.safeParse(preferences.reader);
  if (!translation.success || !reader.success) return storageFailure("설정을 저장할 수 없습니다.");

  let serializedTranslation: string;
  let serializedReader: string;
  let previousTranslation: string | null | undefined;
  let previousReader: string | null | undefined;
  try {
    serializedTranslation = JSON.stringify(translation.data);
    serializedReader = JSON.stringify(reader.data);
    previousTranslation = storage.getItem(PREFERENCE_STORAGE_KEYS.translation);
    previousReader = storage.getItem(PREFERENCE_STORAGE_KEYS.reader);
    storage.setItem(PREFERENCE_STORAGE_KEYS.translation, serializedTranslation);
    storage.setItem(PREFERENCE_STORAGE_KEYS.reader, serializedReader);
  } catch {
    if (typeof previousTranslation !== "undefined") {
      restore(storage, PREFERENCE_STORAGE_KEYS.translation, previousTranslation);
    }
    if (typeof previousReader !== "undefined") {
      restore(storage, PREFERENCE_STORAGE_KEYS.reader, previousReader);
    }
    return storageFailure("설정을 저장할 수 없습니다.");
  }
  return { ok: true };
}

export function clearApiKey(storage: Storage = globalThis.localStorage): StorageResult {
  const current = loadPreferences(storage);
  const translation = TranslationSettingsSchema.safeParse({
    ...current.translation,
    apiKey: "",
  });
  if (!translation.success) return storageFailure("Gemini API Key를 삭제할 수 없습니다.");

  try {
    storage.setItem(PREFERENCE_STORAGE_KEYS.translation, JSON.stringify(translation.data));
    return { ok: true };
  } catch {
    return storageFailure("Gemini API Key를 삭제할 수 없습니다.");
  }
}

export function loadReadingPosition(
  storage: Storage = globalThis.localStorage,
): LastReadingPosition | null {
  return parseStored(storage, PREFERENCE_STORAGE_KEYS.readingPosition, LastReadingPositionSchema) ?? null;
}

export function saveReadingPosition(
  position: LastReadingPosition,
  storage: Storage = globalThis.localStorage,
): StorageResult {
  const parsed = LastReadingPositionSchema.safeParse(position);
  if (!parsed.success) return storageFailure("읽기 위치를 저장할 수 없습니다.");

  try {
    storage.setItem(PREFERENCE_STORAGE_KEYS.readingPosition, JSON.stringify(parsed.data));
    return { ok: true };
  } catch {
    return storageFailure("읽기 위치를 저장할 수 없습니다.");
  }
}

export function clearPreferences(storage: Storage = globalThis.localStorage): StorageResult {
  try {
    for (const key of APP_KEYS) storage.removeItem(key);
    return { ok: true };
  } catch {
    return storageFailure("저장된 설정을 삭제할 수 없습니다.");
  }
}

export function createPreferencesService(storage: Storage) {
  return {
    loadPreferences: () => loadPreferences(storage),
    savePreferences: (preferences: Preferences) => savePreferences(preferences, storage),
    clearApiKey: () => clearApiKey(storage),
    loadReadingPosition: () => loadReadingPosition(storage),
    saveReadingPosition: (position: LastReadingPosition) => saveReadingPosition(position, storage),
    clearPreferences: () => clearPreferences(storage),
  };
}
