# Programmatic video tooling for vertical (1080x1920) software devlog videos — state as of 26 November 2026

Method note: version numbers, release dates, star counts and licences marked "(registry)" were read directly from the npm registry, PyPI and the GitHub public API on 2026-11-26. Policy quotes were read from the primary pages on the same day. Anything taken only from a search-result summary or a vendor blog is flagged as such.

## 1. Programmatic video frameworks: Remotion, Motion Canvas, Revideo, HyperFrames, Manim, ffmpeg — which are maintained, which suit an agent

### Takeaway
Remotion (still 4.x — v4.0.547, 24 Nov 2026; Remotion 5 is not released) and HeyGen's HyperFrames (real, Apache-2.0, v0.9.98, 26 Nov 2026) are the two actively developed, agent-first options; both ship official Agent Skills / Claude Code plugins. Motion Canvas is effectively dormant (last release Dec 2024), Revideo is alive but slow (last release Jul 2026), Manim is active but Python.

### Cited Findings

**Remotion**
- Latest version is 4.0.547, published 2026-11-24; releases land roughly every 2-5 days (4.0.540 on 2 Nov → 4.0.547 on 24 Nov). There is no 5.x on npm; dist-tags only show 4.x — [npm: remotion](https://www.npmjs.com/package/remotion), [GitHub releases](https://github.com/remotion-dev/remotion/releases)
- Repo has 75,858 stars and was pushed on 2026-11-26 (registry) — [remotion-dev/remotion](https://github.com/remotion-dev/remotion)
- Remotion 5 is only "prepared": release notes mention stronger company-licence wording for the 5.0 terms (v4.0.545), an arc-tangent fix prepared for Remotion 5 (v4.0.541) and a v5 error for zero-width `fitText()` (v4.0.542) — [GitHub releases](https://github.com/remotion-dev/remotion/releases)
- The "Prepare Remotion 5.0" pull request (#3750) was opened 2024-04-22 and is still open/unmerged — [PR #3750](https://github.com/remotion-dev/remotion/pull/3750)
- Licence (current LICENSE.md, copyright 2026): free, including commercial use, for "an individual", "a for-profit organization with up to 3 employees", non-profits, and evaluators; everyone else needs a Company License. It is source-available, not OSI open source ("SEE LICENSE IN LICENSE.md") — [LICENSE.md](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)
- Planned 5.0 licence changes: contractors count towards team size; the eligibility line becomes "an organization or team of individuals with up to 3 people"; a new clause forbids operating "a rendering service that allows end-users to bring or upload their own Remotion code" without written approval, regardless of Free License eligibility; the company licence is bound to new Terms and Conditions — [PR #3750](https://github.com/remotion-dev/remotion/pull/3750)
- Company pricing: "Remotion for Creators" $25 per seat per month; "Remotion for Automators" $0.01 per render, billed in blocks of 1,000 ($10), $100/month minimum; Enterprise from $500/month. Free License includes all features and unlimited commercial use for individuals and companies of up to 3 people — [Remotion licence & pricing](https://www.remotion.dev/docs/license/pricing)
- New in 2026 (from release notes): "proper motion blur" incl. a `motionBlur` option on transitions (v4.0.545); `npx remotion whisper` commands for local transcription (v4.0.546); new effects `magnify()`, `lightning()`, weather, burn, wipe (v4.0.540-542); `remotion elements use` (v4.0.542); OpenTimelineIO export in the render skill (v4.0.544) and `open-timeline import` (v4.0.543); guides on styling and editing captions (v4.0.547) — [GitHub releases](https://github.com/remotion-dev/remotion/releases)
- 11 Nov 2026 blog post: "Remotion now has Agent Skills and it has become the default way people make videos with Remotion"; the Studio is now "fully interactive and allow[s] you to select, drag, trim, crop, edit stuff" — [Remotion blog](https://www.remotion.dev/blog)
- Client-side rendering (`@remotion/web-renderer`, `renderMediaOnWeb()`) is stable from v4.0.491; it encodes with WebCodecs via Mediabunny instead of FFmpeg and is "limited to a subset of HTML elements" — [Client-side rendering docs](https://www.remotion.dev/docs/client-side-rendering)
- Remotion sponsors Mediabunny ($1,000/month, announced 1 Sep 2025) and is phasing out its own Media Parser/WebCodecs libraries — [Remotion blog](https://www.remotion.dev/blog)
- Official Agent Skills: install with `npx remotion skills add` (inside a project), `npx skills add remotion-dev/skills`, `gh skill install remotion-dev/skills`, or `npx create-video@latest --skills`. Named agents: Claude Code, Codex, Cursor, Kimi Code, OpenCode. Skills: `/remotion-best-practices`, `/remotion-create`, `/remotion-markup`, `/remotion-studio`, `/remotion-render`, `/remotion-maps`, `/remotion-elements`, `/remotion-captions`, `/remotion-saas`, `/remotion-interactivity`, `/remotion-docs`, `/remotion-license`, `/remotion-upgrade`, `/remotion-multimedia`. There is no dedicated 3D skill (3D appears only as CesiumJS flyovers in the maps skill) — [Remotion Agent Skills docs](https://www.remotion.dev/docs/ai/skills)
- The skills repo has 8,035 stars and was pushed 2026-11-24 (registry) — [remotion-dev/skills](https://github.com/remotion-dev/skills)
- Official free templates include: Blank, Hello World, Recorder ("a video production tool built entirely in JavaScript"), 3D (React Three Fiber), Audiogram, Music Visualization, Prompt to Video ("a story with images and voiceover from a prompt"), Overlay, Code Hike ("Beautiful code animations"), Stargazer ("Celebrate your repo stars with a video"), TikTok ("Generate animated word-by-word captions") — [Remotion templates](https://www.remotion.dev/templates)
- `@remotion/shiki` does not exist: the npm registry returns "Not found" for that name (checked 2026-11-26). The official code-animation route is the Code Hike template; `codehike` is at 1.1.0 (2026-03-17, MIT) — [npm: codehike](https://www.npmjs.com/package/codehike), [template-code-hike](https://github.com/remotion-dev/template-code-hike)
- Remotion "Elements" are editable building blocks installed as source; the docs' llms.txt says each Element's Markdown includes its install command and source code. A third-party shadcn-style library `remotion-bits` (0.2.1, 2026-09-15, MIT) also exists — [Remotion llms.txt](https://www.remotion.dev/llms.txt), [npm: remotion-bits](https://www.npmjs.com/package/remotion-bits)

**HyperFrames (HeyGen) — verified to exist**
- HyperFrames is an open-source HeyGen framework: "Write HTML. Render video. Built for agents." No React; compositions are HTML/CSS/JS with seekable animations. Licence Apache-2.0 — [heygen-com/hyperframes README](https://github.com/heygen-com/hyperframes)
- npm `hyperframes` first published 2026-03-23; latest 0.9.98 published 2026-11-26 (i.e. ~98 patch releases of 0.9 alone; still pre-1.0). GitHub: 90,508 stars, pushed 2026-11-26 (registry) — [npm: hyperframes](https://www.npmjs.com/package/hyperframes), [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)
- Rendering: the engine seeks each frame in headless Chrome (Puppeteer) and encodes with FFmpeg; `@hyperframes/engine` is described as "Seekable web page to video rendering engine (Puppeteer + FFmpeg)". Requirements: Node.js 22+ and FFmpeg (Bun is not mentioned) — [README](https://github.com/heygen-com/hyperframes), [npm: @hyperframes/engine](https://www.npmjs.com/package/@hyperframes/engine)
- CLI: `npx hyperframes init`, `preview`, `check`, `render --output video.mp4`, `cloud render`, `add` (install blocks), `skills update` — [README](https://github.com/heygen-com/hyperframes), [developer docs](https://hyperframes.heygen.com/developers/index.md)
- Composition format: a root `<div data-composition-id data-start data-duration data-width data-height>` with clips carrying `data-start`, `data-duration`, `data-track-index`; "HTML and CSS control what appears; `data-*` attributes control when it appears" — [developer docs](https://hyperframes.heygen.com/developers/index.md)
- Agent support: `npx skills add heygen-com/hyperframes`; Claude Code plugin via `claude plugin marketplace add heygen-com/hyperframes` then `claude plugin install hyperframes@hyperframes`; 9 skills (`/hyperframes`, `/hyperframes-cli`, `/hyperframes-registry`, `/media-use` for voiceover/music/SFX, `/reverse-any-video`, `/style-sampling`, `/figma`, `/slideshow`, `/remotion-to-hyperframes`) — [README](https://github.com/heygen-com/hyperframes)
- Supported animation runtimes: GSAP, CSS animations, Lottie, Three.js, Anime.js, WAAPI, or a custom frame adapter. Registry of ~450 blocks installed as editable source (transitions, overlays, titles, kinetic type, captions, charts, maps, 3D, camera moves) — [README](https://github.com/heygen-com/hyperframes)
- The README's own comparison: HyperFrames = HTML + CSS, no build step, Apache-2.0; Remotion = React components, bundler required, "source-available Remotion License", and a more mature cloud renderer (Lambda) — [README](https://github.com/heygen-com/hyperframes)
- HeyGen also runs a hosted Studio/cloud render and chat connectors; listed as a Claude plugin and connector — [claude.com/plugins/hyperframes](https://claude.com/plugins/hyperframes), [HeyGen help](https://help.heygen.com/en/articles/15001510-hyperframes-x-heygen)

**Motion Canvas**
- Latest release v3.17.2 dated 2024-12-14; an unreleased 3.18.0-alpha.0 tag exists on npm. Recent commit history: a cluster on 2025-02-16, then a single docs commit on 2026-07-02. 20,256 stars, MIT, not archived (registry) — [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas), [npm: @motion-canvas/core](https://www.npmjs.com/package/@motion-canvas/core)
- Remotion's own comparison: Motion Canvas renders to a single canvas element (Remotion uses a whole DOM tree) and "is truly open source software" — [Remotion vs Motion Canvas](https://www.remotion.dev/docs/compare/motion-canvas)

**Revideo**
- The repo moved to `midrender/revideo` (old `redotvideo/revideo` URL redirects). 4,241 stars, MIT, last push 2026-07-15; latest npm release `@revideo/core` 0.11.0 on 2026-07-10 (registry) — [midrender/revideo](https://github.com/midrender/revideo), [npm: @revideo/core](https://www.npmjs.com/package/@revideo/core)
- Current README: "a rendering engine for creating videos in code... A scene is plain TypeScript, so Claude or Codex can produce one from a prompt. Revideo borrows concepts from Remotion and Rive, but is, in its core, zero dep. It's the engine behind Midrender." Scenes are generator functions (`makeScene2D`); headless `renderVideo()`, parallelised rendering, React `<Player/>`; anonymous PostHog telemetry on by default (`DISABLE_TELEMETRY=true`) — [Revideo README](https://github.com/midrender/revideo)
- A secondary guide describes Revideo as "the open-source fork of Motion Canvas"; another calls it a fork of Remotion — the sources conflict, and the current README mentions neither — [PkgPulse](https://www.pkgpulse.com/guides/remotion-vs-motion-canvas-vs-revideo-programmatic-video-2026); contradicted by [AutoAE](https://autoae.online/blog/revideo-vs-remotion-2026)

**Manim, ffmpeg-level tools**
- Manim Community v0.22.1 released 2026-10-27; 42,931 stars, MIT, pushed 2026-11-26 (registry). Python, not TypeScript — [ManimCommunity/manim](https://github.com/ManimCommunity/manim)
- A JS port `manim-web` exists on npm (0.42.0, 2026-11-15, MIT; first published 2026-02-11); quality not evaluated — [npm: manim-web](https://www.npmjs.com/package/manim-web)
- `editly` (declarative ffmpeg-based CLI video editing) was last pushed 2025-05-12 — [mifi/editly](https://github.com/mifi/editly)

### Inferences
- For someone who already has a working Remotion project and a narration + caption pipeline, staying on Remotion has the lowest switching cost: the Free License covers a solo individual (and stays so under the 5.0 wording as long as the "team" is ≤3 people including contractors), and the official skills now cover captions, rendering and markup.
- HyperFrames is the only credible new alternative: Apache-2.0 removes licence questions entirely, it has a larger ready-made block catalogue aimed at short-form (captions, code diff, kinetic type), and an agent can write plain HTML/GSAP with no bundler. Costs: pre-1.0 with daily releases (API churn risk), Node 22+ rather than Bun, and existing React compositions would need porting (HeyGen ships a `/remotion-to-hyperframes` skill for that).
- Motion Canvas should be treated as unmaintained for new work (no release in ~23 months). Revideo is usable but low-velocity and now tied to a commercial product (Midrender).
- Manim only makes sense for maths/diagram-heavy scenes and would add a Python toolchain; plain ffmpeg remains useful as glue (concatenation, audio ducking, loudness normalisation, 9:16 crop of footage) rather than as the composition layer.

### Gaps
- No release date for Remotion 5.0 was found; the licence-change PR has been open since April 2024.
- I could not read an independent, dated hands-on review comparing HyperFrames and Remotion render speed or agent success rates (the one review URL found returned 404). Claims about which framework agents write "better" are unverified.
- Whether Remotion's CLI/renderer runs fully under Bun (vs Node) on Apple Silicon in Nov 2026 was not checked; the docs only confirm specific packages (e.g. `createTikTokStyleCaptions()`) work in Bun.
- The HyperFrames README does not state render-speed numbers or a limitations list.

## 2. Visualising what the bot does without game footage (2D/2.5D inside the video framework)

### Takeaway
Everything needed exists as MIT-licensed browser libraries — `deepslate` (Minecraft block/structure/item rendering over WebGL), `skinview3d` (three.js player skins), `prismarine-viewer` (three.js world viewer with a headless recording mode) — and Remotion officially supports three.js via `@remotion/three` provided Chromium is started with the ANGLE GL backend. None of the Minecraft libraries documents use inside Remotion/headless Chromium, so that integration is unproven and has to be prototyped.

### Cited Findings
- `@remotion/three` (4.0.547, MIT) provides `<ThreeCanvas>`, which lets `useCurrentFrame()` and other Remotion hooks work inside a React Three Fiber canvas; animation is driven from the frame number in markup rather than in `useFrame()`. There is also `<ThreeWebGPUCanvas>` (three.js `WebGPURenderer`, TSL node materials). `<Sequence>` must use `layout="none"` inside the canvas — [@remotion/three docs](https://www.remotion.dev/docs/three)
- Headless requirement: "Three.js doesn't work with Chromium's default OpenGL renderer", so the docs recommend `Config.setChromiumOpenGlRenderer('angle')`; for programmatic rendering pass `chromiumOptions: { gl: "angle" }` to `renderMedia()`/`renderFrames()`/`getCompositions()` because the config file does not apply there — [@remotion/three docs](https://www.remotion.dev/docs/three)
- `useVideoTexture()` and `useOffthreadVideoTexture()` are deprecated; `@remotion/media` is the recommended way to use video as a three.js texture — [@remotion/three docs](https://www.remotion.dev/docs/three)
- There is an official Remotion "3D" starter template (Remotion + React Three Fiber) — [Remotion templates](https://www.remotion.dev/templates)
- Current versions: `three` 0.187.0 (2026-10-30), `@react-three/fiber` 9.8.2 (2026-10-14) (registry) — [npm: three](https://www.npmjs.com/package/three), [npm: @react-three/fiber](https://www.npmjs.com/package/@react-three/fiber)
- `deepslate` (misode): "Library for rendering and emulating parts of Minecraft"; v0.27.3 published 2026-11-16, MIT, 270 stars, pushed 2026-11-16 (registry). README shows building a `Structure` in code (e.g. stone and cactus blocks) and drawing it with `StructureRenderer` on a `canvas.getContext('webgl')` context; it also covers NBT reading/writing and worldgen pieces (noise, splines, chunk generator) — [misode/deepslate](https://github.com/misode/deepslate), [npm: deepslate](https://www.npmjs.com/package/deepslate)
- deepslate needs a `resources` object; the repo's demo builds it by fetching block definitions, models, item definitions and a pre-built texture atlas (`atlas/all/atlas.png` + UV map) from `raw.githubusercontent.com/misode/mcmeta/`, and imports `StructureRenderer`, `ItemRenderer`, `VoxelRenderer` and `TextureAtlas` — [deepslate demo/main.ts](https://github.com/misode/deepslate/blob/main/demo/main.ts)
- `skinview3d`: "Three.js powered Minecraft skin viewer"; v3.4.2 published 2026-05-03, MIT, 750 stars, pushed 2026-11-25 (registry). Supports capes, ears, elytra, a background colour/image/panorama, and built-in animations (`new skinview3d.WalkingAnimation()`, with `animation.speed` and `animation.paused`) on a supplied `<canvas>` — [bs-community/skinview3d](https://github.com/bs-community/skinview3d)
- `prismarine-viewer`: v1.33.0 published 2025-02-09 (no npm release since), MIT, repo pushed 2026-10-06 (registry). Supports Minecraft 1.8.8 through 1.21.4; "other versions of the same major... render with the textures and models of the closest supported one". Has a `headless` export that records the bot's view as a video file or streams it over TCP (`frames` option, default 200) — [PrismarineJS/prismarine-viewer README](https://github.com/PrismarineJS/prismarine-viewer)
- `zardoy/minecraft-web-client` (a full browser Minecraft client built on the Prismarine stack) is MIT and was pushed 2026-11-26 (registry) — [zardoy/minecraft-web-client](https://github.com/zardoy/minecraft-web-client)
- Offline (non-browser) alternatives surfaced by search: Chunky (GPLv3 path tracer with a headless mode that needs a Minecraft version jar for textures) and `minecraft-render` (three.js block-model renderer that needs a display server such as xvfb in CI) — [Chunky headless docs](https://chunky-dev.github.io/docs/reference/user_interface/chunky_launcher/headless), [npm: @leftsquarebracket/minecraft-render](https://www.npmjs.com/package/@leftsquarebracket/minecraft-render)
- HyperFrames lists Three.js as a supported runtime and its catalogue has a "3D" category (e.g. "Exploded Stack: isometric layer plates explode apart with a label beside each layer") — [HyperFrames README](https://github.com/heygen-com/hyperframes), [HyperFrames catalog](https://hyperframes.heygen.com/_llms/catalog/catalog.txt)
- Mojang's music article defines "Minecraft content" broadly as "material related to the Minecraft intellectual property" and allows monetised videos under the Minecraft Usage Guidelines — [minecraft.net](https://www.minecraft.net/en-us/article/can-i-use-minecraft-music-)
- YouTube's disclosure rules list "Gameplay footage from video games" and clearly non-realistic/animated content among things creators do not need to disclose as altered/synthetic — [YouTube Help: altered or synthetic content](https://support.google.com/youtube/answer/14328491?hl=en)

### Inferences
- A deterministic "replay" is feasible: log block changes/positions/inventory per tick from the bot, then render a top-down or isometric scene as a pure function of the frame number. Two routes: (a) plain react-three-fiber instanced cubes with flat colours or atlas textures inside `<ThreeCanvas>` — fully under Remotion's frame control and the lowest-risk option; (b) deepslate's `StructureRenderer` on a raw WebGL canvas inside a Remotion component for authentic block models — it needs only a WebGL context, so it should work in Chromium with `gl: "angle"`, but nobody documents it.
- `skinview3d` and `prismarine-viewer` run their own render/animation loops (wall-clock driven), which conflicts with frame-by-frame deterministic rendering; they would need their animation progress set explicitly per frame and a manual `render()` call, with async asset loading wrapped in Remotion's `delayRender()`. `prismarine-viewer`'s own headless recorder is a separate real-time capture path (output would then be imported as footage), and its version coverage stops at 1.21.4.
- HUD overlays (inventory grid, task queue, health/food bars, "bot's thoughts" bubbles, decision trees) are ordinary HTML/CSS/SVG and need no special library in either Remotion or HyperFrames; they are the cheapest and most agent-friendly part.
- deepslate's demo pulls Mojang's textures via the `misode/mcmeta` repo at runtime; for reproducible renders these assets should be vendored locally, and network fetches during render avoided.

### Gaps
- No source confirms deepslate, skinview3d or prismarine-viewer running inside Remotion or any headless-Chromium frame renderer; this needs a spike.
- Which Minecraft versions deepslate/mcmeta currently track was not confirmed (the README lists none).
- I did not verify the Minecraft Usage Guidelines / EULA text on using Mojang's block textures and models in monetised videos rendered outside the game; the music article implies videos about Minecraft are welcome, but asset reuse terms need a direct read.
- GPU/ANGLE behaviour and render speed of WebGL scenes on Apple Silicon headless Chromium were not measured or sourced.

## 3. Devlog-specific visuals: code diffs, git-history visualisers, terminal recordings, changelog cards, diagrams

### Takeaway
Code animation is solved in both ecosystems (Remotion's Code Hike template; HyperFrames' Code Diff / Code Morph / Highlight Sweep blocks built on Shiki Magic Move). Gource and VHS are maintained and accept arbitrary output sizes, so both can emit native 1080x1920; everything else (changelog cards, split screens, animated diagrams) is plain HTML/SVG in the composition.

### Cited Findings
- Remotion's Code Hike template ("Beautiful code snippet animations"): snippets live as files in `public/`, changing them changes the animation; more variants are in Code Hike's `with-remotion` examples. Template repo pushed 2026-11-23 (registry) — [remotion-dev/template-code-hike](https://github.com/remotion-dev/template-code-hike)
- `shiki-magic-move` (token-level morphing between code states) is at 1.4.0 (2026-06-03, MIT) — [npm: shiki-magic-move](https://www.npmjs.com/package/shiki-magic-move)
- HyperFrames catalogue "Code Animations" blocks: "Code Diff" (removed lines collapse in red, added lines expand in green), "Code Morph" (tokens glide between positions; uses Shiki Magic Move), "Code Highlight Sweep" (highlight band on a target line while context dims), "Code 3D Extrude" — [HyperFrames catalog](https://hyperframes.heygen.com/_llms/catalog/catalog.txt)
- Gource: v0.56 released 2026-03-06, GPL-3.0, 13,218 stars (registry). Options include `-WIDTHxHEIGHT, --viewport` (set viewport size), `-o/--output-ppm-stream FILE` (pipe frames to ffmpeg), output framerate 25/30/60, `--hide DISPLAY_ELEMENT`, `--title`, and a caption file with `--caption-size/-colour/-duration/-offset` — [Gource README](https://github.com/acaudwell/Gource)
- Standard Gource→ffmpeg usage is `gource -WxH -o - | ffmpeg ... libx264` — [freeCodeCamp](https://freecodecamp.org/news/using-gource-to-show-your-project-timeline)
- VHS (Charm): v0.12.1 released 2026-09-24, MIT, 21,418 stars (registry). Scripted `.tape` files with `Set Width`, `Set Height`, `Set FontSize`; `Output` to `.gif`, `.mp4` or `.webm`; requires `ttyd` and `ffmpeg` on PATH — [charmbracelet/vhs README](https://github.com/charmbracelet/vhs)
- asciinema: v3.2.1 released 2026-06-16, GPL-3.0 (registry); `asciinema-player` 3.19.0 published 2026-11-22, Apache-2.0 — [asciinema/asciinema](https://github.com/asciinema/asciinema), [npm: asciinema-player](https://www.npmjs.com/package/asciinema-player)
- `svg-term-cli` (asciicast → animated SVG) last published to npm on 2018-01-21; repo last pushed 2024-05 — [npm: svg-term-cli](https://www.npmjs.com/package/svg-term-cli)
- `pomber/git-history` (file-history browser by the Code Hike author) was last pushed 2024-10 — [pomber/git-history](https://github.com/pomber/git-history)
- Remotion has a "Stargazer" template (repo-stars celebration video) and a `/remotion-maps` skill; recent releases added motion blur and effects usable on transitions — [Remotion templates](https://www.remotion.dev/templates), [GitHub releases](https://github.com/remotion-dev/remotion/releases)
- A generic ffmpeg recipe for converting landscape footage to 9:16 is crop-then-scale to 1080x1920 — [DEV Community](https://dev.to/dak425/how-to-replicate-the-output-of-the-fullscreen-template-from-streamladder-684)

### Inferences
- Gource at `-1080x1920` and VHS with `Set Width 1080` / `Set Height 1920` should produce native vertical output (both simply take a viewport size); I found no source demonstrating portrait output specifically, so font sizes and Gource's layout (designed for wide trees) need a visual check. Both produce a video file that is then embedded in the composition as footage.
- For a 30-60 s vertical short, a full-file diff is unreadable; the practical pattern is 6-12 lines of large-type code with a token morph or red/green diff, one idea per shot — which the Code Hike and HyperFrames blocks are designed for.
- A deterministic terminal "recording" can also be rendered directly in the composition (typewriter text in a styled div) with no external tool; VHS is only worth it when real program output is wanted.
- Changelog cards, before/after split screens and animated architecture diagrams have no dedicated tool worth adopting; they are data-driven React/HTML components fed from a JSON derived from `git log`.

### Gaps
- No source showed Gource or VHS output specifically at 1080x1920.
- I did not evaluate Mermaid/D2/Excalidraw-style animated diagram tooling inside video frameworks; no evidence gathered either way.
- Whether Code Hike 1.1.0 (last release March 2026, repo last pushed 2026-03-17) is still actively developed is unclear; the Remotion template itself is maintained.

## 4. Voiceover: state of TTS in late 2026, cloning, prices, local models, AI voice vs own voice

### Takeaway
ElevenLabs has moved past v3 — its model list now leads with Eleven v4 and v4 Turbo — and remains the premium hosted option (≈$0.08 per 1K characters for v3 on the API; Starter $6/month includes a commercial licence and instant voice cloning). OpenAI's `gpt-4o-mini-tts` (≈$0.015/min) is deprecated with shutdown on 6 Jan 2027. Locally on Apple Silicon, Kokoro-82M (Apache-2.0, no cloning) is the fast default and Chatterbox (MIT, zero-shot cloning, watermarked output) still works but was declared retired/unmaintained in August 2026. There is no independent data on audience reception of AI voices in devlogs.

### Cited Findings

**ElevenLabs**
- Current model list: `eleven_v4` ("our most emotionally rich, expressive speech synthesis model", 90+ languages, "supports high-fidelity voice cloning with reliable speaker preservation"), `eleven_v4_turbo` (~100 ms, real-time), `eleven_v3` ("human-like and expressive", 70+ languages), `eleven_v3_conversational`, `eleven_flash_v2_5`; speech-to-text `scribe_v3` (successor to `scribe_v2`) — [ElevenLabs models docs](https://elevenlabs.io/docs/overview/models)
- API pricing page: Eleven v3 $0.08 per 1K characters (~$0.08/minute), Multilingual v2 $0.08 per 1K, Flash/Turbo v2.5 $0.04 per 1K; Scribe batch speech-to-text $0.20 per hour — [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- A third-party check (Sept 2026) lists v3 at $0.10 per 1K characters, i.e. the sources disagree — [ModelsLab](https://modelslab.com/elevenlabs-api-pricing); contradicted by [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- Subscription plans (monthly): Free $0 / 10k credits; Starter $6 / 30k credits, commercial licence, Instant Voice Cloning; Creator $22 / 121k credits, adds Professional Voice Cloning; Pro $99 / 600k; Scale $299 / 1.8M. Audio 128 kbps 44.1 kHz (192 kbps from Pro) — [ElevenLabs pricing](https://elevenlabs.io/pricing)
- The API pricing page presents different included allowances for the same tiers (e.g. Starter ≈75,000 TTS characters, Creator ≈275,000), so credit↔character conversion differs by page/model — [ElevenLabs API pricing](https://elevenlabs.io/pricing/api); differs from [ElevenLabs pricing](https://elevenlabs.io/pricing)
- "Voice Library voices cannot be used through the API on Free" — [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- Eleven Music costs about 900 credits per minute with commercial-use licensing on Starter and above; sound effects cost 200 credits per generation (or 40 credits/second with manual duration) — [ElevenLabs pricing](https://elevenlabs.io/pricing)

**OpenAI**
- `gpt-4o-mini-tts` is priced at $0.60 per million text input tokens and $12 per million audio output tokens — [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts); launch coverage estimated ≈$0.015 per minute — [VentureBeat](https://venturebeat.com/ai/openais-new-voice-ai-models-gpt-4o-transcribe-let-you-add-speech-to-your-existing-text-apps-in-seconds/)
- OpenAI's deprecations page lists `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` and its snapshots (`-2025-03-20`, `-2025-12-15`) for shutdown on 6 Jan 2027 (notice 1 Oct 2026), recommended replacement `gpt-realtime-2.1-mini` — [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- The same page lists `whisper-1`, `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` for shutdown on 26 Feb 2027 (notice 26 Aug 2026), replacements `gpt-transcribe` or `gpt-live-transcribe` — [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- OpenAI's text-to-speech guide has a "Custom voices" section ("create a unique voice for your agent or application") — [OpenAI TTS guide](https://developers.openai.com/api/docs/guides/text-to-speech)

**Local / open models on Apple Silicon**
- Kokoro-82M: 82M parameters, Apache-2.0 weights; v1.0 published 27 Jan 2025 with 8 languages and 54 voices; the card states "as of April 2025, the market rate of Kokoro served over API is under $1 per million characters" and welcomes commercial deployment; training data excluded synthetic audio and custom voice clones — [Kokoro-82M model card](https://huggingface.co/hexgrad/Kokoro-82M)
- Kokoro has no voice cloning, only its fixed voices (June 2026 comparison) — [localaimaster](https://localaimaster.com/blog/kokoro-vs-xtts-vs-chatterbox)
- Kokoro tooling: `kokoro-js` 1.2.1 (2025-05-03, Apache-2.0) for Node/browser; `kokoro` PyPI 0.9.4 (2025-04-05); upstream repo last pushed 2025-08-06; `kokoro-mlx` 0.1.4 (2026-10-15, MIT); `mlx-audio` 0.6.8 (2026-11-23, MIT) (registry) — [npm: kokoro-js](https://www.npmjs.com/package/kokoro-js), [PyPI: kokoro-mlx](https://pypi.org/project/kokoro-mlx/), [PyPI: mlx-audio](https://pypi.org/project/mlx-audio/)
- A Core ML port reports 30 seconds of speech generated in 379 ms on a Mac Studio, claimed 2x faster than MLX on the same hardware (author's own benchmark) — [mattmireles/kokoro-coreml](https://huggingface.co/mattmireles/kokoro-coreml)
- Chatterbox (Resemble AI): the README now opens with "As of August 2026, Chatterbox is retired research and is no longer maintained... The code stays public as an archive under the MIT license, with no support, updates, or paid tier"; Resemble AI now builds deepfake-detection models — [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox)
- Chatterbox family: Turbo (350M, English, paralinguistic tags like `[laugh]`, one-step decoder), Nano (110M, "3x faster than realtime on 8 CPU cores"), Multilingual V3 (500M, 23+ languages), original Chatterbox (500M English, CFG and exaggeration controls). Generation takes a reference clip for zero-shot voice cloning; examples accept `device = "cuda"` or `"cpu"` / `"mps"`; developed and tested on Python 3.11 / Debian 11 — [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox)
- "Every audio file generated by Chatterbox includes Resemble AI's Perth (Perceptual Threshold) Watermarker — imperceptible neural watermarks that survive MP3 compression, audio editing, and common manipulations" — [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox)
- `chatterbox-tts` on PyPI is 0.1.7 (2026-03-26, MIT); 28,121 GitHub stars (registry) — [PyPI: chatterbox-tts](https://pypi.org/project/chatterbox-tts/)

**Disclosure and reception**
- YouTube lists "Cloning one's own voice to create voice overs or dubs" among uses that do not require the altered/synthetic-content disclosure, alongside "production assistance" (script, outline, thumbnail, title) and "caption creation" — [YouTube Help](https://support.google.com/youtube/answer/14328491?hl=en)
- TikTok's Direct Post API has an `is_aigc` boolean: "Set to true if the video is AI generated content"; the video is then labelled "Creator labeled as AI-generated" — [TikTok Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- Reception evidence is vendor-sourced only: a dubbing vendor reports AI-only dubbed tracks held viewers 4-10x less than professionally dubbed ones (localisation, not devlogs) — [AIR Media-Tech](https://air.io/en/creators-spotlight/ai-dubbing-retention-3-youtube-case-studies); a voice-tool blog claims 65% vs 13% retention for "professional" vs "basic AI" voice without methodology — [Virvid](https://virvid.ai/blog/elevenlabs-vs-built-in-ai-voices-youtube-2026); a developer's anecdote describes switching to AI narration to avoid retakes — [DEV Community](https://dev.to/blogai/i-stopped-recording-voiceovers-for-my-tech-youtube-channel-heres-what-happened-564i)

### Inferences
- Cost is negligible at this scale: a 45-second script is roughly 600-750 characters, i.e. about $0.05-0.06 per take on ElevenLabs v3 API rates and effectively free locally. Quality, voice identity and licence terms matter more than price.
- Anything built on OpenAI `gpt-4o-mini-tts`, `tts-1` or `whisper-1` needs migrating within ~6-13 weeks of this note (6 Jan and 26 Feb 2027 shutdowns).
- A clone of the developer's own voice (ElevenLabs Instant Voice Cloning on Starter; or local Chatterbox from a reference clip) gives a consistent, recognisable narrator and, on YouTube, falls under the "own voice clone" no-disclosure example. Chatterbox's "retired" status means no fixes going forward, and its outputs carry an inaudible watermark.
- Kokoro is the lowest-friction local default for iteration (tiny, Apache-2.0, Node package available), with a paid/cloned voice used only for the final take if desired.

### Gaps
- Google's TTS offering (Gemini TTS / Chirp) was not researched; no findings.
- The API price of Eleven v4 specifically, and whether the ElevenLabs Free tier permits commercial use / requires attribution, were not shown on the pages read.
- A third-party aggregator claims a "GPT-Live 1" TTS replacement at $0.05/minute; I could not confirm this on OpenAI's own pages.
- Other 2026 open models that may matter on Apple Silicon (e.g. newer MLX-native cloning models) were not surveyed beyond Kokoro and Chatterbox; `f5-tts-mlx` exists on PyPI (0.2.6, March 2025) but was not evaluated.
- No independent study of audience reaction to AI narration in programming/devlog shorts was found; all numbers above come from vendors with a stake.

## 5. Captions: word-level timestamps and animated word-by-word styles

### Takeaway
Remotion's caption stack is complete and first-party: `@remotion/captions` (`createTikTokStyleCaptions()`), the 1080x1920 TikTok template using whisper.cpp, new `npx remotion whisper` commands, in-Studio WebGPU transcription and caption editing, and adapters for OpenAI Whisper and ElevenLabs output. When the narration is synthesised from a known script, forced alignment (ElevenLabs Forced Alignment API or WhisperX) is the more exact route than re-transcribing. Evidence that animated word-by-word captions beat static ones is vendor-only.

### Cited Findings
- `createTikTokStyleCaptions()` (since v4.0.216; works in browser, Node.js and Bun) groups `Caption` objects (`text`, `startMs`, `endMs`, `timestampMs`, `confidence`) into pages; `combineTokensWithinMilliseconds` sets page length (low value → word-by-word); each page has `tokens` with absolute `fromMs`/`toMs` for per-word animation. `text` must include the leading whitespace before each word; optional `breakOnSilenceAfterMilliseconds` and per-caption `pageBreakAfter` — [createTikTokStyleCaptions docs](https://www.remotion.dev/docs/captions/create-tiktok-style-captions)
- The official TikTok template: composition `CaptionedVideo` at 1080x1920; captions generated with Whisper.cpp (`medium.en`, ~1.5 GB, configurable in `whisper-config.mjs`) via `node sub.mjs`; uses `createTikTokStyleCaptions` with `SWITCH_CAPTIONS_EVERY_MS = 1200`; repo pushed 2026-11-24 — [remotion-dev/template-tiktok](https://github.com/remotion-dev/template-tiktok)
- Remotion captions docs (2026): audio "can be transcribed locally using WebGPU, in Studio, with agents or programmatically"; captions "can be interactively edited in the Studio"; preset styles available as Elements (Basic, Rounded, Moving Pill, Popping Word); sections for importing .srt/.vtt, transcribing, displaying, styling, editing, and exporting burned-in or .srt — [Remotion captions docs](https://www.remotion.dev/docs/captions)
- `npx remotion whisper` commands for local transcription were added in v4.0.546 (23 Nov 2026) — [GitHub releases](https://github.com/remotion-dev/remotion/releases)
- Related packages, all at 4.0.547 (MIT): `@remotion/install-whisper-cpp` (since Feb 2024), `@remotion/whisper-web` (since May 2025), `@remotion/openai-whisper` (since Oct 2024), and `@remotion/elevenlabs` (since v4.0.443, March 2026), which converts ElevenLabs Speech to Text output into `Caption[]` — [@remotion/elevenlabs docs](https://www.remotion.dev/docs/elevenlabs), [npm: @remotion/captions](https://www.npmjs.com/package/@remotion/captions)
- whisper.cpp: v1.9.6 released 2026-11-23, MIT, 55,540 stars (registry) — [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- WhisperX ("Automatic Speech Recognition with Word-level Timestamps (& Diarization)"): v3.8.6 released 2026-05-25, BSD-2-Clause, 25,694 stars, pushed 2026-11-21 (registry) — [m-bain/whisperX](https://github.com/m-bain/whisperX)
- ElevenLabs Forced Alignment API "turns spoken audio and text into a time-aligned transcript" for cases "where you have audio recording and a transcript, but need exact timestamps for each word"; priced at the Speech to Text rate; limits 3 GB file, 10 hours audio, 675,000 characters — [ElevenLabs forced alignment docs](https://elevenlabs.io/docs/overview/capabilities/forced-alignment)
- OpenAI `whisper-1` is deprecated (shutdown 26 Feb 2027), which affects `@remotion/openai-whisper`-style pipelines that call it — [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- HyperFrames ships ~17 caption components, e.g. "Highlight" ("red background sweep behind each active word, TikTok-style"), "Pill Karaoke", "Kinetic Slam" (full-screen single word), "Clip Wipe", "Editorial Emphasis", "Emoji Pop" — [HyperFrames catalog](https://hyperframes.heygen.com/_llms/catalog/catalog.txt)
- Retention claims (all vendor blogs, methodology unpublished): static subtitles +8-12% vs animated word-by-word +18-28% average retention — [BlitzCut](https://blitzcutai.com/blog/animated-captions-vs-static-captions); "+15 to 25%" watch time for animated styles and estimates that 60-85% of short-form video is watched with sound off or low — [Clamper on DEV](https://dev.to/clamper_ai/how-ai-caption-styles-affect-watch-time-and-engagement-409i), [ClipSpeed](https://clipspeed.ai/blog/ai-captions-increase-views.html)

### Inferences
- With TTS narration the script text is already known, so forced alignment (text + audio → word times) avoids ASR spelling errors on technical terms (function names, "Mineflayer", item ids) — a real problem for devlogs. ASR (whisper.cpp) is only needed for self-recorded, unscripted voice.
- The existing caption-alignment pipeline can keep feeding the standard `Caption` JSON shape; `createTikTokStyleCaptions` with a ~800-1200 ms page window gives the 2-4-word "pages with active-word highlight" look.
- The muted-viewing rationale (captions carry the message when audio is off) is plausible and widely repeated, but the specific size of the animated-vs-static effect is not established by any independent source found.

### Gaps
- I did not verify in this session whether ElevenLabs' TTS endpoint returns character/word timestamps directly alongside the audio (which would remove the alignment step entirely).
- No peer-reviewed or platform-published measurement isolating word-by-word animated captions was found; the commonly cited "85% watched muted" figure could not be traced to a primary study.
- Safe-area guidance for caption placement under the Shorts/TikTok/Reels UI overlays was not researched here.

## 6. Music and SFX: safe sources; Minecraft's own music and sounds

### Takeaway
Mojang explicitly permits its approved Minecraft-owned tracks (the "Minecraft Creator-Safe" Spotify playlist) in monetised Minecraft content on YouTube, Twitch and TikTok with a credit line; licensed music (not Minecraft-owned) is not covered. YouTube Audio Library and safelisted subscription libraries are the low-risk default; Suno's current terms allow commercial use only for paid-tier outputs obtained through a counted "Download", and Udio's status is unclear.

### Cited Findings
- Mojang: creators of Minecraft content are "welcome to use our approved Minecraft-owned music tracks in any non-commercial content and any commercial content that meets the Minecraft Usage Guidelines (such as monetized or sponsored YouTube videos, Twitch streams, TikTok videos, etc)" — [minecraft.net: Can I use Minecraft music?](https://www.minecraft.net/en-us/article/can-i-use-minecraft-music-)
- Approved tracks are those on the "Minecraft Creator-Safe" playlist on Spotify; creators should tag/credit the track with the platform's tools or, if not possible, include "Music courtesy of Mojang Studios"; Mojang may remove or replace songs on the playlist — [minecraft.net](https://www.minecraft.net/en-us/article/can-i-use-minecraft-music-)
- "Music that isn't Minecraft-owned in-game music is typically licensed music... we cannot license licensed music to you"; the creator must contact the rightsholder — [minecraft.net](https://www.minecraft.net/en-us/article/can-i-use-minecraft-music-)
- Mojang's help centre says game music may play inside a monetised gameplay video, and links a separate C418 music policy; music use outside normal gameplay may be restricted — [Mojang help: Content Creation and Broadcasting Terms](https://help-redesign.zendesk.com/hc/en-us/articles/34348618194189-Content-Creation-and-Broadcasting-Terms-of-Use-and-Guidelines), [Mojang help: Using Minecraft Music in Videos and Streams](https://help-redesign.zendesk.com/hc/en-us/articles/44251000052237-Using-Minecraft-Music-in-Videos-and-Streams)
- YouTube: Shorts longer than one minute with an active Content ID claim are blocked regardless of the claim's policy — [YouTube Help: Music eligibility for Shorts](https://support.google.com/youtube/answer/13486873?hl=en-419)
- Epidemic Sound: linking the YouTube channel ("safelisting") clears its music in Content ID; it says a Shorts claim from its catalogue is not a strike and does not affect monetisation (vendor's own statement) — [Epidemic Sound help](https://help.epidemicsound.com/hc/en-us/articles/26248403674770), [Epidemic Sound help: Shorts monetization policy](https://help.epidemicsound.com/hc/en-us/articles/26252068834194)
- TikTok: business accounts cannot use the general music library for commercial use and must use the Commercial Music Library, a pre-cleared catalogue (about a million songs) — [TikTok Business Help: Commercial Music Library](https://ads.tiktok.com/help/article/commercial-music-library)
- Suno Terms of Service (read 2026-11-26): free/basic-tier users may use Outputs only for "lawful, personal and non-commercial purposes"; commercial exploitation is permitted only where "you have obtained a permitted download of that Output in accordance with the download allocations for your applicable service tier"; Remixes are non-commercial "regardless of your subscription tier"; Suno "makes no representation or warranty... that any copyright will vest in any Output" — [Suno Terms](https://suno.com/terms)
- Third-party reporting: since 3 Sep 2026 Suno caps downloads (reported as 20/month on Pro, 60 on Premier) — [Music Business Worldwide](https://www.musicbusinessworldwide.com/suno-limits-subscribers-downloads-per-month/); the specific cap numbers come from blog coverage and were not confirmed on Suno's page
- Udio: sources conflict — one says paid plans grant commercial rights, another that downloads were suspended during a transition to a licensed platform — [Dynamoi](https://dynamoi.com/learn/ai-music-distribution/suno-vs-udio-for-commercial-distribution); contradicted by [Dubspot](https://blog.dubspot.com/ai-music-licensing-explained-2026)
- ElevenLabs Music: commercial-use licensing on Starter ($6/month) and above, ~900 credits per minute; sound effects 200 credits per generation — [ElevenLabs pricing](https://elevenlabs.io/pricing)
- TikTok and UMG (May 2026 deal) committed to removing unauthorised AI-generated music; a vendor source advises labelling AI-generated music with TikTok's AI label (secondary sources) — [Uppbeat](https://uppbeat.io/blog/creator-news/major-label-music-is-staying-on-tiktok-but-ai-rules-are-getting-tighter)

### Inferences
- For a Minecraft-bot devlog, the simplest fully-sanctioned bed is a track from Mojang's Creator-Safe playlist with the "Music courtesy of Mojang Studios" credit; it is on-theme and explicitly allowed for monetised YouTube/TikTok. It must be baked into the render (API uploads cannot attach platform library sounds), and the playlist can change.
- Keeping shorts at or under 60 seconds avoids the "over one minute + any Content ID claim = blocked" rule on YouTube.
- TikTok/Reels in-app "trending sounds" cannot be attached through upload APIs, so automated publishing implies baked-in audio from a licence that travels with the file (YouTube Audio Library, a subscription library, Mojang's approved tracks, or a paid-tier AI track downloaded under Suno/ElevenLabs commercial terms).
- A personal (non-business) TikTok account avoids the Commercial Music Library restriction but that only matters for in-app sounds.

### Gaps
- Mojang's policy on Minecraft sound effects (block breaks, mob sounds) used outside gameplay footage was not found; the article addresses music only.
- The C418 music policy text was not read.
- YouTube Audio Library terms (no Content ID claims) were only seen via a search summary, not the primary page; Artlist terms and prices were not researched.
- Current Suno/Udio plan prices and whether their "licensed" successor products have launched were not confirmed from primary pages.

## 7. Publishing automation: YouTube Shorts, TikTok, Instagram Reels

### Takeaway
YouTube became much easier for personal automation in 2026: `videos.insert` now has its own bucket (100 uploads/day at 1 unit each, since 1 June 2026) and, since 2 November 2026, uploads from unverified API projects are no longer locked to private. TikTok is still the hard one — unaudited API clients can only post privately — so a hosted scheduler with an already-audited app (Buffer, Postiz Cloud) or TikTok's upload-to-inbox flow is the pragmatic route. Instagram requires a professional account and allows 100 API posts per 24 h.

### Cited Findings

**YouTube**
- `videos.insert`: "Quota impact: 100 calls per day. A call to this method has a quota cost of 1 unit in the Video Uploads quota bucket"; max file size 256 GB — [YouTube Data API: videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- Default allocation is "100 search.list calls, 100 videos.insert calls, and 10,000 units per day combined for all other endpoints"; quotas reset at midnight Pacific — [YouTube quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost)
- Revision history, 1 June 2026: the Data API "is transitioning to a granular quota system... starting with videos.insert and search.list" — [YouTube API revision history](https://developers.google.com/youtube/v3/revision_history)
- Revision history, 2 November 2026: "Videos uploaded through the videos.insert method from unverified API projects are no longer restricted to private viewing mode. This change reverses the policy announced on July 28, 2020"; if `status.privacyStatus` is omitted the video defaults to public (some uploads may default to private based on creator account settings) — [YouTube API revision history](https://developers.google.com/youtube/v3/revision_history)
- Older or cached material still states the previous rules (1,600 units per upload; private lock for unverified projects) and is now out of date — [YouTube quota calculator (localised/cached variants)](https://developers.google.com/youtube/v3/determine_quota_cost?authuser=1); superseded by [revision history](https://developers.google.com/youtube/v3/revision_history)
- Settable fields on insert include `status.selfDeclaredMadeForKids`, `status.containsSyntheticMedia`, `status.publishAt`, `status.privacyStatus` — [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- 3 November 2026: `thumbnails.set` supports custom thumbnails for Shorts after processing (new `shortsAspectRatio` property) — [YouTube API revision history](https://developers.google.com/youtube/v3/revision_history)
- Disclosure: creators "don't need to disclose non-realistic content that's made with AI"; examples not needing disclosure include fully animated content, production assistance (script, outline, thumbnail, title), caption creation, cloning one's own voice for voice-overs, and gameplay footage — [YouTube Help](https://support.google.com/youtube/answer/14328491?hl=en)

**TikTok**
- "All content posted by unaudited clients will be restricted to private viewing mode"; lifting it requires an audit of the API client — [TikTok Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- Error `unaudited_client_can_only_post_to_private_accounts`: "Unaudited clients can only post to a private account"; `PULL_FROM_URL` requires verified ownership of the URL prefix/domain — [TikTok Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- Direct Post fields include `is_aigc`, `brand_content_toggle`, `brand_organic_toggle` ("promoting the creator's own business") and a cover-frame timestamp — [TikTok Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- Postiz docs for self-hosters: you need your own TikTok developer app, a public HTTPS site with Terms/Privacy pages for domain verification, Login Kit + Content Posting API (Direct Post), scopes `user.info.basic`, `video.create`, `video.publish`, `video.upload`, `user.info.profile`; before the audit passes Postiz forces `privacy_level` to `SELF_ONLY`; unaudited use is limited to 5 users per 24 h; "Upload without posting" sends media to the account's TikTok inbox to be published manually; media must be reachable over public HTTPS — [Postiz TikTok provider docs](https://docs.postiz.com/providers/tiktok)
- Third-party guides add: init requests are limited to 6 per minute per access token; posts made while unaudited stay private after approval (vendor blogs) — [Socialync](https://www.socialync.io/blog/tiktok-content-posting-api-guide-2026), [bundle.social](https://bundle.social/blog/tiktok-api-approval)

**Instagram**
- Content publishing works for Instagram professional accounts; media must be on a publicly accessible server at publish time (Meta cURLs it) or uploaded via resumable upload to `rupload.facebook.com`; "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period" — [Instagram Platform: Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)

**Schedulers**
- Buffer: its API (GraphQL, rebuilt in 2026) "offers personal-key-only access and supports 11 channels: Instagram, Facebook, LinkedIn, TikTok, X, Threads, Bluesky, Pinterest, YouTube, Google Business Profile, and Mastodon. The API is available on Buffer's free plan"; free users get 1 API key, paid users 5; it covers post creation and scheduling (Buffer's own article) — [Buffer: social media APIs](https://buffer.com/resources/social-media-api-multi-platform-posting/)
- Buffer free plan: up to 3 channels and 10 scheduled posts per channel; paid tiers priced per channel (figures from a search summary of Buffer's pricing page) — [Buffer pricing](https://buffer.com/pricing)
- Postiz: open source (AGPL-3.0), 42,442 stars, v2.26.0 released 2026-11-13 (registry); self-hosting is free — [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app)
- Postiz Cloud plans: Standard $29/month (5 channels), Team $39 (10), Pro $49 (30), Ultimate $99 (100); unlimited posts; "Public API, CLI and MCP" on every plan — [Postiz Cloud plans](https://docs.postiz.com/cloud/plans)

### Inferences
- For one creator posting a few shorts a week, a direct YouTube upload script is now practical without an audit (100 uploads/day, public allowed) — but because the unverified-project change is only ~3 weeks old, first uploads should be checked for actual visibility.
- For TikTok, self-built or self-hosted (Postiz OSS) automation is blocked on the audit; using Buffer's API (free plan covers 3 channels = exactly YouTube + TikTok + Instagram) or Postiz Cloud delegates to their audited apps and gives a CLI/agent-drivable interface. Buffer's 10-queued-posts-per-channel limit is ample for this cadence.
- Instagram's requirement of a public URL (or resumable upload) and a professional account is easiest to satisfy through a scheduler as well.
- Disclosure flags should be set deliberately per platform: a stylised/animated devlog with the developer's own cloned voice does not need YouTube's altered-content flag by YouTube's own examples; TikTok's `is_aigc` is a creator self-label for AI-generated video content.

### Gaps
- Whether Buffer's free-plan API can schedule video specifically to Shorts/TikTok/Reels (as opposed to only on paid plans) was not confirmed from a primary page.
- Whether Postiz Cloud's TikTok app is audited (so that posts go public) is not stated in the docs read.
- TikTok's upload-to-inbox scope requirements and whether inbox uploads are exempt from the private-only restriction were not verified on TikTok's own page.
- YouTube's rules for when a vertical upload is classified as a Short (duration limit, aspect ratio) were not re-verified for late 2026.
- Meta's current AI-content labelling requirements for Reels were not researched.

## 8. Existing end-to-end "git commits → devlog video" tools

### Takeaway
No maintained open-source tool was found that goes from git history to a finished narrated vertical devlog. What exists is either old (Relano, git-story), a different genre (Gource-style history animations), commercial PR→changelog-video products, or generic agent skills (Remotion, HyperFrames, a community "devlog" skill built around gameplay captures) that an agent can be pointed at a `git log`.

### Cited Findings
- Relano: an open-source GitHub Action for "what's new" release videos; a YAML description is converted to JSON props for a Remotion composition — [DEV Community: Introducing Relano](https://dev.to/just_moh_it/introducing-relano-create-beautiful-whats-new-videos-and-automate-your-projects-social-media-cp2)
- `git-story`: "creating video animations (.mp4) of your commit history directly from your Git repo" (Manim-based); latest PyPI release 0.1.4 dated 2022-07-20 — [PyPI: git-story](https://pypi.org/project/git-story/)
- VideoGit: converts git commit history into an animated coding video — [shahanneda/VideoGit](https://github.com/shahanneda/VideoGit)
- A commercial product that turns GitHub PRs into changelog videos is described by its author on DEV (not open source per the snippet) — [DEV Community](https://dev.to/zem_734b3fabd88c/i-built-a-product-that-turns-github-prs-into-changelog-videos-l1i)
- A community Claude Code skill named "devlog" targets game development: short-form TikTok/X videos from gameplay captures, rendered with Remotion (built around recordings, not git history) — [killer-skills listing](https://killer-skills.pages.dev/en/skills/urgood2/roguelike-sim-incremental)
- A community "Claude Code Video Toolkit" collects Remotion, Manim and FFmpeg skills — [wilwaldon/Claude-Code-Video-Toolkit](https://github.com/wilwaldon/Claude-Code-Video-Toolkit)
- A blog post on the Remotion skill proposes (as an idea, not a packaged tool) an auto-generated 60-second video per release from the git log → script → render — [jonathansblog.co.uk](https://jonathansblog.co.uk/the-remotion-claude-code-skill-generate-videos-programmatically-with-ai)
- Remotion's "Prompt to Video" template (story with images and voiceover from a prompt) and "Recorder" template are the closest official starting points; Remotion's Agent Skills are now described as "the default way people make videos with Remotion" — [Remotion templates](https://www.remotion.dev/templates), [Remotion blog](https://www.remotion.dev/blog)
- HyperFrames positions the same agent workflow: install skills, then describe the video to Claude Code/Codex; its `/media-use` skill covers voiceover, music and sound effects — [heygen-com/hyperframes README](https://github.com/heygen-com/hyperframes)
- Gource remains the standard git-history visualiser and supports a caption file for timeline annotations — [Gource README](https://github.com/acaudwell/Gource)

### Inferences
- The realistic architecture is a small bespoke pipeline rather than an adopted tool: (1) `git log`/diff range → structured JSON of "what changed and why" (LLM-summarised, 3-5 beats); (2) script → TTS → forced alignment → `Caption[]`; (3) a parameterised Remotion (or HyperFrames) composition whose props are that JSON plus bot-replay data; (4) `npx remotion render` at 1080x1920; (5) upload via YouTube API and a scheduler API for TikTok/Instagram. Every step is CLI-drivable by a coding agent, and the user already owns steps 2 and most of 3 from the other video series.
- Because the composition is data-driven, the per-episode manual work reduces to reviewing the script and the render, which is where the official Remotion/HyperFrames skills (authoring, captions, render) and the interactive Studio help.

### Gaps
- Activity status and quality of Relano, VideoGit and the community "devlog" skill were not checked (GitHub API rate limit reached); Relano and git-story appear to date from 2022.
- I found no public write-up from 2025-2026 of a developer running a fully automated commit-to-Shorts pipeline with measured results (views, retention, time saved).
- No evidence was gathered on how platforms treat high-frequency, templated, largely automated devlog shorts (e.g. YouTube "inauthentic/repetitive content" monetisation policy); this is a risk worth checking separately.
