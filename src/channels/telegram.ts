import { Bot } from "grammy";
import type { Channel, MessageHandler, IncomingMessage } from "./channel.js";
import { log } from "../logger.js";

export class TelegramChannel implements Channel {
  name = "telegram";
  private bot: Bot;
  private allowedUserIds: Set<number>;

  constructor(token: string, allowedUserIds: number[]) {
    this.bot = new Bot(token);
    this.allowedUserIds = new Set(allowedUserIds);
  }

  async start(handler: MessageHandler): Promise<void> {
    this.bot.on("message:text", async (ctx) => {
      const userId = ctx.from.id;

      if (!this.allowedUserIds.has(userId)) {
        log("warn", "telegram", "access denied", { userId });
        await ctx.reply("Access denied.");
        return;
      }

      const incoming: IncomingMessage = {
        userId: String(userId),
        userName: ctx.from.first_name,
        text: ctx.message.text,
        channelId: "telegram",
        rawEvent: ctx,
      };

      await ctx.replyWithChatAction("typing");

      try {
        const response = await handler(incoming);

        // Telegram has a 4096 char limit per message
        if (response.length <= 4096) {
          await ctx.reply(response, { parse_mode: "Markdown" }).catch(() =>
            ctx.reply(response),
          );
        } else {
          const chunks = splitMessage(response, 4096);
          for (const chunk of chunks) {
            await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() =>
              ctx.reply(chunk),
            );
          }
        }
      } catch (err) {
        log("error", "telegram", "error handling message", {
          error: (err as Error).message,
          userId: String(userId),
        });
        await ctx.reply("Something went wrong. Please try again.");
      }
    });

    this.bot.start();
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
