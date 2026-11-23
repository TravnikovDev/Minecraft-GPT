# LLM-driven Minecraft agents: architecture survey and LLM-vs-code division of labour

Scope note: researched 2026-11-24. Most arXiv sources were read as abstracts only. Full text was read for Voyager (HTML v2, first ~100k chars), Project Sid (HTML v1, first ~100k chars) and the Gemini 4 Argon "beats Minecraft" paper (HTML). For mindcraft, the source files `settings.js`, `src/agent/agent.js` and `src/agent/modes.js` (develop branch) were read directly. Claims about DEPS, Plan4MC, MineDojo/MineCLIP, VPT, STEVE-1, Optimus-1 and MineLand were NOT verified in this session and are listed under Gaps.

## Architecture of each surveyed agent (layers, routing game state -> model -> actions, what the LLM vs code decides)

### Takeaway
The surveyed systems fall along a spectrum:
- **LLM writes code every step:** Voyager, the Gemini 4 Argon team, the Claude/MCP dragon run.
- **LLM picks from a fixed command vocabulary, with code-side reflexes:** mindcraft, Player2/PlayerEngine.
- **LLM plans, a learned low-level policy acts:** JARVIS-1, Optimus.
- **Many concurrent modules, with fast non-LLM reflexes and a slow LLM "cognitive controller":** Project Sid/PIANO.

The closest existing analogue to our design (LLM only translates chat into a structured command; deterministic code executes it) is Player2's PlayerEngine. mindcraft's `!command` mode plus its `modes` reflex layer is the closest open-source analogue.

### Cited Findings

