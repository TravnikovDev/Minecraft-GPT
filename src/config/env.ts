// Path: src/config/env.ts
// Validated runtime configuration. Bun loads .env automatically; every
// setting is checked here once at startup so a bad value fails loudly.

import { z } from "zod";

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string({ error: "is required" }).min(1, "is required"),
  // The only player whose chat the bot obeys
  OWNER_USERNAME: z
    .string({ error: "is required: set it to your Minecraft username" })
    .regex(/^[A-Za-z0-9_]{3,16}$/, "must be a valid Minecraft username (3-16 letters, digits or _)"),
  BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{3,16}$/, "must be a valid Minecraft username (3-16 letters, digits or _)")
    .default("MinecraftGPT"),
  SERVER_HOST: z.string().min(1).default("localhost"),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(1024),
  // offline: servers with online-mode=false; microsoft: a real Minecraft account login
  AUTH: z.enum(["offline", "microsoft"]).default("offline"),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  console.error(`Invalid configuration in .env:\n${problems}\nSee .env.example.`);
  process.exit(1);
}

export const env: Env = parsed.data;

// Named exports kept for existing imports
export const SERVER_HOST = env.SERVER_HOST;
export const SERVER_PORT = env.SERVER_PORT;
export const OPENAI_API_KEY = env.OPENAI_API_KEY;
export const OWNER_USERNAME = env.OWNER_USERNAME;
export const BOT_USERNAME = env.BOT_USERNAME;
export const AUTH = env.AUTH;
