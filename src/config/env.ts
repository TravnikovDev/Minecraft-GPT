// Path: config/env.ts

import { config } from "dotenv";

config();

// Environment Variables
export const SERVER_HOST = process.env["SERVER_HOST"] || "localhost";
export const SERVER_PORT = parseInt(process.env["SERVER_PORT"] || "1024", 10);
export const OPENAI_API_KEY = process.env["OPENAI_API_KEY"];

if (!OPENAI_API_KEY) {
  throw new Error("Missing required environment variable: OPENAI_API_KEY");
}
