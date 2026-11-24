# Architecture review: `phase-1/session-body`, 2026-11-24

This review covers `master..HEAD`: 34 commits, 89 files. It was written by the `technical-architect` agent (`.claude/agents/technical-architect.md`). F1 and F2 were then checked against the code and library sources.

## 1. Verdict
Phase 1 is mostly on track. Done so far:
- The Body owns the connection lifecycle.
- Per-connection timers and listeners are torn down on reconnect.
- The death spot, the owner's position, the bed and the conversation survive a restart.
- Plugin adapters and the typed event bus exist.
- Import cycles are down to one static cycle: `crafting ⇄ ensure ⇄ ensureTools`. Boat and craftPlanner have more cycles hidden behind dynamic imports.

**Not met:** the deliverable "All `bot.*` calls go through the Body adapter" (see section 5).

**The bigger issue** comes from the work pulled in from later phases. The bot already has a de-facto arbiter, built from scattered flags:
- the reflex `active` set
- `pausedFollow`
- `waitForReflexes`
- `noAutoWearUntil`
- `trackCleanup`
- the 2 s walking-rules backstop
- INSTANT commands that run in parallel with the queue

On top of that, each reflex polls on its own timer, and priority comes from reflexes importing each other.

**Most important change:** fix the two cancellation and stop bugs (F1, F2) before building more. Then pull a thin slice of Phase 4 forward: movement and hands leases, plus one reflex scheduler.

## 2. Findings

### F1: critical. "stop" doesn't reach the reflex-retry loop
**Where:** `src/core/plugins.ts:42-54`, `src/core/reflexes.ts:30-32`.

`pathing.goto` retries whenever a reflex is (or was) active. It never checks `isCommandCancelled()`, and `waitForReflexes()` can't be aborted.

**Failure:** a stop issued during a fight or a creeper encounter does this:
1. `haltBot` stops the path.
2. The goto rejects, and the code sees "interrupted".
3. It waits for the reflex to finish.
4. It calls `pathfinder.goto(goal)` again, up to 10 times.

The cancelled task then walks off while the next command runs. Nothing notices, because `Promise.race` in `actionManager.ts:140` has already stopped waiting.

**Fix:** check the command's cancel signal at the top of the loop and again after the wait, and pass that signal into `waitForReflexes(signal)`. `commandContext.ts` imports nothing, so there is no cycle. Phase 1, effort S.

### F2: critical. `pvp.stop()` drops the follow and can cancel the next command's goal
**Where:** `src/core/plugins.ts:106-108`, `src/actions/combatReflex.ts:81-88`, `src/managers/actionManager.ts:85-87`.

**How it happens:**
- `pvp.stop()` (`mineflayer-pvp/lib/PVP.js:80-95`) calls `pathfinder.stop()`.
- In the pathfinder, `stop()` only sets a deferred flag (`mineflayer-pathfinder/index.js:161-166`).
- The next `setGoal` consumes that flag: `resetPath` → `if (stopPathing) return stop()` (`index.js:138-146`).
- In `combatReflex.finish()`, the next call is `resumeAfterReflex()` → `setGoal(pausedFollow)`. So the bot silently stops following the owner whenever a fight ends with the mob still alive.

**Second failure:** if nothing was pathing, `path_stop` never fires. Five seconds later pvp runs `removeAllListeners('path_stop')` and `setGoal(null)` (`PVP.js:91-92`). That cancels whatever goal the next command set, and strips the `path_stop` listeners of goto and of `doors.ts`.

**Fix:**
- Have the adapter call `pvp.forceStop()` (`PVP.js:129-134`), which clears the goal synchronously.
- Add `pathing.halt()` = `setGoal(null)`.
- Never expose a bare `pathfinder.stop()`.

Phase 1, effort S.

### F3: major. The combat reflex only acts when its state changes
**Where:** `src/actions/combatReflex.ts:98-105`.

After `haltBot` clears pvp's target, the reflex still holds its own `target`. It returns early on `!over` and never attacks again.

