import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Channel, MessageHandler, IncomingMessage, Attachment } from "./channel.js";
import type { Transcriber } from "../transcription/transcriber.js";
import { createLogger } from "../logger.js";

const log = createLogger("telegram");
import { EXIT_RESTART, EXIT_UPDATE } from "../exit-codes.js";
import { getPendingRestart, scheduleRestart } from "../restart-signal.js";
import type { ApprovalGate } from "../security/approval-gate.js";

const UPLOADS_DIR = "./data/uploads";
mkdirSync(UPLOADS_DIR, { recursive: true });

export class TelegramChannel implements Channel {
  name = "telegram";
  private bot: Bot;
  private allowedUserIds: Set<number>;
  private approvalGate: ApprovalGate | null = null;
  private transcriber: Transcriber | null = null;

  constructor(token: string, allowedUserIds: number[]) {
    this.bot = new Bot(token);
    this.allowedUserIds = new Set(allowedUserIds);
  }

  setApprovalGate(gate: ApprovalGate): void {
    this.approvalGate = gate;
  }

  setTranscriber(transcriber: Transcriber): void {
    this.transcriber = transcriber;
  }

  async sendApprovalMessage(userId: string, text: string, approvalId: string): Promise<void> {
    const numericUserId = parseInt(userId, 10);
    const kb = new InlineKeyboard()
      .text("Aprobar", `approve:${approvalId}`)
      .text("Denegar", `deny:${approvalId}`);
    await this.bot.api.sendMessage(numericUserId, text, {
      reply_markup: kb,
      parse_mode: "Markdown",
    });
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    const numericUserId = parseInt(userId, 10);
    await this.bot.api.sendMessage(numericUserId, text, { parse_mode: "Markdown" }).catch(() => {
      this.bot.api.sendMessage(numericUserId, text).catch(() => {});
    });
  }

  async start(handler: MessageHandler): Promise<void> {
    // Direct commands (bypass agent loop)
    this.bot.command("restart", async (ctx) => {
      const userId = ctx.from!.id;
      if (!this.allowedUserIds.has(userId)) return;
      await ctx.reply("Reiniciando...");
      scheduleRestart(EXIT_RESTART);
      setTimeout(() => process.exit(EXIT_RESTART), 500);
    });

    this.bot.command("update", async (ctx) => {
      const userId = ctx.from!.id;
      if (!this.allowedUserIds.has(userId)) return;
      await ctx.reply("Actualizando y reiniciando...");
      scheduleRestart(EXIT_UPDATE);
      setTimeout(() => process.exit(EXIT_UPDATE), 500);
    });

    // Text messages
    this.bot.on("message:text", async (ctx) => {
      await this.handleIncoming(ctx, ctx.message.text, [], handler);
    });

    // Photo messages
    this.bot.on("message:photo", async (ctx) => {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const caption = ctx.message.caption || "Subí esta imagen a Drive";

      try {
        const file = await ctx.api.getFile(largest.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());

        const fileName = `photo_${Date.now()}.jpg`;
        const filePath = join(UPLOADS_DIR, fileName);
        writeFileSync(filePath, buffer);

        const attachment: Attachment = { filePath, fileName };
        await this.handleIncoming(ctx, caption, [attachment], handler);
      } catch (err) {
        log.error({ error: (err as Error).message }, "error downloading photo");
        await ctx.reply("No pude descargar la imagen. Intentá de nuevo.");
      }
    });

    // Document messages (for images sent as files)
    this.bot.on("message:document", async (ctx) => {
      const doc = ctx.message.document;
      const mimeType = doc.mime_type || "";
      const caption = ctx.message.caption || "Subí este archivo a Drive";

      if (!mimeType.startsWith("image/") && !mimeType.startsWith("application/pdf")) {
        // Only handle images and PDFs for now
        await this.handleIncoming(ctx, caption, [], handler);
        return;
      }

      try {
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());

        const fileName = doc.file_name || `file_${Date.now()}`;
        const filePath = join(UPLOADS_DIR, fileName);
        writeFileSync(filePath, buffer);

        const attachment: Attachment = { filePath, fileName };
        await this.handleIncoming(ctx, caption, [attachment], handler);
      } catch (err) {
        log.error({ error: (err as Error).message }, "error downloading document");
        await ctx.reply("No pude descargar el archivo. Intentá de nuevo.");
      }
    });

