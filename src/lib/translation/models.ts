import { z } from "zod";

export const TranslationModeSchema = z.enum(["fast", "quality"]);
export type TranslationMode = z.infer<typeof TranslationModeSchema>;

type TranslationModel = {
  readonly mode: TranslationMode;
  readonly modelId: string;
  readonly label: string;
  readonly speedDescription: string;
  readonly qualityDescription: string;
  readonly costDescription: string;
};

export const TRANSLATION_MODELS = {
  fast: {
    mode: "fast",
    modelId: "gemini-3.5-flash-lite",
    label: "빠른 번역",
    speedDescription: "속도와 대량 번역을 우선합니다.",
    qualityDescription: "일상적인 번역 품질에 적합합니다.",
    costDescription: "무료 할당량을 우선하지만 사용 조건에 따라 비용이 발생할 수 있습니다.",
  },
  quality: {
    mode: "quality",
    modelId: "gemini-3.7-flash",
    label: "고품질 번역",
    speedDescription: "빠른 번역보다 응답이 느릴 수 있습니다.",
    qualityDescription: "문체, 문맥과 지시사항 준수를 우선합니다.",
    costDescription: "프로젝트와 할당량 상태에 따라 무료 또는 유료로 동작할 수 있습니다.",
  },
} as const satisfies Record<TranslationMode, TranslationModel>;

export const DEFAULT_TRANSLATION_MODE: TranslationMode = "fast";
