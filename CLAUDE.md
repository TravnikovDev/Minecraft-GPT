# minecraft-gpt Development Guidelines

## Project Overview
minecraft-gpt is an AI-powered Minecraft bot built with Mineflayer and OpenAI's GPT APIs. It allows natural language interactions in-game, with the bot autonomously responding to commands and performing complex actions.

## Build Commands
```bash
# Start the bot
bun run src/index.ts
# Type checking
bun run tsc
# Tests (tests/) and the full check: type check + boundary check + tests
bun run test
bun run check
# After removing direct game-changing bot calls outside src/core/, re-freeze the allow-list
bun run scripts/checkBoundaries.ts --update
# Install dependencies
bun install
```

## Environment Setup
The project requires the following environment variables:
- `BOT_USERNAME` - Username for the bot in Minecraft
- `OPENAI_API_KEY` - OpenAI API key for AI communication
- `SERVER_HOST` - Minecraft server hostname/IP
- `SERVER_PORT` - Minecraft server port
- `OWNER_USERNAME` - The only player whose chat the bot obeys (required)
- `AUTH` - `offline` (online-mode=false servers) or `microsoft`

Everything the bot says goes through the Narrator (`src/core/narrator.ts`): `reply()` for answers to the owner (never dropped, back on the channel asked), `report()` for task outcomes, `chatter(text, topic)` for running commentary (the newest per topic wins; dropped when the task ends). Don't add `bot.chat` calls (the boundary check counts them and only lets that go down). Memory is `db.json` schema v2 (`src/managers/migrate.ts`, `persistenceManager.ts`); tests use a throwaway file (`tests/setup.ts`). Perception reads are in `src/actions/perception.ts`; keep-out areas in `src/core/forbidden.ts`.

Game-changing calls go through `src/core/`: `core/primitives.ts` (walk, break, place, equip, craft, use, ride...) and `core/containers.ts` (chests, furnaces) check the world afterwards and return an `ActionResult` with a typed reason (`core/result.ts`); use `describeFailure` for chat. Never call `bot.dig`, `bot.placeBlock`, `bot.equip`... from actions or commands (the boundary check only lets that count go down). Untested in-game work is listed in `docs/testing-backlog.md`.

All settings are validated by the Zod schema in `src/config/env.ts`; the bot exits with a clear message when one is missing or invalid. Chat goes through `src/managers/chatGateway.ts`: non-owner messages are ignored, and `stop`, `come`, `follow me` and `status` are handled in code without an LLM call. Real-game test steps live in `docs/real-game-checklist.md`.

## Code Style Guidelines
- **Imports**: Group imports by source (internal/external). Use named imports for specific functions.
- **Naming**: camelCase for variables/functions, PascalCase for classes/types/interfaces, UPPER_CASE for constants.
- **Types**: Use TypeScript strictly. Define schemas with Zod. Use enums for constants.
- **Error Handling**: Use try/catch with specific error types. Log errors with console.error().
- **Functions**: Use arrow functions with explicit return types. Organize related functions in feature-specific files.
- **Comments**: Document file purpose, complex operations, and function parameters.
- **Async Code**: Use async/await pattern consistently. Handle promises with proper error catching.
- **Documentation**: Add descriptive comments to explain complex logic and expected behavior.

## Project Structure
- `/src/actions/` - Core bot capabilities (building, digging, crafting, etc.)
  - `building.ts` - Construction-related actions
  - `combat.ts` - Combat and fighting mechanics
  - `crafting.ts` - Item crafting functionality
  - `digging.ts` - Block mining and excavation
  - `ensure*.ts` - Verification and preparation utilities
  - `movement.ts` - Navigation and position control
  - `inventory.ts` - Item management and organization
  - `world.ts` - World interaction and environment sensing