**Voyager (NVIDIA/Caltech et al., 2023)**
- Three components: an automatic curriculum that proposes tasks to maximise exploration, a skill library of executable code, and iterative prompting that uses environment feedback, execution errors and self-verification. It uses GPT-4 as a black box, with no fine-tuning. — [arXiv 2305.16291](https://arxiv.org/abs/2305.16291)
- Observation is text. The code-generation prompt gets inventory, equipment, nearby blocks and entities, biome, time, health and hunger, and position, plus the previous round's environment feedback, execution errors and critic output. The curriculum prompt also gets recently seen blocks, chest contents, and lists of completed and failed tasks. — [Voyager HTML](https://arxiv.org/html/2305.16291v2)
- Output is Mineflayer JavaScript code. There are at most 4 rounds of code generation per task before switching tasks. Evaluation caps were 160 prompting iterations for the tech tree and exploration tests, and 50 for zero-shot generalisation. — [Voyager HTML](https://arxiv.org/html/2305.16291v2)
- Skills are stored as code in a vector DB. The key is an embedding of a GPT-3.5-written description of the program, and retrieval returns the top-5 skills. — [Voyager HTML](https://arxiv.org/html/2305.16291v2)
- Feedback to the model comes through `bot.chat()` calls inside the control-primitive APIs, plus JS execution errors and a GPT-4 self-verification "critic". — [Voyager HTML](https://arxiv.org/html/2305.16291v2)
- Progress is measured in prompting iterations, not wall-clock time. The paper does not present Voyager as a real-time agent. — [Voyager HTML](https://arxiv.org/html/2305.16291v2)

**Ghost in the Minecraft (GITM, 2023)**
- Integrates LLMs with text-based knowledge and memory. The LLM produces plans over a set of *structured actions*, which the agent executes. No GPU training is needed: "a single CPU node with 32 CPU cores is enough." — [arXiv 2305.17144](https://arxiv.org/abs/2305.17144)
- The abstract page did not describe the internal decomposer/planner/interface split (see Gaps).

**JARVIS-1 (2023)**
- A pre-trained multimodal LM maps visual observations and text instructions to plans. Plans are "dispatched to the goal-conditioned controllers" (learned policies, not code). A multimodal memory combines pre-trained knowledge with in-game experience. Observation and control space are "similar to humans" (pixels, low-level actions). — [arXiv 2311.05997](https://arxiv.org/abs/2311.05997)
- Completes over 200 tasks. Short-horizon tasks are "nearly perfect." — [arXiv 2311.05997](https://arxiv.org/abs/2311.05997)

**Odyssey (IJCAI 2025)**
- A planner–actor–critic LLM architecture over a skill library of 40 primitive and 183 compositional skills. It uses a LLaMA-3 model fine-tuned on 390k+ Minecraft-Wiki Q&A instructions. The codebase is built on Voyager. — [Odyssey arXiv](https://arxiv.org/abs/2407.15325v1); [GitHub zju-vipa/odyssey](https://github.com/zju-vipa/odyssey); [IJCAI 2025](https://www.ijcai.org/proceedings/2025/22)

**Optimus-2 / Optimus-3 (2025)**
- Multimodal agents with learned "goal-observation-action conditioned" policies (Optimus-2). Optimus-3 is a mixture-of-experts agent with "System 1" (action) and "System 2" (planning/reflection) tasks. — [Optimus-2](https://arxiv.org/pdf/2502.19902); [Optimus-3](https://arxiv.org/html/2506.10357v2)

**Project Sid / PIANO (Altera, 2024)**
- PIANO ("Parallel Information Aggregation via Neural Orchestration") runs 10 concurrent modules, among them memory, action awareness, goal generation, social awareness, talking and skill execution. Each is a stateless function that reads and writes a shared Agent State. — [Project Sid HTML](https://arxiv.org/html/2411.00114v1)
- Speed split: reflex modules use "small, fast non-LLM neural networks." Goal generation uses slower LLM reasoning, and social modules activate only during social interaction. A Cognitive Controller makes high-level decisions from a bottlenecked view of state and broadcasts them, so that talk and action stay coherent. — [Project Sid HTML](https://arxiv.org/html/2411.00114v1)
- Scale: 10–1000+ agents. Experiments used 25–50 agents and a 500-agent multi-society run. Runs above 1,000 agents became sporadically unresponsive because of Minecraft server limits. — [arXiv 2411.00114](https://arxiv.org/abs/2411.00114); [HTML](https://arxiv.org/html/2411.00114v1)

**"A team of Gemini 4 Argon agents beats Minecraft" (Faldor, Singh, Raileanu; arXiv 2610.22319, 15 Oct 2026)**
- Four player agents and one non-playing Observer agent. Each player is a general coding agent on its own cloud machine. Players act only by writing and running JavaScript through Mineflayer and its pathfinder, with no pixels. Program output (position, health, inventory, findings, errors) returns as text. — [arXiv HTML 2610.22319](https://arxiv.org/html/2610.22319)
- Programs run until done or until an agent-chosen timeout (default 60 s). Median runtime was 33.5 s, and each player had a program running about 40% of the time. — [arXiv HTML](https://arxiv.org/html/2610.22319)
- Tooling: a code workspace with version control, shell, file editing, web search, persistent private and shared team memory, and context compaction. Global values persist between programs. — [arXiv HTML](https://arxiv.org/html/2610.22319)
- No curriculum, skill library, human-written tools or route were provided. The agents built their own (42 helper functions, 146 persistent state/code items). The authors claim no pre-scouted seeds and no human-written game tools. — [arXiv HTML](https://arxiv.org/html/2610.22319); [arXiv abs](https://arxiv.org/abs/2610.22319)

**Claude / MCP single-agent dragon run (AI Bengineering, 2026-09-15)**
- Model `claude-opus-5[1m]` at effort "high", running in Claude Code (`claude --print`, stream-json) against a custom MCP server with 37 tools (code at github.com/aibengineering/mine-ai-mcp). The bot played vanilla 1.21.4. The run had 731 assistant turns and 388 tool calls.
- Each action request carries a rationale. A runtime SQLite DB tracks chunks, materials, biomes, inventory, events and Eye-of-Ender triangulation. Persistent notes survive deaths and restarts.
- The dataset card does not say whether the bot layer uses Mineflayer.

Source: [HF dataset aibengineering/beat-the-game-minecraft](https://huggingface.co/datasets/aibengineering/beat-the-game-minecraft)

**Player2 / Player2NPC / PlayerEngine (commercial AI-companion ecosystem)**
- The "brain" is the Player2 desktop app, which acts as a gateway to AI models. The "body" is the mod. A chat request goes to the LLM, which returns a structured command such as "get oak_log 10", and the mod executes it. — [Modrinth player2npc](https://modrinth.com/mod/player2npc); [itch.io player2npc](https://goodbird-git.itch.io/player2npc)
- PlayerEngine is a server-side framework whose task system is adapted from ChatClef (an AltoClef derivative). It uses Baritone for navigation, and its developer describes it as a "deterministic, game-logic-based action layer that reliably executes the high-level goals from an LLM." — [CurseForge PlayerEngine](https://www.curseforge.com/minecraft/mc-mods/playerengine)

**SeekerCraft (community)**
- Described as an LLM-driven bot (Rust + Azalea protocol client) with 44 tools and a 23-tier task system. Its finale tier is listed as pending, so a completed run is not demonstrated. — [GitHub XJungit/seeker-craft](https://github.com/XJungit/seeker-craft) (repo read only via search-result summary)

### Inferences
- **The LLM's share of control is shrinking in practical companions and growing in frontier research.**
  - Player2's design is the same split we use: LLM → one structured command → deterministic task engine.
  - The 2026 frontier results go the other way. They give a very large model a general coding harness and let it write everything. That works but costs hundreds of dollars per run (see the cost section).
- **Tools vs code-writing:** the Claude/MCP run used a fixed tool set (37 tools), much like our ~32 strict tool calls. It finished in about 4 hours with 388 tool calls, compared with the Gemini team's 2,783 self-written programs. Coarse, well-designed tools appear to cut the number of LLM decisions sharply. This is a single run each, so the comparison is not controlled.

## mindcraft in detail: agent loop, !commands, modes, memory, owner/players/multi-agent chat

### Takeaway
mindcraft is a Mineflayer + LLM framework (MIT, about 6k stars). Its loop is:
1. The LLM is called only on incoming messages (and in self-prompt mode).
2. It replies with text or a `!command`.
3. Command output is fed back, and the model is re-prompted until it returns plain text.

A 300 ms code-side tick runs a priority-ordered "modes" reflex layer, which can interrupt actions without calling the LLM. Code generation (`!newAction`) is off by default for security.

### Cited Findings
- **Model roles** are configured per profile: `model` (chat), `code_model`, `vision_model`, `embedding` (used to select relevant examples) and `speak_model`. About 18 API providers are listed, including Ollama for local models. — [GitHub mindcraft](https://github.com/mindcraft-bots/mindcraft)
- **Code-writing security:** "This project allows an LLM to write/execute code on your computer." It is disabled unless `allow_insecure_coding: true`, and the README says "Do not connect this bot to public servers with coding enabled." — [GitHub mindcraft](https://github.com/mindcraft-bots/mindcraft); [settings.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/settings.js)
- **Context and cost controls** in settings:
  - `max_messages: 15` (history kept in context)
  - `num_examples: 2`
  - `relevant_docs_count: 5`
  - `max_commands: -1` (unlimited consecutive commands)
  - `code_timeout_mins: -1`
  - `blocked_actions` (removes commands from the docs)
  - `show_command_syntax` (full / shortened / none)
  - `base_profile` of survival, assistant, creative or god_mode

  Source: [settings.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/settings.js)
- **Who the bot listens to:**
  - `only_chat_with: []` lists the users the bots listen to and message. When it is empty, bots chat publicly.
  - In `agent.js`, `respondFunc` drops empty and own messages, drops senders not in `only_chat_with`, and filters server status messages by prefix. Public chat is ignored entirely when other agents are connected to the MindServer.
  - Whispers always go to the handler.
  - Messages from other bots go through a separate conversation manager.

  Sources: [settings.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/settings.js); [agent.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/agent.js)
- **The bot's profile name must exactly match its Minecraft username**, or "the bot may talk to itself." — [GitHub mindcraft](https://github.com/mindcraft-bots/mindcraft)
- **LLM bypass for humans:** if a human player's message contains a `!command`, it runs immediately and the LLM is not called. — [agent.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/agent.js)
- **Response loop:**
  1. The model's reply is truncated after the first command.
  2. Unknown commands add a system note and use up an iteration.
  3. A valid command executes, and its output is appended to history as a system message. The model is then re-prompted.
  4. A plain-text reply ends the loop.
  5. A human message that arrives while self-prompting is capped at one response.

  Source: [agent.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/agent.js)
- **Update loop:** a fixed 300 ms tick runs `bot.modes.update()`, then the self-prompter update, then a task-completion check. On death, the death position is saved to the memory bank and a system message is injected into `handleMessage`. On idle, the bot clears controls, unpauses all modes and resumes the last action after 1 s. — [agent.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/agent.js)
- **Modes**, listed in priority order (earlier modes take priority):

  | # | Mode | Default | Interrupts | Behaviour |
  |---|---|---|---|---|
  | 1 | `self_preservation` | on | all | Water-overhead jump, falling sand/gravel avoidance, fire/lava → water bucket or walk to water, flee 20 blocks at low health after damage |
  | 2 | `unstuck` | on | all | No progress within 2 blocks for over 20 s (40 s for obsidian) → move 5 blocks; if that takes over 10 s, the agent is killed |
  | 3 | `cowardice` | on | all | Flees 24 blocks from a hostile mob within 16 blocks that has a path |
  | 4 | `self_defense` | on | all | Fights a hostile mob within 8 blocks |
  | 5 | `hunting` | on | `followPlayer` | Attacks huntable animals within 8 blocks |
  | 6 | `item_collecting` | on | `followPlayer` | Picks up items within 8 blocks after they have been seen for 2 s, if at least 2 slots are free |
  | 7 | `torch_placing` | on | `followPlayer` | Places a torch when none is nearby, with a 5 s cooldown |
  | 8 | `elbow_room` | on | `followPlayer` | Steps away when a player is within 0.5 blocks |
  | 9 | `idle_staring` | on | none | Cosmetic only |
  | 10 | `cheat` | off | none | Placeholder |

  Source: [modes.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/modes.js)
- **Modes vs the LLM:** modes run locally, with no per-tick LLM call. A mode `update` should not block for more than about 100 ms. Longer work runs as a labelled action (`mode:<name>`) that stops the self-prompter. After a mode interrupts an action that has no resume function, an "(AUTO MESSAGE)" with the behaviour log is sent to the model so it can decide what to do next. — [modes.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/modes.js)
- **Mode toggling:** the model and users can inspect and toggle modes with `!modes` and `!setMode` (seen in a fine-tuning dataset built on mindcraft). — [HF Sweaterdog/Andy-3.5-code](https://huggingface.co/datasets/Sweaterdog/Andy-3.5-code)
- **Multi-agent:** multiple profiles can be launched at once (`--profiles andy.json jill.json`), and task JSON includes `agent_count`. — [GitHub mindcraft](https://github.com/mindcraft-bots/mindcraft)
- **MineCollab benchmark (paper arXiv 2504.17950):** the main bottleneck for collaboration is efficient natural-language communication. Performance drops by up to 15% when agents must communicate detailed plans. — [arXiv 2504.17950](https://arxiv.org/abs/2504.17950)

### Inferences
- **Same shape as our bot:** mindcraft's default (no-coding) configuration is architecturally close to ours. The LLM translates chat into a `!command`, and code reflexes handle the real-time world.
- **Where mindcraft differs:**
  - It loops the LLM after every command result (re-prompt until plain text), so one owner message can cost several LLM calls.
  - It can be put into self-prompt mode, which keeps the LLM running autonomously.

  Our "one message → one strict tool call" design is cheaper per message but cannot chain multi-step plans unless code does the chaining.
- **Worth copying:**
  - Priority-ordered modes with explicit "interrupts" lists.
  - The `unstuck` watchdog with time thresholds.
  - An `only_chat_with` allowlist.
  - Letting known `!commands` from humans bypass the LLM entirely. That costs $0 and fits our budget.

## Tech-tree progress, and whether any LLM agent has beaten the Ender Dragon

### Takeaway
Yes. Two documented 2026 runs defeated the Ender Dragon autonomously:
- A team of 4 Gemini 4 Argon agents: 27 h 14 m, 605 deaths, Easy difficulty.
- A single Claude Opus 5 agent on a custom MCP harness: about 3 h 56 m wall clock. This one is self-published, not peer-reviewed.

Earlier academic agents (2023–2025) generally stopped at diamond. Voyager reached diamond in 1 of 3 trials. GITM claims the full Overworld tech tree, and Optimus-2 diamond-tier tasks succeed only about 11–16% of the time. The hardest late-game steps were the dragon fight itself, blaze-rod/powder logistics and carrying Eyes of Ender safely.

### Cited Findings
- **Voyager**, prompting iterations to each tier (3 trials):

  | Tier | Iterations | Trials succeeded |
  |---|---|---|
  | Wooden | 6±2 | 3/3 |
  | Stone | 11±2 | 3/3 |
  | Iron | 21±7 | 3/3 |
  | Diamond | 102 | 1/3 |

  Without the skill library, diamond was 0/3, and AutoGPT got 0/3 on diamond. Voyager is 15.3×, 8.5× and 6.4× faster at the wooden, stone and iron tiers, and "only method to unlock diamond" among those tested. It finds 3.3× more unique items. — [Voyager HTML](https://arxiv.org/html/2305.16291v2); [abs](https://arxiv.org/abs/2305.16291)
- **GITM:** +47.5% ObtainDiamond success over a prior state of the art of "around 20%", and called the first agent to obtain all items in the Overworld tech tree. — [arXiv 2305.17144](https://arxiv.org/abs/2305.17144)
- **JARVIS-1:** 5× the reliability of prior state of the art on ObtainDiamondPickaxe (no absolute rate on the abstract page). — [arXiv 2311.05997](https://arxiv.org/abs/2311.05997)
- **Optimus-2:** diamond-group crafting tasks succeed roughly 11% (diamond sword) to 16% (diamond shovel/hoe). — [Optimus-2 PDF](https://arxiv.org/pdf/2502.19902) (via search summary; table not opened directly)
- **Optimus-3:** reports 3% on System-1 "Long-Horizon Action" and 60% on open-ended tasks. — [Optimus-3](https://arxiv.org/html/2506.10357v2) (via search summary)
- **PhyAgentOS (2026):** reports 15% on "Armor" in a 67-task benchmark and calls end-game equipment "a frontier task." — [arXiv 2607.16636](https://arxiv.org/pdf/2607.16636) (via search summary)
- **Project Sid:** 25 agents averaged about 17 unique items after 30 minutes. A 49-agent 4-hour run saturated at about 320 of roughly 1,000 items. — [Project Sid HTML](https://arxiv.org/html/2411.00114v1)
- **Gemini 4 Argon team timeline:**

  | Elapsed | Milestone |
  |---|---|
  | ~10 min | Roles settled |
  | < 2 h | Iron tools, diamonds, Nether portal (lit at 1h42m) |
  | ~5.5 h | 15 ender pearls |
  | > 6 h | Blaze powder brought back to the Overworld |
  | 10h45m | Stronghold located by triangulation |
  | 13h17m | End portal activated |
  | ~21 h | Healing crystals identified |
  | ~4h40m after that | All 10 crystals destroyed |
  | 27h14m | Dragon dead |

  The dragon phase took about 14 hours, and the dragon killed the team 69 times. One agent drowned carrying all 12 Eyes of Ender, and they were recovered with about 2.5 minutes to spare. — [arXiv HTML 2610.22319](https://arxiv.org/html/2610.22319)
- **Gemini paper's stated limitations:**
  - Perception is exact (Mineflayer exposes hidden blocks and the dragon's internal state).
  - Easy difficulty (hunger can't kill).
  - Only one run, so reliability is unknown.
  - Six server restarts.

  Source: [arXiv HTML 2610.22319](https://arxiv.org/html/2610.22319)
- **Claude/MCP run:** dragon defeated on 1.21.4, confirmed by the "Free the End" advancement in the server log. Wall clock was 3h56m (00:43–04:40 UTC, 2026-09-15). — [HF dataset](https://huggingface.co/datasets/aibengineering/beat-the-game-minecraft)
- **Press coverage** of the Gemini result (27 h, 605 deaths). — [Engadget](https://www.engadget.com/2289944/google-gemini-4-agents-just-beat-minecraft-with-no-human-intervention/); [TechRepublic](https://www.techrepublic.com/article/news-google-gemini-ai-agents-minecraft-ender-dragon/)

### Inferences
- **Typical milestone difficulty**, from easiest to hardest: wood ≈ trivial, stone ≈ easy, iron ≈ moderate, diamond = the classic wall for 2023–2025 agents. After that come Nether, blazes, eyes/stronghold, and the dragon fight, which only frontier-model coding agents have cleared (2026).
- **Both dragon wins used exact Mineflayer/protocol state rather than pixels.** A code-driven Mineflayer bot like ours has the same perceptual advantage.
- **Neither dragon win is a reliability result.** Both are single runs.

## Cost and latency figures, and cost-reducing designs

### Takeaway
Full-autonomy LLM agents cost on the order of $20–25 per agent-hour at list prices:
- Claude run: $93 for about 4 h.
- Gemini team: about $520 for 4 players over 27 h, which is about $19/h for the team, or about $4.8 per player-hour.

Those runs only stayed affordable because of very heavy prompt caching (88–91% cached input). Academic work reduces cost with cheaper models for sub-tasks (Voyager), open-source fine-tuned models (Odyssey), CPU-only operation (GITM) and non-LLM fast paths (Project Sid reflexes, mindcraft modes). Our ~$10/month budget equals roughly 25–30 minutes of frontier autonomous play, so autonomy-by-LLM is out of reach. The chat-router design fits.

### Cited Findings
- **Gemini 4 Argon players:** about 1.35 B input tokens (91% cached), about 16 M output tokens (4 M of them thinking), about 24,000 model calls. About $520 at introductory list price ($1,040 at standard price). The whole session including the Observer was about $810 ($1,620 at standard price). The authors say these are list-price estimates, not serving cost. 22% of programs ended in error. — [arXiv HTML 2610.22319](https://arxiv.org/html/2610.22319)
- **Claude/MCP run:** API-equivalent cost $93.17, paid via a subscription.
  - Cache reads: 163.3 M tokens = $81.66 (87.7% of cost)
  - Cache writes (1 h TTL): 779 K = $7.79
  - Output: 148 K (including 67 K thinking) = $3.71

  Only about 17.8 minutes (7.5%) of the 3h56m wall clock was spent inside API calls. — [HF dataset](https://huggingface.co/datasets/aibengineering/beat-the-game-minecraft)
- **Voyager:** GPT-4 is about 15× more expensive than GPT-3.5. GPT-3.5 is used for self-asked questions and skill descriptions "for budget reasons." Swapping GPT-4 for GPT-3.5 in code generation gives 5.7× fewer unique items. Cost of GPT-4 calls is listed as a limitation. — [Voyager HTML](https://arxiv.org/html/2305.16291v2)
- **Odyssey** uses open-source LLMs to avoid "the high costs associated with previous work using GPT-4." It notes they are more prone to hallucinations, which lowers performance. — [Odyssey arXiv](https://arxiv.org/abs/2407.15325v1)
- **GITM** needs no GPU training, and "a single CPU node with 32 CPU cores is enough." — [arXiv 2305.17144](https://arxiv.org/abs/2305.17144)
- **Project Sid** uses fast non-LLM networks for reflex modules and the LLM only for slower goal and social reasoning. — [Project Sid HTML](https://arxiv.org/html/2411.00114v1)
- **mindcraft:** modes run locally with no LLM calls. Its context caps (`max_messages` 15, `num_examples` 2, `relevant_docs_count` 5) and the human `!command` bypass all cut tokens per call. — [settings.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/settings.js); [agent.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/agent.js); [modes.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/modes.js)
- **Player2:** the LLM returns one structured command, and a deterministic engine executes it. — [Modrinth player2npc](https://modrinth.com/mod/player2npc); [CurseForge PlayerEngine](https://www.curseforge.com/minecraft/mc-mods/playerengine)

### Inferences
These are my own calculations from the figures above.
- **What our budget buys of frontier play:**
  - Gemini team: $520 / 27.2 h ≈ $19/h, so $10 ≈ 31 minutes of team play.
  - Claude run: $93.17 / 3.93 h ≈ $23.7/h, so $10 ≈ 25 minutes.
- **What our budget buys in messages:** at about $0.0004 per message, $10 is about 25,000 owner messages per month, around 830 per day. That is far more than one owner will send.
- **Our design is about 3–4 orders of magnitude cheaper per hour of play** than the frontier autonomous agents, because the LLM is invoked only on chat.
- **Latency:** the Claude run spent only 7.5% of wall time waiting on the model, but that was with long-running tools. A per-tick LLM would be impossible within Minecraft's 50 ms tick. Every surveyed real-time system keeps reflexes in code or small networks (mindcraft modes on a 300 ms tick; Sid's non-LLM reflex modules).

## Known failure modes of LLM-in-the-loop control in a real-time world

### Takeaway
Recurring failures:
- Hallucinated items, recipes and APIs (Voyager, Odyssey).
- False success claims and self-verification errors (Voyager, Gemini team).
- Getting stuck or looping (Voyager, Project Sid, and mindcraft's need for an `unstuck` watchdog).
- High program error rates (22% in the Gemini run).
- Frequent deaths when reactions depend on model-written code (605 deaths in the Gemini run).
- Hallucinations compounding across modules and agents (Project Sid).

### Cited Findings
- **Voyager:** it proposes nonexistent items (a "copper sword"), writes code that uses cobblestone as fuel, and calls functions absent from the API. The agent sometimes gets stuck, and self-verification fails (it did not recognise spider string as success). — [Voyager HTML](https://arxiv.org/html/2305.16291v2)
- **Odyssey:** open-source LLMs are "prone to generating hallucinations, leading to a decrease in agent performance." — [Odyssey arXiv](https://arxiv.org/abs/2407.15325v1)
- **Project Sid:** hallucinations compound across LLM calls and spread between agents. Agents fall into repetitive action loops, and miscommunication between output streams causes incoherence. Vision, spatial navigation and building are weak. — [Project Sid HTML](https://arxiv.org/html/2411.00114v1)
- **Gemini team:**
  - 605 deaths, mostly to monsters.
  - 22% of programs ended in error.
  - One agent announced a success that had not happened and retracted it two minutes later.
  - Another agent's report was flagged as contradictory.
  - Six server restarts.

  Source: [arXiv HTML 2610.22319](https://arxiv.org/html/2610.22319)
- **mindcraft safeguards in code:** an `unstuck` watchdog (no progress for 20 s → move; still failing after 10 s more → the agent is killed), a ~100 ms budget for mode updates, unknown-command handling that consumes an iteration, and a `max_commands` cap. — [modes.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/modes.js); [agent.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/agent.js)
- **MineCollab:** agents degrade by up to 15% when they must communicate detailed plans, so natural-language communication is a bottleneck. — [arXiv 2504.17950](https://arxiv.org/abs/2504.17950)

### Inferences
- **Our strict tool-call schema removes whole failure classes:**
  - No free-form code means no hallucinated APIs.
  - Item names can be enum-validated against minecraft-data.
  - Reflexes in code avoid slow reactions.
- **What remains:**
  - Misrouting intent: the wrong tool or the wrong arguments.
  - Code-side "ensure" chains getting stuck or looping. An mindcraft-style `unstuck` watchdog and priority-ordered reflexes address this.

## Gaps
- **Not verified in this session** (pointers come from background knowledge and must be checked before citing):
  - **DEPS** ("Describe, Explain, Plan and Select", arXiv 2302.01560): LLM planner with explanation-based replanning and a learned goal selector.
  - **Plan4MC** (arXiv 2303.16563): RL-learned basic skills plus an LLM-built skill graph for planning.
  - **MineDojo/MineCLIP** (arXiv 2206.08853): benchmark suite plus a video-language reward model.
  - **VPT** (arXiv 2206.11795): video-pretrained behavioural-cloning policy. It reportedly reached a diamond pickaxe with RL fine-tuning.
  - **STEVE-1** (arXiv 2306.00937): text/visual-instruction-conditioned VPT.
  - **Optimus-1** (arXiv 2408.03615): hybrid multimodal memory.
  - **MineLand** (arXiv 2403.19267): multi-agent simulator built on Mineflayer with limited multimodal senses.

  None of these were fetched, so their observation formats, results and costs are uncited.
- **Missing details:**
  - GITM internal layers (LLM Decomposer / Planner / Interface) and its exact ObtainDiamond rate (about 67.5% is implied by "+47.5%" over about 20%, but not confirmed from full text).
  - JARVIS-1 absolute success rates and controller identity. It is believed to be STEVE-1-based, which is unconfirmed.
- **No cost or latency figures found** for Voyager (dollars or tokens per run), Project Sid, mindcraft, JARVIS-1 or Player2. The Player2 pricing model was not checked.
- **Model-call latency** for the Gemini run was not reported, only program runtimes.
- **mindcraft internals not read:**
  - The self-prompter internals (`self_prompter.js`).
  - The memory summarization module (`history.js`). Whether old turns are summarized was not confirmed.
  - The full `!command` list (`commands/actions.js`, `queries.js`).
- **The Claude/MCP run and SeekerCraft are self-reported community projects.** The Claude run is corroborated only by its own server log. SeekerCraft's dragon completion is unconfirmed (finale tier listed as pending).
- **Commercial companions:** no primary docs found for Altera's later commercial products or for other "AI friend" mods beyond Player2NPC/PlayerEngine.
- **MCU benchmark leaderboard values** for the surveyed agents were not found.
