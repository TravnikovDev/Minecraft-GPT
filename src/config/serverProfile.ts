// Path: src/config/serverProfile.ts
// The server's rules for bots (Phase 8, server courtesy), from .env:
// - SERVER_AUTOMATION: "forbidden" on servers that don't allow bots to act
//   on their own: no own life ("go live your life") and no jobs; it only
//   does what the owner asks, one command at a time.
// - SERVER_CHAT_SPACING_MS: the time between its chat lines.
// PvP is never part of it: the bot never fights players (the guard's
// never-list, the combat reflex's hostile-only targets). Refused blocks
// already mark keep-out areas instead of retrying (core/forbidden).

import { SERVER_AUTOMATION, SERVER_CHAT_SPACING_MS } from "./env";

/** True when the server lets the bot act on its own. */
export const automationAllowed = (): boolean => SERVER_AUTOMATION === "allowed";

/** Milliseconds between its chat lines on this server. */
export const chatSpacingMs = (): number => SERVER_CHAT_SPACING_MS;
