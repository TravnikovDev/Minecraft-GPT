// Path: src/core/pace.ts
// Window clicks (chests, furnaces, crafting) are paced: servers like Paper
// kick players who click faster than about 500 times in 7 seconds, and a
// single transfer or craft is several clicks.

const CLICK_GAP_MS = 120;
let lastClickAt = 0;

/** Waits so window actions stay well under the server's packet limits. */
export async function paceClicks(): Promise<void> {
  const wait = lastClickAt + CLICK_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastClickAt = Date.now();
}
