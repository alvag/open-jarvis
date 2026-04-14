import Groq from "groq-sdk";
import { createReadStream, statSync } from "node:fs";
import { createLogger } from "../logger.js";

const log = createLogger("transcriber");

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
    this.client = new Groq({ apiKey });
    this.defaultLanguage = defaultLanguage;
  }

  async transcribe(filePath: string, language?: string): Promise<TranscriptionResult> {
    const lang = language || this.defaultLanguage;
    const fileSize = statSync(filePath).size;

    log.info({ filePath, fileSize, language: lang }, "transcribing audio");

    try {
      const response = await this.client.audio.transcriptions.create({
        model: "whisper-large-v3-turbo",
        file: createReadStream(filePath),
        language: lang,
      });

      const text = response.text || "";
      log.info({ textLength: text.length }, "transcription complete");

      return { text };
    } catch (err) {
      log.error({ error: (err as Error).message, filePath }, "transcription failed");
      return { text: "" };
    }
  }
}
