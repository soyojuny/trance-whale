import "client-only";

import {
  PublicErrorSchema,
  SourceContractError,
  toPublicError,
  type PublicError,
} from "../errors";
import {
  type CachedChapterTranslationResult,
  type ExecuteCachedChapterTranslationRequest,
  type PreparedCachedChapterTranslation,
} from "../translation/cached-pipeline.client";
import type { SourceClient } from "../../services/source-client.client";
import type { SourceCache } from "../../services/source-cache.client";
import type { Preferences } from "../../services/preferences.client";
import { ChapterSourceSchema, SourceRequestSchema, type ChapterSource } from "../../types/source";
import type { TranslationParagraph, TranslationProgress } from "../../types/translation";

type SessionContent = {
  chapter: ChapterSource;
  translations: TranslationParagraph[];
  completedParagraphs: number;
  totalParagraphs: number;
  failedChunkIds: string[];
};

export type ReaderSessionState =
  | { status: "idle" }
  | { status: "fetching_source"; url: string }
  | ({ status: "parsing_response" } & SessionContent)
  | ({ status: "checking_cache" } & SessionContent)
  | ({ status: "translating" } & SessionContent)
  | ({ status: "complete"; cache: CachedChapterTranslationResult["cache"] } & SessionContent)
  | ({ status: "partial_failure"; errors: CachedChapterTranslationResult["errors"] } & SessionContent)
  | { status: "cancelled" }
  | { status: "failed"; error: PublicError };

export type ReaderSessionAction =
  | { type: "fetch_source"; url: string }
  | { type: "source_received"; chapter: ChapterSource }
  | { type: "check_cache" }
  | { type: "translation_progress"; progress: TranslationProgress }
  | { type: "translation_finished"; result: CachedChapterTranslationResult }
  | { type: "cancel" }
  | { type: "fail"; error: PublicError };

const EMPTY_TRANSLATIONS = {
  translations: [] as TranslationParagraph[],
  completedParagraphs: 0,
  failedChunkIds: [] as string[],
};

function hasChapter(state: ReaderSessionState): state is ReaderSessionState & SessionContent {
  return "chapter" in state;
}

function orderedTranslations(
  chapter: ChapterSource,
  translations: TranslationParagraph[],
): TranslationParagraph[] {
  const byId = new Map(translations.map((paragraph) => [paragraph.id, paragraph]));
  return chapter.paragraphs.flatMap(({ id }) => {
    const paragraph = byId.get(id);
    return paragraph ? [paragraph] : [];
  });
}

function contentFromProgress(
  state: ReaderSessionState & SessionContent,
  progress: TranslationProgress,
): SessionContent {
  const translations = orderedTranslations(state.chapter, progress.translations);
  return {
    chapter: state.chapter,
    translations,
    completedParagraphs: translations.length,
    totalParagraphs: state.chapter.paragraphs.length,
    failedChunkIds: progress.failedChunkIds,
  };
}

export function readerSessionReducer(
  state: ReaderSessionState,
  action: ReaderSessionAction,
): ReaderSessionState {
  switch (action.type) {
    case "fetch_source":
      return { status: "fetching_source", url: action.url };
    case "source_received":
      return {
        status: "parsing_response",
        chapter: action.chapter,
        ...EMPTY_TRANSLATIONS,
        totalParagraphs: action.chapter.paragraphs.length,
      };
    case "check_cache":
      return hasChapter(state) ? { ...state, status: "checking_cache" } : state;
    case "translation_progress": {
      if (!hasChapter(state)) return state;
      const content = contentFromProgress(state, action.progress);
      if (action.progress.status === "cancelled") return { status: "cancelled" };
      if (action.progress.status === "failed") {
        return {
          status: "failed",
          error: safeError(undefined, "translation"),
        };
      }
      if (action.progress.status === "complete") {
        return { status: "complete", cache: "miss", ...content };
      }
      if (action.progress.status === "partial_failure") {
        return { status: "partial_failure", errors: [], ...content };
      }
      return { status: "translating", ...content };
    }
    case "translation_finished": {
      if (!hasChapter(state)) return state;
      const content = contentFromProgress(state, action.result.progress);
      if (action.result.progress.status === "cancelled") return { status: "cancelled" };
      if (action.result.progress.status === "partial_failure") {
        return { status: "partial_failure", errors: action.result.errors, ...content };
      }
      if (action.result.progress.status === "complete") {
        return { status: "complete", cache: action.result.cache, ...content };
      }
      if (action.result.progress.status === "failed") {
        return {
          status: "failed",
          error: action.result.errors[0] ?? safeError(undefined, "translation"),
        };
      }
      return { status: "translating", ...content };
    }
    case "cancel":
      return { status: "cancelled" };
    case "fail":
      return { status: "failed", error: action.error };
  }
}

