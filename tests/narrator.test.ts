// Phase 5: one Narrator for everything the bot says. Answers to the owner go
// first and are never dropped; commentary on the same topic is replaced by
// the newest; a long message is split to fit; what the owner missed while
// offline comes as a short digest when they join; after "stop" nothing late
// about the stopped work goes out.
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;

const sent: string[] = [];
let ownerOnline = true;
useFakeBot({});
const N = await import(`${ROOT}/src/core/narrator.ts`);
const { runWithSignal } = await import(`${ROOT}/src/core/commandContext.ts`);

/** A sender that only sends when told to (one line per call to flush). */
let paced: (() => void) | null = null;
function useSender(spacing: number): void {
  N.setSender(
    {
      chat: (m: string) => sent.push(`all: ${m}`),
      whisper: (to: string, m: string) => sent.push(`${to}: ${m}`),
      ownerName: () => (ownerOnline ? "Owner" : null),
    },
    spacing
  );
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  useFakeBot({});
  sent.length = 0;
  ownerOnline = true;
  paced = null;
  N.resetNarrator();
  N.setOwnerChannel("whisper");
});

test("an answer to the owner goes ahead of reports and commentary waiting", async () => {
  useSender(1_000_000); // first line goes now, the rest wait
  N.chatter("Fighting a zombie", "combat");
  N.chatter("Fighting a spider", "combat"); // replaces the zombie line still waiting
  N.report("Collected 10 coal ore");
  N.reply("I'm at 10, 64, 10.");
  expect(sent).toEqual(["Owner: Fighting a zombie"]);
  expect(N.waiting().map((l: any) => `${l.kind}: ${l.text}`)).toEqual([
    "reply: I'm at 10, 64, 10.",
    "report: Collected 10 coal ore",
    "chatter: Fighting a spider",
  ]);
});

test("commentary is capped; answers and reports never are", () => {
  useSender(1_000_000);
  N.report("first"); // sent
  for (let i = 0; i < 10; i++) N.chatter(`step ${i}`, `topic ${i}`);
  for (let i = 0; i < 6; i++) N.report(`result ${i}`);
  const waiting = N.waiting();
  expect(waiting.filter((l: any) => l.kind === "chatter").length).toBeLessThanOrEqual(4);
  expect(waiting.filter((l: any) => l.kind === "report").length).toBe(6);
});

test("the same words a moment ago are said once; an answer is always said", () => {
  useSender(0);
  N.report("Collected 10 coal ore");
  N.report("Collected 10 coal ore");
  N.reply("Yes!");
  N.reply("Yes!");
  expect(sent).toEqual(["Owner: Collected 10 coal ore", "Owner: Yes!", "Owner: Yes!"]);
});

test("a long message is split at word boundaries to fit a chat line", () => {
  useSender(0);
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
  N.report(long);
  expect(sent.length).toBeGreaterThan(1);
  // Each line fits a chat packet together with "/tell Owner "
  expect(sent.every((m) => m.length - "Owner: ".length + "/tell Owner ".length <= 255)).toBe(true);
  expect(sent.map((m) => m.slice("Owner: ".length)).join(" ")).toBe(long);
});

test("a reply goes back the way the owner asked: whispered, or in public chat", () => {
  useSender(0);
  N.withOwnerChannel("chat", () => N.reply("Coming!"));
  N.report("Collected 3 logs"); // reports are still whispered
  expect(sent).toEqual(["all: Coming!", "Owner: Collected 3 logs"]);
});

test("the channel is the one the question came on, even if the owner speaks again before the answer goes", async () => {
  useSender(1_000_000);
  N.report("busy"); // sent; the rest waits
  await N.withOwnerChannel("whisper", async () => {
    await Promise.resolve(); // the LLM thinking...
    N.withOwnerChannel("chat", () => {}); // ...while the owner says something in public
    N.reply("You're 10 blocks away.");
  });
  N.setSender({ chat: (m: string) => sent.push(`all: ${m}`), whisper: (to: string, m: string) => sent.push(`${to}: ${m}`), ownerName: () => "Owner" }, 0);
  expect(sent.at(-1)).toBe("Owner: You're 10 blocks away.");
});

test("an answer never lands between the parts of a long message", () => {
  useSender(1_000_000);
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
  N.report(long); // first part sent, the rest waits at the front
  N.reply("Yes!");
  expect(N.waiting().map((l: any) => l.kind)).toEqual(["report", "reply"]);
});

test("old code that talks in a loop: only the latest few of its lines wait", () => {
  useSender(1_000_000);
  N.report("first");
  for (let i = 0; i < 20; i++) N.say(`Dug step ${i}`, { kind: "report", to: "all", legacy: true });
  expect(N.waiting().length).toBe(6);
  expect(N.waiting().at(-1)!.text).toBe("Dug step 19");
});

test("while the owner is offline, answers and reports wait; they get a digest when they join", () => {
  useSender(0);
  ownerOnline = false;
  N.chatter("Walking", "trip"); // commentary isn't kept
  for (let i = 1; i <= 7; i++) N.report(`Report ${i}`);
  expect(sent).toEqual([]);
  N.reply("Your answer"); // an answer is never left out of the digest
  N.say("Hunt anyway? (yes/no)", { kind: "reply", noHold: true }); // a question expires: not kept
  ownerOnline = true;
  N.ownerJoined();
  expect(sent[0]).toBe("Owner: While you were away (and 2 more):");
  expect(sent.slice(1)).toEqual(["Owner: Report 3", "Owner: Report 4", "Owner: Report 5", "Owner: Report 6", "Owner: Report 7", "Owner: Your answer"]);
});

test("a stopped task says nothing more", async () => {
  useSender(0);
  const task = new AbortController();
  task.abort("Stopped by player");
  await runWithSignal(task.signal, async () => N.report("Failed to collect coal ore"));
  expect(sent).toEqual([]);
});

test("after 'stop', no commentary and no late report about the stopped work", async () => {
  useSender(1_000_000);
  N.report("first"); // sent
  const task = new AbortController();
  await runWithSignal(task.signal, async () => {
    N.chatter("Digging down", "trip");
    N.report("Failed to collect coal ore");
  });
  N.reply("Okay.");
  task.abort("Stopped by player");
  N.dropForStop();
  expect(N.waiting().map((l: any) => l.text)).toEqual(["Okay."]);
});

test("a task that ended takes its waiting commentary with it, but not its reports", async () => {
  useSender(1_000_000);
  N.report("first");
  const task = new AbortController();
  await runWithSignal(task.signal, async () => {
    N.chatter("Coming: 40% of the way.", "trip");
    N.report("I'm here!");
  });
  N.dropFromTask(task.signal);
  expect(N.waiting().map((l: any) => l.text)).toEqual(["I'm here!"]);
  await sleep(1);
});

test("a report said once: the same text under a key within the window is only logged; new text or later is said", () => {
  expect(N.reportOnce("no sleep", "There are monsters nearby.", 600_000, 1_000)).toBe(true);
  expect(N.reportOnce("no sleep", "There are monsters nearby.", 600_000, 31_000)).toBe(false);
  expect(N.reportOnce("no sleep", "Someone is already in that bed.", 600_000, 61_000)).toBe(true);
  expect(N.reportOnce("no sleep", "Someone is already in that bed.", 600_000, 700_000)).toBe(true);
});