    // Voice + audio messages
    if (this.transcriber) {
      const transcriber = this.transcriber;

      this.bot.on("message:voice", async (ctx) => {
        const voice = ctx.message.voice;
        const duration = voice.duration;

        try {
          const file = await ctx.api.getFile(voice.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
          const res = await fetch(fileUrl);
          const buffer = Buffer.from(await res.arrayBuffer());

          const fileName = `voice_${Date.now()}.ogg`;
          const filePath = join(UPLOADS_DIR, fileName);
          writeFileSync(filePath, buffer);

          const result = await transcriber.transcribe(filePath);

          if (!result.text || result.text.trim().length === 0) {
            await ctx.reply("No pude entender el audio. ¿Puedes repetirlo o escribirlo?");
            return;
          }

          const durationStr = formatDuration(duration);
          const text = `[Mensaje de voz, ${durationStr}] ${result.text}`;
          await this.handleIncoming(ctx, text, [], handler);
        } catch (err) {
          log.error({ error: (err as Error).message, duration }, "error processing voice message");
          await ctx.reply("No pude procesar el mensaje de voz. Intenta de nuevo.");
        }
      });

      this.bot.on("message:audio", async (ctx) => {
        const audio = ctx.message.audio;
        const duration = audio.duration;
        const mimeType = audio.mime_type || "";
        const ext = extFromAudio(audio.file_name, mimeType);

        if (ext === null) {
          const label = mimeType || audio.file_name || "desconocido";
          await ctx.reply(`Formato de audio no soportado (${label}). Envía MP3, WAV, M4A, OGG o FLAC.`);
          return;
        }

        try {
          const file = await ctx.api.getFile(audio.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
          const res = await fetch(fileUrl);
          const buffer = Buffer.from(await res.arrayBuffer());

          const fileName = `audio_${Date.now()}.${ext}`;
          const filePath = join(UPLOADS_DIR, fileName);
          writeFileSync(filePath, buffer);

          const result = await transcriber.transcribe(filePath);

          if (!result.text || result.text.trim().length === 0) {
            await ctx.reply("No pude entender el audio. ¿Puedes reenviarlo o escribirlo?");
            return;
          }

          const durationStr = formatDuration(duration);
          const fileHint = audio.file_name ? ` (archivo: ${audio.file_name})` : "";
          const text = `[Mensaje de voz, ${durationStr}]${fileHint} ${result.text}`;
          await this.handleIncoming(ctx, text, [], handler);
        } catch (err) {
          log.error({ error: (err as Error).message, duration, mimeType }, "error processing audio message");
          await ctx.reply("No pude procesar el audio. Intenta de nuevo.");
        }
      });
    } else {
      const unavailable = async (ctx: Context) => {
        await ctx.reply("Los mensajes de voz no están disponibles. Escríbeme en texto.");
      };
      this.bot.on("message:voice", unavailable);
      this.bot.on("message:audio", unavailable);
    }

    // Approval gate callback handler (registered once at startup)
    this.bot.on("callback_query:data", async (ctx) => {
      const data = ctx.callbackQuery.data;
      const userId = ctx.from!.id;

      if (!this.allowedUserIds.has(userId)) {
        await ctx.answerCallbackQuery({ text: "Access denied." });
        return;
      }

      const [action, id] = data.split(":", 2);
      if ((action === "approve" || action === "deny") && id && this.approvalGate) {
        const approved = action === "approve";
        this.approvalGate.handleCallback(id, approved);
        await ctx.answerCallbackQuery({
          text: approved ? "Comando aprobado." : "Comando denegado.",
        });
        // Remove inline buttons from the original message
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      }
    });

    // bot.start() returns a Promise that rejects on polling errors (e.g. 409
    // Conflict when a previous instance's long-poll is still active). Catch
    // and retry instead of crashing — the conflict resolves once the old
    // poll times out (~30s). Cap retries to avoid infinite loops when two
    // instances fight for the same bot token. 20 retries × 3s = ~60s,
    // enough to survive normal restarts (~30s) with margin. On exhaustion,
    // exit with code 1 so the supervisor treats it as a crash and retries
    // with backoff — the conflict may resolve once the other instance stops.
    const MAX_POLL_RETRIES = 20;
    let pollRetries = 0;

    const startPolling = () => {
      this.bot.start({
        onStart: () => {
          log.info("Polling started successfully");
          pollRetries = 0;
        },
      }).catch((err: unknown) => {
        const msg = (err as Error).message ?? String(err);
        if (msg.includes("409")) {
          pollRetries++;
          if (pollRetries >= MAX_POLL_RETRIES) {
            log.error(`Polling conflict persists after ${MAX_POLL_RETRIES} retries — another instance likely running. Shutting down.`);
            process.exit(1);
          }
          log.warn(`Polling conflict (409), retry ${pollRetries}/${MAX_POLL_RETRIES} in 3s...`);
          setTimeout(startPolling, 3000);
        } else {
          log.error({ error: msg }, "Polling failed");
          setTimeout(startPolling, 5000);
        }
      });
    };
    startPolling();
  }

  private async handleIncoming(
    ctx: Context,
    text: string,
    attachments: Attachment[],
    handler: MessageHandler,
  ): Promise<void> {
    const userId = ctx.from!.id;

    if (!this.allowedUserIds.has(userId)) {
      log.warn({ userId }, "access denied");
      await ctx.reply("Access denied.");
      return;
    }

    const incoming: IncomingMessage = {
      userId: String(userId),
      userName: ctx.from!.first_name,
      text,
      channelId: "telegram",
      rawEvent: ctx,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    await ctx.replyWithChatAction("typing");
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);

    try {
      const response = await handler(incoming);

      // Send text response
      if (response.text) {
        const sanitized = sanitizeTelegramMarkdown(response.text);
        if (sanitized.length <= 4096) {
          await ctx.reply(sanitized, { parse_mode: "Markdown" }).catch(() =>
            ctx.reply(sanitized),
          );
        } else {
          const chunks = splitMessage(sanitized, 4096);
          for (const chunk of chunks) {
            await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() =>
              ctx.reply(chunk),
            );
          }
        }
      }

      // Send images
      if (response.images && response.images.length > 0) {
        for (const imgPath of response.images) {
          await ctx.replyWithPhoto(new InputFile(imgPath));
        }
      }
    } catch (err) {
      log.error({ error: (err as Error).message, userId: String(userId) }, "error handling message");
      await ctx.reply("Something went wrong. Please try again.");
    } finally {
      clearInterval(typingInterval);
    }

    // Check if a restart was scheduled by a tool during this request
    const pendingExit = getPendingRestart();
    if (pendingExit !== null) {
      log.info(`Pending restart detected (exit code ${pendingExit}), exiting...`);
      setTimeout(() => process.exit(pendingExit), 500);
    }
  }