type PreparePipeline = (request: {
  chapter: ChapterSource;
  mode: Preferences["translation"]["translationMode"];
  userPrompt: string;
}) => Promise<PreparedCachedChapterTranslation>;

type ReaderSessionDependencies = {
  sourceClient: SourceClient;
  sourceCache: Pick<SourceCache, "get" | "put">;
  networkAvailable: () => boolean;
  preparePipeline: PreparePipeline;
  loadTranslationSettings: () => Preferences["translation"];
  onStateChange?: (state: ReaderSessionState) => void;
};

export type ReaderSessionController = {
  getState(): ReaderSessionState;
  openChapter(url: string): Promise<void>;
  cancel(): void;
  forceReload(): Promise<void>;
  forceRetranslate(): Promise<void>;
  retryFailedTranslation(): Promise<void>;
};

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function safeError(error: unknown, boundary: "source" | "translation"): PublicError {
  if (typeof error === "object" && error !== null && "toJSON" in error && typeof error.toJSON === "function") {
    const parsed = PublicErrorSchema.safeParse(error.toJSON());
    if (parsed.success) return parsed.data;
  }
  const parsed = PublicErrorSchema.safeParse(error);
  if (parsed.success) return parsed.data;
  return boundary === "source"
    ? { code: "SOURCE_UNREACHABLE", message: "원본 사이트에 연결할 수 없습니다.", retryable: true }
    : { code: "TRANSLATION_FAILED", message: "번역을 완료할 수 없습니다.", retryable: true };
}

function normalizeChapterUrl(input: string): string | undefined {
  const parsed = SourceRequestSchema.safeParse({ url: input });
  if (!parsed.success) return undefined;

  const url = new URL(parsed.data.url);
  url.hash = "";
  return url.href;
}

function offlineError(): PublicError {
  return toPublicError(new SourceContractError("OFFLINE"));
}