**Failure:** for up to 30 s the reflex counts as "active" but does nothing. The bot neither fights nor walks, because every `goto` is waiting on it.

**Fix:** have each reflex re-assert the state it wants on every tick ("pvp target should be X"), instead of acting only when something changes. Phase 1/4, effort S.

### F4: major. Reflexes only pause walking; there are no leases
Only `pathing.goto` and `movement.ts:53` call `waitForReflexes`. `dig`, `equip`, `activateBlock`, windows and control states keep running while a reflex is active.

**Competing writers:**
- **Held item:** `equipWeapon` in the combat reflex vs `tools.equipForBlock` in the running task.
- **Armor:** `autoWearArmor` runs every 10 s mid-task, and the INSTANT `WearArmor` command runs in parallel with it.
- **Controls:** the creeper and drowning reflexes both write `forward` and `jump`, with no order between them.

**Stale state:** `pausedFollow` isn't cleared by `resetReflexes()`. After a reconnect, the bot can resume a `GoalFollow` whose entity belongs to the dead connection.

**Fix: an "Arbiter-lite" in `core/`.**
- **Leases:** `lease("movement" | "hands" | "window", holder, priority, signal)`.
- **One scheduler:** a single 100–150 ms loop runs an ordered list of reflexes, each `{name, priority, wants(snapshot), step()}`.
- **Checks:** primitives check the lease before acting.

Phase 4 later adds buckets, the goal stack and replanning on top of this. Phase 4 (pulled forward), effort M.

### F5: major. Stale tasks can drive the new connection
**Where:** `src/core/body.ts:19`, `src/index.ts:125-128`, `src/managers/actionManager.ts:302-311`.

`export let bot` is a live binding, and the running command is only aborted on the *next* spawn.

**Failure:** a task that doesn't check for cancellation keeps running through the reconnect backoff. After `bot = createBot()`, its calls reach the new connection.

**Fix:** abort the current command on `end`, and stamp a connection generation that primitives check. Phase 1, effort S.

### F6: major. Two door-opener bugs
**Where:** `src/actions/doors.ts`.

**Stale route:**
- The route is copied from the update, but the pathfinder shifts its live array as the bot walks.
- **Failure:** on a long path, a door more than 6 nodes past the last replan is never "on route". The bot walks into a door that the path search treats as air.
- **Fix:** keep a reference to `results.path` instead of a copy.

**Unverified open:**
- The door is recorded as opened before the server confirms it.
- **Failure:** if the server refuses (claims, adventure mode), the path search still treats the door as air.
- **Fix:**
  - Confirm with a `blockUpdate`.
  - On failure, add the door to a per-connection "solid doors" set that `SafeMovements.getBlock` checks.
  - Then call `resetPath`.

Phase 1 now (the Phase 3 pattern), effort S.

### F7: minor. Walking rules have several writers
- `combat.ts:259,282,290,307` rebuild `safeMovements` on every call, and each rebuild walks the whole block registry.
- `GoToPlayer.ts:122-124` turns on `allowSprinting` and leaves it in the global rules.
- The 2 s backstop is redundant now that `pvp.movements` is set.

**Fix:**
- Keep one rules object per connection, owned by the Body.
- Make scoped changes through `pathing.withRules(patch, fn)`.
- Delete the dead `nightDefense`, `defendSelf` and `useTacticsForTarget` code.

Effort S.

### F8: minor. Two writers on a mounted bot
**Where:** `src/actions/boat.ts:399-403`, `src/managers/ownerDialog.ts:45-48`.

Both write raw packets and change `bot.entity.position`, alongside mineflayer physics. It works in the real game (258 blocks rowed). How these interact while mounted is unverified.

**Fix:** a core "vehicle driver" as the only module allowed to call `_client.write` or change the world mirror.

