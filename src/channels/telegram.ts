import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Channel, MessageHandler, IncomingMessage, Attachment } from "./channel.js";
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

  constructor(token: string, allowedUserIds: number[]) {
    this.bot = new Bot(token);
    this.allowedUserIds = new Set(allowedUserIds);
  }

  setApprovalGate(gate: ApprovalGate): void {
    this.approvalGate = gate;
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
        if (response.text.length <= 4096) {
          await ctx.reply(response.text, { parse_mode: "Markdown" }).catch(() =>
            ctx.reply(response.text),
          );
        } else {
          const chunks = splitMessage(response.text, 4096);
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