export function createReaderSessionController(
  dependencies: ReaderSessionDependencies,
): ReaderSessionController {
  let state: ReaderSessionState = { status: "idle" };
  let generation = 0;
  let activeController: AbortController | undefined;
  let currentUrl: string | undefined;
  let currentChapter: ChapterSource | undefined;
  let prepared: PreparedCachedChapterTranslation | undefined;

  const dispatch = (action: ReaderSessionAction) => {
    state = readerSessionReducer(state, action);
    dependencies.onStateChange?.(state);
  };

  const isCurrent = (operation: number) => operation === generation;

  const executeTranslation = async (
    operation: number,
    task: PreparedCachedChapterTranslation,
    apiKey: string,
    execution: ExecuteCachedChapterTranslationRequest,
  ) => {
    if (isCurrent(operation) && hasChapter(state)) {
      dispatch({
        type: "translation_progress",
        progress: {
          status: "translating",
          completedParagraphs: state.completedParagraphs,
          totalParagraphs: state.totalParagraphs,
          translations: state.translations,
          failedChunkIds: state.failedChunkIds,
        },
      });
    }
    try {
      const translationResult = await task.execute({
        apiKey,
        signal: activeController?.signal,
        ...execution,
        onProgress: (progress) => {
          if (isCurrent(operation) && progress.status === "translating") {
            dispatch({ type: "translation_progress", progress });
          }
        },
      });
      if (isCurrent(operation)) {
        dispatch({ type: "translation_finished", result: translationResult });
        activeController = undefined;
      }
    } catch (error) {
      if (!isCurrent(operation)) return;
      if (isAbortError(error) || activeController?.signal.aborted) dispatch({ type: "cancel" });
      else dispatch({ type: "fail", error: safeError(error, "translation") });
      activeController = undefined;
    }
  };

  const openChapter = async (url: string, forceReload = false): Promise<void> => {
    activeController?.abort();
    const operation = ++generation;
    activeController = new AbortController();
    currentUrl = url;
    currentChapter = undefined;
    prepared = undefined;
    dispatch({ type: "fetch_source", url });

    if (!dependencies.networkAvailable()) {
      if (forceReload) {
        dispatch({ type: "fail", error: offlineError() });
        activeController = undefined;
        return;
      }

      const normalizedUrl = normalizeChapterUrl(url);
      if (!normalizedUrl) {
        dispatch({ type: "fail", error: toPublicError(new SourceContractError("INVALID_URL")) });
        activeController = undefined;
        return;
      }

      let cachedChapter: ChapterSource | undefined;
      try {
        const cached = await dependencies.sourceCache.get(normalizedUrl);
        if (cached.status === "hit") {
          const parsed = ChapterSourceSchema.safeParse(cached.chapter);
          if (parsed.success) cachedChapter = parsed.data;
        }
      } catch {
        // Source cache availability must not leak storage errors into public state.
      }
      if (!isCurrent(operation)) return;
      if (!cachedChapter) {
        dispatch({ type: "fail", error: offlineError() });
        activeController = undefined;
        return;
      }

      currentChapter = cachedChapter;
      dispatch({ type: "source_received", chapter: cachedChapter });
      dispatch({ type: "check_cache" });
      const settings = dependencies.loadTranslationSettings();
      try {
        prepared = await dependencies.preparePipeline({
          chapter: cachedChapter,
          mode: settings.translationMode,
          userPrompt: settings.userPrompt,
        });
        const cachedTranslation = await prepared.getCached();
        if (!isCurrent(operation)) return;
        if (!cachedTranslation) {
          dispatch({ type: "fail", error: offlineError() });
          activeController = undefined;
          return;
        }
        dispatch({ type: "translation_finished", result: cachedTranslation });
        activeController = undefined;
      } catch {
        if (isCurrent(operation)) {
          dispatch({ type: "fail", error: offlineError() });
          activeController = undefined;
        }
      }
      return;
    }

    let chapter: ChapterSource;
    try {
      const fetched = await dependencies.sourceClient.fetchChapter(url, activeController.signal);
      const parsed = ChapterSourceSchema.safeParse(fetched);
      if (!parsed.success) {
        dispatch({ type: "fail", error: toPublicError(new SourceContractError("EXTRACTION_FAILED")) });
        activeController = undefined;
        return;
      }
      chapter = parsed.data;
    } catch (error) {
      if (!isCurrent(operation)) return;
      if (isAbortError(error) || activeController?.signal.aborted) dispatch({ type: "cancel" });
      else dispatch({ type: "fail", error: safeError(error, "source") });
      activeController = undefined;
      return;
    }
    if (!isCurrent(operation)) return;

    currentChapter = chapter;
    dispatch({ type: "source_received", chapter });
    void dependencies.sourceCache.put(chapter).catch(() => undefined);
    dispatch({ type: "check_cache" });
    const settings = dependencies.loadTranslationSettings();
    try {
      prepared = await dependencies.preparePipeline({
        chapter,
        mode: settings.translationMode,
        userPrompt: settings.userPrompt,
      });
    } catch (error) {
      if (isCurrent(operation)) {
        dispatch({ type: "fail", error: safeError(error, "translation") });
        activeController = undefined;
      }
      return;
    }
    if (!isCurrent(operation)) return;
    await executeTranslation(operation, prepared, settings.apiKey, {});
  };

  const rerunTranslation = async (
    reprepare: boolean,
    retryFailed?: { failedChunkIds: readonly string[]; successfulTranslations: TranslationProgress["translations"] },
  ): Promise<void> => {
    if (!currentChapter || !prepared) return;
    activeController?.abort();
    const operation = ++generation;
    activeController = new AbortController();
    dispatch({ type: "check_cache" });
    const settings = dependencies.loadTranslationSettings();
    if (reprepare) {
      try {
        prepared = await dependencies.preparePipeline({
          chapter: currentChapter,
          mode: settings.translationMode,
          userPrompt: settings.userPrompt,
        });
      } catch (error) {
        if (isCurrent(operation)) {
          dispatch({ type: "fail", error: safeError(error, "translation") });
          activeController = undefined;
        }
        return;
      }
    }
    const execution = retryFailed
      ? { retryFailed }
      : reprepare
        ? { forceRetranslate: true as const }
        : {};
    await executeTranslation(operation, prepared, settings.apiKey, execution);
  };

  return {
    getState: () => state,
    openChapter,
    cancel: () => {
      if (!activeController || activeController.signal.aborted) return;
      ++generation;
      activeController.abort();
      dispatch({ type: "cancel" });
    },
    forceReload: async () => {
      if (currentUrl) await openChapter(currentUrl, true);
    },
    forceRetranslate: () => rerunTranslation(true),
    retryFailedTranslation: async () => {
      if (state.status === "partial_failure") {
        await rerunTranslation(false, {
          failedChunkIds: state.failedChunkIds,
          successfulTranslations: state.translations,
        });
      }
    },
  };
}