- `/src/commands/` - High-level commands that users can trigger
  - Each file represents a discrete command the bot can execute
  - `all.ts` - The one list of commands (`export * as GoToPlayer from "./GoToPlayer"`); adding a command is adding its line here
  - `registry.ts` - Builds the registry and the model's tools from `all.ts`
  - `types.ts` - Command names (`BotCommands.GoToPlayer` is "goToPlayer"), taken from `all.ts` as types
- `/src/schemas/` - Zod schemas for validation
  - `mainSchemas.ts` - Core data validation schemas
  - `types.ts` - TypeScript type definitions
- `/src/managers/` - System components that coordinate functionality
  - `actionManager.ts` - Executes and coordinates bot actions
  - `aiManager.ts` - Handles communication with OpenAI APIs
  - `botProgress.ts` - Tracks bot skills and capabilities
  - `persistenceManager.ts` - Manages data persistence with LowDB
  - `toolManager.ts` - Defines and handles AI tool interactions
- `/src/utils/` - Shared utility functions
  - `minecraftData.ts` - Game data references and access
  - `utility.ts` - General helper functions

## Plugin Integration
The bot leverages several Mineflayer plugins:
- `mineflayer-pathfinder` - Advanced navigation
- `mineflayer-pvp` - Combat capabilities
- `mineflayer-auto-eat` - Automatic food consumption
- `mineflayer-tool` - Tool selection and management
- `mineflayer-armor-manager` - Automatic armor equipment

## Command System
Everything the bot does is a task in one arbiter (`src/core/arbiter.ts`), by priority bucket: 0 survival, 1 threats, 2 owner commands, 3 roles, 4 upkeep, 5 self-directed, 6 idle chores. There is no queue in the database and no polling loop.
1. Owner commands go through `queueCommand` (`src/managers/actionManager.ts`); priority 1 (the owner calling the bot) cuts in, and the task it cut off resumes afterwards with what's left (counted work reports progress with `reportProgress`).
2. Reflexes (creeper, drowning, combat) don't cancel tasks: they take the body's resources urgently (`src/core/leases.ts`), and the task waits at its next action. Upkeep (eating, armor) borrows the hands between actions.
3. Reflex code runs inside `asReflex(name, ...)`; tasks never call `bot.*` directly (`core/primitives.ts` waits its turn for them).
4. Idle chores are lowest-priority tasks (`src/core/chores.ts`); a task with no progress is nudged, replanned, then given up (`src/managers/stuckWatch.ts`).
5. Its own life (`src/skills/curriculum.ts`) is on by default: joining, it greets the owner and waits 30 seconds for an order (`greetOwner`), then lives its own life; "stay with me" turns it off (`memory.autonomy`; `AUTONOMY=off` sets the default off, as the tests do). It proposes the next milestone (`src/skills/milestones.ts`) at bucket 5 and the night routine (`src/skills/shelter.ts`) at bucket 4.

The day planner (Phase 7) is in `src/planner/`: the diary code writes (`diary.ts`, `diaryHooks.ts`), model spending and the monthly cap (`cost.ts`, `LLM_MONTHLY_CAP_USD`, `usage.json`), the goal vocabulary with its "possible now?" checks (`goals.ts`), the plan schema, validator and store (`plan.ts`), the planning call (`planner.ts`, Responses API with strict tools; never inside a task or reflex) and the step runner in B5 (`runner.ts`). Past Tier 1 the curriculum runs plan steps; with none, the next milestone is the fallback.

Companion roles (Phase 8) are in `src/roles/`: the role model in world memory (`role.ts`), the B3 runner that proposes a shift only when there's work, pauses on "stop" and backs off on failures (`runner.ts`), and one file per job (`guard.ts`, `farmer.ts`, `miner.ts`, `hauler.ts`, `builder.ts`). Set by the Role command; `SERVER_AUTOMATION` / `SERVER_CHAT_SPACING_MS` are the server's rules (`src/config/serverProfile.ts`).