  async broadcast(text: string): Promise<void> {
    for (const userId of this.allowedUserIds) {
      try {
        await this.bot.api.sendMessage(userId, text);
      } catch (err) {
        log.warn({ error: (err as Error).message }, `Failed to send broadcast to ${userId}`);
      }
    }
  }

  async stop(): Promise<void> {
    this.bot.stop();
  }
}

/**
 * Strip Markdown syntax that Telegram doesn't support, preserving code blocks
 * and inline code verbatim. Splits text into code/non-code segments and only
 * applies transformations to non-code segments.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `${min}m${sec}s` : `${min}m`;
}

/**
 * Pick a file extension for an audio upload. Prefers the extension in
 * `file_name` when present; falls back to inferring from MIME. Returns `null`
 * when neither source identifies a supported audio format — gates the audio
 * handler. `mime_type` is optional in Telegram's API, so relying on MIME alone
 * would reject valid uploads where clients send only `file_name`.
 */
function extFromAudio(fileName: string | undefined, mimeType: string): string | null {
  const nameExt = fileName?.split(".").pop()?.toLowerCase();
  if (nameExt && /^(mp3|ogg|wav|m4a|flac|webm|mp4|opus)$/.test(nameExt)) return nameExt;

  const m = mimeType.toLowerCase();
  if (!m.startsWith("audio/")) return null;
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("opus") || m.includes("ogg")) return "ogg";
  if (m.includes("wav") || m.includes("wave")) return "wav";
  if (m.includes("m4a") || m.includes("mp4")) return "m4a";
  if (m.includes("flac")) return "flac";
  if (m.includes("webm")) return "webm";
  return null;
}

function sanitizeTelegramMarkdown(text: string): string {
  // Split into segments: fenced code blocks, inline code, and prose
  const segments = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);

  return segments
    .map((segment, i) => {
      // Odd indices are code captures — leave untouched
      if (i % 2 === 1) return segment;

      return segment
        // Headings (### Title) → *Title* (bold)
        .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
        // Blockquotes (> text) → text
        .replace(/^>\s?/gm, "")
        // Horizontal rules (---, ***, ___) → empty line
        .replace(/^[-*_]{3,}\s*$/gm, "")
        // Bold **text** → *text* (Telegram uses single asterisk)
        .replace(/\*\*(.+?)\*\*/g, "*$1*");
    })
    .join("");
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
