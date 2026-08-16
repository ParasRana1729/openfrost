import { Bot } from "grammy";
import { fileURLToPath } from "node:url";
import { getTelegramEnv } from "./env.js";

export function createTelegramBot(token?: string) {
  const env = getTelegramEnv();
  const botToken = token ?? env.OPENFROST_TELEGRAM_TOKEN;

  if (!botToken) {
    return {
      env,
      bot: null,
      mode: "scaffold" as const,
    };
  }

  const bot = new Bot(botToken);
  bot.command("start", async (context) => {
    await context.reply("OpenFrost Telegram scaffold is online.");
  });

  return {
    env,
    bot,
    mode: "live" as const,
  };
}

export async function startTelegramBot() {
  const { bot, env, mode } = createTelegramBot();

  if (mode === "scaffold") {
    process.stdout.write(
      "OpenFrost Telegram running in scaffold mode (set OPENFROST_TELEGRAM_TOKEN to enable polling).\n",
    );
    return { bot: null, env, mode };
  }

  await bot.start();
  return { bot, env, mode };
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  startTelegramBot().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    process.stderr.write(`Failed to start OpenFrost Telegram bot: ${message}\n`);
    process.exit(1);
  });
}