The late game (Phase 9) is in `src/skills/endgame/`: milestones after diamonds (`milestones.ts`, tiers 4 and 5, `dimension: "any"`), pure geometry (`geometry.ts`), late-game memory and travel between dimensions (`state.ts`), and one module per stage (`portal.ts`, `nether.ts`, `pearls.ts`, `stronghold.ts`, `dragon.ts`). Milestones are gated by dimension (`milestoneHere`); deliberate waits call `holdPosition` (`managers/stuckWatch.ts`). Tests never call the model (`tests/setup.ts` sets the cap to $0).

Getting an item goes through one planner, `acquire(item, n)` (`src/skills/acquire.ts`, sources in `src/skills/world.ts`); the `ensure*` helpers are thin wrappers over it and must not call each other. What the bot has right now (tool tiers, food, shelter, bed) is computed in `src/skills/capabilities.ts`, never cached. Command modules load `skills/curriculum` and other commands lazily (`await import(...)`): a static import closes a cycle through `commands/registry.ts`.

## OpenAI Integration
The bot communicates with OpenAI through:
- `aiManager.ts` - Handles message processing and API communication
- Function calling with GPT models to execute specific actions
- Tools API for structured action handling
- Tool definitions rely on strict mode (`zodFunction` sets `strict: true`), so tool params must be `.nullable()`, not `.optional()`
- Do not switch to OpenRouter or other non-OpenAI providers: they do not reliably enforce strict tool arguments (see README "AI Model and Providers")

## TypeScript Type Checking

The project uses TypeScript for type safety. Always run type checking before submitting changes:

```bash
npm run tsc
# or
bun run tsc
```

### Common Type Issues and Solutions

1. **Mineflayer Type Extensions**
   - Some Mineflayer properties/methods might not be properly typed in @types
   - For runtime-available properties not in types, use `// @ts-ignore` with comments
   - Example: `// @ts-ignore - vehicle property exists at runtime but is not in type definition`

2. **Command Queue Types**
   - All commands must follow the `CommandType` interface from `schemas/types.ts`
   - Required fields: `id`, `command`, `priority`, and optional `args` and `retryCount`
   - When adding commands to queue, ensure all required fields are provided

3. **Zod Schema Synchronization**
   - Ensure Zod schemas in `schemas/mainSchemas.ts` match TypeScript types in `schemas/types.ts`
   - The `CommandSchema` must include all fields used in the code

4. **Unused Imports and Variables**
   - TypeScript flags unused imports and variables as errors
   - Remove unused code or use `// @ts-ignore` with explanatory comments if needed

5. **Type-Safe Set Operations**
   - The command queue uses a Set-like structure based on unique hash IDs
   - Ensure proper type handling when working with `commandSet`

### Type Safety Best Practices

- Define explicit return types for all functions: `function example(): ReturnType {}`
- Use type guards for runtime type checking: `if (typeof x === 'string') {}`
- Avoid using `any` - use `unknown` with type assertions instead
- Create interfaces/types for all complex data structures
- Maintain proper type definitions for third-party libraries
- Validate all external data using Zod schemas

### Handling Advanced Type Issues

For challenging type issues, you can create custom type definitions:

```typescript
// Example: Creating a module declaration for a missing plugin type
declare module 'mineflayer-example-plugin' {
  interface Bot {
    examplePlugin: {
      methodName(): void;
    }
  }
}
```

## Development Workflow
1. Create new features in the appropriate module directory
2. Ensure proper TypeScript typing and validation
3. Add new commands to `src/commands/all.ts` (one line)
4. Test functionality in-game with natural language commands
5. Document changes in code comments

## Best Practices
- Use Zod schemas for all data validation
- Keep functions small and focused on a single responsibility
- Leverage TypeScript's type system for safety and documentation
- Handle Minecraft-specific edge cases (disconnects, respawns, etc.)
- Log important events and errors with appropriate detail
- Ensure graceful error handling for all user interactions