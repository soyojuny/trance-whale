import "client-only";

import { z } from "zod";

import { TranslationOutputError } from "../errors";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TranslationOutputError("MALFORMED_JSON");
  }
}

/** Decodes complete SSE data events; unfinished EOF events are discarded. */
export async function* readGeminiSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let line = "";
  let data: string[] = [];
  let afterCarriageReturn = false;

  try {
    while (true) {
      const { value, done } = await reader.read().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        throw new TypeError("Gemini response stream could not be read");
      });
      const decoded = done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (const character of decoded) {
        if (afterCarriageReturn && character === "\n") {
          afterCarriageReturn = false;
          continue;
        }
        afterCarriageReturn = character === "\r";
        if (character !== "\r" && character !== "\n") {
          line += character;
          continue;
        }

        if (line === "") {
          if (data.length > 0) {
            const payload = data.join("\n");
            data = [];
            yield parseJson(payload);
          }
        } else if (line === "data" || line.startsWith("data:")) {
          const value = line.slice(5);
          data.push(value.startsWith(" ") ? value.slice(1) : value);
        }
        line = "";
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

const TextPartsEnvelopeSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({
        text: z.string().optional(),
        thought: z.boolean().optional(),
      })).optional(),
    }).optional(),
  })).optional(),
});

/** Reads only the first candidate's visible text; metadata remains with the caller. */
export function geminiTextParts(event: unknown): string[] {
  const parsed = TextPartsEnvelopeSchema.safeParse(event);
  if (!parsed.success) throw new TranslationOutputError("INVALID_SCHEMA");
  return (parsed.data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string" && part.text.length > 0)
    .map((part) => part.text as string);
}

/** Emits object candidates only. ID/order and the final contract belong to the caller. */
export function createTranslationJsonParser() {
  let text = "";
  let cursor = 0;
  let started = false;
  let state: "first" | "value" | "delimiter" | "closed" = "first";
  let objectStart = -1;
  const containers: string[] = [];
  let inString = false;
  let escaped = false;

  return {
    push(part: string): unknown[] {
      text += part;
      const candidates: unknown[] = [];
      if (!started) {
        const prefix = /^[ \t\r\n]*\{[ \t\r\n]*"translations"[ \t\r\n]*:[ \t\r\n]*\[/.exec(text);
        if (!prefix) return candidates;
        cursor = prefix[0].length;
        started = true;
      }

      for (; cursor < text.length; cursor += 1) {
        const character = text[cursor];
        if (objectStart < 0) {
          if (state === "closed") break;
          if (/[ \t\r\n]/.test(character)) continue;
          if (character === "]" && state !== "value") {
            state = "closed";
            continue;
          }
          if (state === "delimiter") {
            if (character !== ",") throw new TranslationOutputError("MALFORMED_JSON");
            state = "value";
            continue;
          }
          if (character !== "{") throw new TranslationOutputError("MALFORMED_JSON");
          objectStart = cursor;
        }

        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === "{" || character === "[") containers.push(character);
        else if (character === "}" || character === "]") {
          if (containers.pop() !== (character === "}" ? "{" : "[")) {
            throw new TranslationOutputError("MALFORMED_JSON");
          }
          if (containers.length === 0) {
            candidates.push(parseJson(text.slice(objectStart, cursor + 1)));
            objectStart = -1;
            state = "delimiter";
          }
        }
      }
      return candidates;
    },
    finish(): string {
      parseJson(text);
      return text;
    },
  };
}