### F9: minor. Loose name matching exists three times
- **Where:** `GiveItemToAPlayer.ts`, `craftPlanner.ts`, and `inventory.ts:214` (which uses `includes`).
- **Bug:** `replace(/s$/,"")` turns "glass" into "glas".
- **Fix:** fold all three into a Catalog seed, `resolveLoose(name, among)`. Phase 2, effort S.

### F10: minor. No tests in the repo
A lot of the logic is already pure:
- door geometry
- `planWaterRoute`
- `isNatural`
- `resolveCraftable`
- the reflex decisions, once split into `decide(snapshot)`

**Fix:** add `bun test` with fake snapshots. Effort S.

### Housekeeping
- **Listener limit:** `setMaxListeners(40)` hides leak detection. Use one per-connection disposer list instead.
- **Dead code:** `block:changed`, `waitForCreeperReflex` and `waitForDrowningReflex` are unused.
- **Stray file:** `src/.DS_Store` is committed.

## 3. Keep as is
- **Body lifecycle:** the `listen` guard, `everyWhileConnected`, the created/ready/reconnect hooks, and the version refusal.
- **Chat pacing inside the Body:** the seed of the Narrator.
- **Session persistence:** throttled saves, and conversation memory with expiry.
- **`SafeMovements`:**
  - the allowlist of natural terrain
  - the `WeakSet` check that a rules object is one of ours
  - putting doors in the `openable` set so the path goes through the middle of the doorway
- **Server-confirmed results:**
  - Sleep reports the server's own message.
  - The drowning reflex reads the bot's own air from metadata.
- **`trackCleanup` / `waitForCleanup`:** the seed of "cancel, then wait for cleanup".
- **Reflex takeovers:** the takeover counter, and `pathing.goto` pausing instead of failing. Keep both; just make them cancellable.

## 4. Plan changes
1. **Reword the Phase 1 deliverable** (see section 5).
2. **Insert "Phase 4a: leases and reflex scheduler"** right after Phase 1. Reflexes have already shipped without an arbiter.
3. **Give each pulled-in feature a target phase**, so it gets converted rather than rewritten:
   - farming and cooking → Phase 6 skills
   - boat → a Phase 3 travel primitive
   - beds → Phase 5 remembered places
4. **Merge to master after F1–F3.** The plan says small commits on master.
5. **New checklist rows:**
   - stop mid-fight, then "come"
   - following resumes after a mob flees
   - a door more than 6 nodes away on a long route
   - a reconnect during a reflex
6. **Under "Throughout", add:**
   - unit tests for pure decision code
   - a boundary script that blocks new state-changing `bot.*` calls

## 5. Open question: the Body adapter deliverable
**Recommendation:** reword the deliverable and split it across phases.

| When | What |
|---|---|
| Phase 1 | **Connection:** the Body owns it. Every per-connection listener, timer and plugin is registered through the Body and disposed on `end`. |
| Phase 1 | **Plugins:** reached only through `core/plugins`. Two direct uses are left: armor-manager in `armor.ts` and `pvp.movements` in `index.ts`. |
| Phase 1 | **Boundary script:** it fails on *new* state-changing `bot.*` calls outside `core/` and a frozen allow-list. |
| Phase 3 | **Game-changing calls:** the ~100 calls go through verified primitives. Wrapping them now as well would be double work. |
| Phase 4 | **Leases:** those primitives require a lease. |
| Phase 5 | **Chat:** the 165 `bot.chat` calls go through the Narrator. |
| Never | **Reads:** the 365 reads stay as reads. A pass-through wrapper adds no safety. Reads that need "unknown ≠ air" become Phase 5 beliefs. |

What the wrapper was really meant to prevent, stale tasks driving a new connection, is fixed directly by F5.

## 6. Open questions for the owner
- **Should "stop" end reflexes?** Suggestion: stop ends combat and ignores that mob for about 30 s, but never ends fleeing or drowning.
- **Keep mineflayer-pvp?** It swaps walking rules, strips listeners and defers stops. A melee loop of our own, about 60 lines, may be cheaper than guarding pvp.
- **Doors:** should the bot close a door behind itself while the owner is following through it?
