import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import HomeSettingsFlow from "../../src/components/home-settings-flow";
import { DEFAULT_READER_SETTINGS, DEFAULT_TRANSLATION_SETTINGS } from "../../src/types/storage";

function setup(overrides: Record<string, unknown> = {}) {
  const navigate = vi.fn();
  const preferences = {
    loadPreferences: vi.fn(() => ({
      translation: { ...DEFAULT_TRANSLATION_SETTINGS },
      reader: { ...DEFAULT_READER_SETTINGS },
    })),
    loadReadingPosition: vi.fn(() => null),
    savePreferences: vi.fn(() => ({ ok: true as const })),
  };
  const validateKey = vi.fn(async () => undefined);
  const localData = {
    clearAll: vi.fn(async () => ({
      preferences: { ok: true as const },
      readerDatabase: { ok: true as const },
      cacheStorage: { ok: true as const },
    })),
  };
  const props = { navigate, preferences, validateKey, localData, ...overrides };
  render(<HomeSettingsFlow {...props} />);
  return { navigate, preferences, validateKey, localData };
}

describe("HomeSettingsFlow", () => {
  it("creates encoded internal reader URLs for submission and continuing", async () => {
    const position = {
      canonicalUrl: "https://www.69shuba.com/txt/48273/32028706?private=detail",
      scrollPosition: 42,
      updatedAt: "2026-09-04T01:00:00.000Z",
    };
    const preferences = {
      loadPreferences: vi.fn(() => ({ translation: DEFAULT_TRANSLATION_SETTINGS, reader: DEFAULT_READER_SETTINGS })),
      loadReadingPosition: vi.fn(() => position),
      savePreferences: vi.fn(() => ({ ok: true as const })),
    };
    const { navigate } = setup({ preferences });

    expect(screen.getByText("마지막으로 읽던 장")).toBeInTheDocument();
    expect(screen.queryByText(/private=detail/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이어 읽기" }));
    expect(navigate).toHaveBeenCalledWith(`/read?url=${encodeURIComponent(position.canonicalUrl)}`);

    fireEvent.change(screen.getByLabelText("웹소설 장 URL"), { target: { value: "https://www.69shuba.com/txt/1/2?a=b" } });
    fireEvent.click(screen.getByRole("button", { name: "번역해서 읽기" }));
    expect(navigate).toHaveBeenLastCalledWith("/read?url=https%3A%2F%2Fwww.69shuba.com%2Ftxt%2F1%2F2%3Fa%3Db");
  });

  it("validates a changed key directly before saving the complete settings", async () => {
    const { validateKey, preferences } = setup({ onRetranslate: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const key = screen.getByLabelText("Gemini API Key");
    expect(key).toHaveAttribute("type", "password");
    fireEvent.change(key, { target: { value: "browser-secret" } });
    expect(screen.getByText("저장되지 않은 변경")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 장 다시 번역" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
    await waitFor(() => expect(validateKey).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "browser-secret",
      modelId: "gemini-3.5-flash-lite",
      signal: expect.any(AbortSignal),
    })));
    expect(preferences.savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      translation: expect.objectContaining({ apiKey: "browser-secret" }),
      reader: DEFAULT_READER_SETTINGS,
    }));
    expect(screen.getByText("저장됨 · 다음 장부터 적용")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 장 다시 번역" })).toBeEnabled();
  });

  it("preserves the draft across closing, resets key visibility, and restores focus", async () => {
    setup();
    const opener = screen.getByRole("button", { name: "설정 열기" });
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "읽기 및 번역 설정" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("본문 글자 크기")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("나만의 번역 지시"), { target: { value: "말투 유지" } });
    fireEvent.click(screen.getByRole("button", { name: "API Key 표시" }));
    expect(screen.getByLabelText("Gemini API Key")).toHaveAttribute("type", "text");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(opener).toHaveFocus());

    fireEvent.click(opener);
    expect(screen.getByLabelText("나만의 번역 지시")).toHaveValue("말투 유지");
    expect(screen.getByLabelText("Gemini API Key")).toHaveAttribute("type", "password");
  });

  it("keeps a failed draft and exposes retranslation only after explicit successful save", async () => {
    const onRetranslate = vi.fn();
    const preferences = {
      loadPreferences: vi.fn(() => ({ translation: DEFAULT_TRANSLATION_SETTINGS, reader: DEFAULT_READER_SETTINGS })),
      loadReadingPosition: vi.fn(() => null),
      savePreferences: vi.fn(() => ({ ok: false as const, error: { code: "STORAGE_FULL" as const, message: "설정을 저장할 수 없습니다.", retryable: true as const } })),
    };
    setup({ preferences, onRetranslate });
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    fireEvent.change(screen.getByLabelText("번역 모델"), { target: { value: "quality" } });
    fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("설정을 저장할 수 없습니다.");
    expect(screen.getByLabelText("번역 모델")).toHaveValue("quality");
    expect(screen.getByRole("button", { name: "현재 장 다시 번역" })).toBeDisabled();
    expect(onRetranslate).not.toHaveBeenCalled();
  });

  it("confirms reset and safely reports partial failures", async () => {
    const clearAll = vi.fn(async () => ({
      preferences: { ok: true as const },
      readerDatabase: { ok: false as const, error: { code: "STORAGE_FULL" as const, message: "저장된 읽기 데이터를 삭제할 수 없습니다.", retryable: true as const } },
      cacheStorage: { ok: true as const },
    }));
    setup({ localData: { clearAll } });
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "전체 데이터 삭제" }));
    expect(screen.getByText("앱에 저장된 설정, 읽기 데이터와 앱 캐시를 삭제할까요?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(clearAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "전체 데이터 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("읽기 데이터");
    expect(clearAll).toHaveBeenCalledTimes(1);
  });
});
