import Groq from "groq-sdk";
import { createReadStream, statSync } from "node:fs";
import { createLogger } from "../logger.js";

const log = createLogger("transcriber");

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read the `retry-after` header from Groq SDK errors. The SDK exposes
 * `err.headers` as a Fetch `Headers` object, so bracket-access returns
 * undefined. Fall back to plain-record access defensively for future SDK
 * versions or other runtimes.
 */
function readRetryAfter(headers: unknown): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get("retry-after") ?? undefined;
  }
  const record = headers as Record<string, string | undefined>;
  return record["retry-after"] ?? record["Retry-After"];
}

export interface TranscriptionResult {
  text: string;
  language?: string;
}

export interface Transcriber {
  transcribe(filePath: string, language?: string): Promise<TranscriptionResult>;
}

export class GroqTranscriber implements Transcriber {
  private client: Groq;
  private defaultLanguage: string;

  constructor(apiKey: string, defaultLanguage: string) {
    this.client = new Groq({ apiKey, maxRetries: 0 });
    this.defaultLanguage = defaultLanguage;
  }

  async transcribe(filePath: string, language?: string): Promise<TranscriptionResult> {
    const lang = language || this.defaultLanguage;
    const fileSize = statSync(filePath).size;

    log.info({ filePath, fileSize, language: lang }, "transcribing audio");

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.audio.transcriptions.create({
          model: "whisper-large-v3-turbo",
          file: createReadStream(filePath),
          language: lang,
        });

        const text = response.text || "";
        log.info({ textLength: text.length, attempt: attempt + 1 }, "transcription complete");
        return { text };
      } catch (err) {
        const status = (err as { status?: number }).status;
        // Retry on known-transient HTTP codes, and on transport errors (no
        // status: network hiccup, timeout, socket reset, AbortError). These
        // are the cases Groq's SDK used to recover from internally before we
        // set `maxRetries: 0` to own the backoff — keep that coverage.
        const retryable =
          status === undefined ? true : RETRYABLE_STATUSES.has(status);

        if (!retryable || attempt === MAX_RETRIES) {
          log.error({ error: (err as Error).message, filePath, status, attempts: attempt + 1 }, "transcription failed");
          return { text: "" };
        }

        let delayMs: number;
        const retryAfter = readRetryAfter((err as { headers?: unknown }).headers);
        if (status === 429 && retryAfter) {
          delayMs = (parseInt(retryAfter, 10) || 1) * 1000;
        } else {
          delayMs = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
        }

        log.warn(
          { attempt: attempt + 1, maxRetries: MAX_RETRIES, status, delayMs: Math.round(delayMs) },
          `Transcription retrying in ${Math.round(delayMs)}ms`,
        );
        await sleep(delayMs);
      }
    }

    return { text: "" };
  }
}
