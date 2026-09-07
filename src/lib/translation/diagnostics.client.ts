import "client-only";

export type TranslationDiagnosticEvent =
  | {
    event: "attempt_started";
    runId: string;
    chunkId: string;
    attempt: number;
  }
  | {
    event: "gemini_response";
    runId: string;
    chunkId: string;
    attempt: number;
    responseId?: string;
    modelVersion?: string;
    finishReason?: string;
    candidateCount: number;
    contentPartCount: number;
    textPartCount: number;
    textLength: number;
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  }
  | {
    event: "attempt_succeeded";
    runId: string;
    chunkId: string;
    attempt: number;
    translationCount: number;
  }
  | {
    event: "attempt_failed";
    runId: string;
    chunkId: string;
    attempt: number;
    errorType: "output_contract" | "gemini" | "network" | "unknown";
    errorCode?: string;
    retryable: boolean;
    willRetry: boolean;
  }
  | {
    event: "retry_scheduled";
    runId: string;
    chunkId: string;
    attempt: number;
    delayMs: number;
  };

export type TranslationDiagnosticLogger = (event: TranslationDiagnosticEvent) => void;

let nextRunId = 1;

export function createTranslationRunId(): string {
  const runId = `translation-run-${nextRunId}`;
  nextRunId += 1;
  return runId;
}

export const consoleTranslationDiagnosticLogger: TranslationDiagnosticLogger = (event) => {
  if (process.env.NODE_ENV === "test") return;
  console.info("[translation-diagnostic]", event);
};

export function reportTranslationDiagnostic(
  logger: TranslationDiagnosticLogger,
  event: TranslationDiagnosticEvent,
): void {
  try {
    logger(event);
  } catch {
    // Diagnostics must not change translation behavior.
  }
}
