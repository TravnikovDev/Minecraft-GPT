# In-game capture of a Mineflayer bot for vertical (9:16) devlog videos — state as of 26 Nov 2026

Scope reminder: bot is mineflayer 4.39.0 (tested versions end at `26.1`), so the recording client/server must be Minecraft Java 26.1 or older. Creator machine: macOS, Apple M1 Max, ffmpeg installed, no OBS yet. Version/date facts below were pulled on 2026-11-26 from the Modrinth API, GitHub raw source and npm registry, not from memory.

## 1. Replay recording mods: ReplayMod, Flashback, ServerReplay

### Takeaway
Both Flashback (0.43.x) and ReplayMod (2.6.28) have Fabric builds for 26.1 and for 1.21.x, and ServerReplay (3.4.3+26.1) records a named player server-side with no client open, in either ReplayMod or Flashback format. Flashback exports any even resolution (it has a built-in 9:16 = 1080x1920 mapping), ships macOS arm64 ffmpeg natives, and has camera/track-entity/timelapse keyframes, so "record on the server, frame the shots later, export vertical" is fully supported on 26.1.

### Cited Findings
**Version support (verified via Modrinth API, per game version: newest mod build, publish date)**
- Flashback: 26.1 -> 0.43.6 (2026-09-25); 26.1.1 / 26.1.2 -> 0.43.3 (2026-08-28); 26.2 and 26.3 -> 0.43.6; 1.21.4-1.21.11 and 1.21/1.21.1 -> 0.39.10 (2026-09-25). No builds for 1.21.2/1.21.3 or anything below 1.21. Fabric only, client-side — [Modrinth API](https://api.modrinth.com/v2/project/flashback/version); [Modrinth page](https://modrinth.com/mod/flashback/versions)
- ReplayMod: 26.1 / 26.1.1 / 26.1.2 -> `26.1-2.6.28` (2026-10-18); also 26.2, 26.3, 1.21.11, 1.21.10/1.21.9, 1.21.7/1.21.6, 1.21.5, 1.21/1.21.1 at 2.6.28 (2026-10-18); 1.21.8, 1.21.4, 1.21.2/1.21.3, 1.20.x remain on 2.6.23 (2025-07-05). Fabric only for these. Supports far older versions too (1.8-1.20.6) — [Modrinth API](https://api.modrinth.com/v2/project/replaymod/version); [Modrinth page](https://modrinth.com/mod/replaymod/versions)
- ServerReplay (senseiwells): 26.1 / 26.1.1 / 26.1.2 -> 3.4.3+26.1 (2026-05-29); 26.2 -> 3.5.2 (2026-08-09); 26.3 -> 3.6.0 (2026-10-30); 1.21.11 -> 3.3.1; 1.21.9/10 -> 3.1.1; 1.21.8 -> 3.0.1; older 1.21.x / 1.20.x / 1.19.4 / 1.18.2 / 1.17.1 builds exist. Fabric (server-side) — [Modrinth API](https://api.modrinth.com/v2/project/server-replay/version); [Modrinth page](https://modrinth.com/mod/server-replay/versions)
- mineflayer 4.39.0 `testedVersions` ends with `'1.21.9', '1.21.11', '26.1'` (so no 26.2/26.3) — [mineflayer lib/version.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/version.js)

**Flashback — export, vertical, quality**
- Export settings in source: `resolutionX`, `resolutionY`, start/end tick, projection (perspective/orthographic etc.), `framerate` (double), reset RNG, depth map, container, codec, encoder, bitrate, transparent sky, SSAA, no-GUI, stereo audio, audio codec — [ExportSettings.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/exporting/ExportSettings.java)
- Resolution is a free integer pair, clamped to min 16 and rounded up to even; default 1920x1080 at 60 fps. The editor has an aspect-ratio visual setting (16:9, 9:16, 2.40:1, 1:1, 4:3, 3:2); choosing 9:16 pre-fills the export window with 1080x1920 — [StartExportWindow.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/editor/ui/windows/StartExportWindow.java)
- Codecs: H264, H265, AV1, VP9, Apple ProRes, QuickTime (RLE), WebP, GIF, PNG, EXR. Containers: MP4, MKV, AVI, MOV, PNG sequence, EXR sequence, WebP, WebM, GIF — [VideoCodec.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/combo_options/VideoCodec.java); [VideoContainer.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/combo_options/VideoContainer.java)
- Changelog milestones: SSAA and transparent-sky export (0.3.0), PNG sequence (0.6.0), "No GUI" export (0.7.0), audio track (0.38.0), depth-map export + EXR sequence + updated FFmpeg with an option to use the system FFmpeg (0.43.3, 2026-08-28), export in fullscreen blocked because it causes issues (0.43.3) — [Flashback changelog](https://modrinth.com/mod/flashback/changelog)
- Flashback Extras (add-on, Fabric, 26.1.x-26.3 and 1.21.6-1.21.11): export presets (built-in and custom) and an on-screen overlay showing the vertical TikTok/Shorts frame while framing shots — [Flashback Extras](https://modrinth.com/mod/flashback-extras)

**Flashback — macOS / Apple Silicon**
- The build bundles bytedeco FFmpeg 8.1.2 with `macosx-arm64` and `macosx-x86_64` classifiers (plus custom Linux/Windows natives) and javacpp for macosx-arm64, i.e. the exporter is packaged for Apple Silicon — [build.gradle](https://github.com/Moulberry/Flashback/blob/master/build.gradle)
- Config has `exporting.useSystemFFmpeg` (default false) — [FlashbackConfigV1.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/configuration/FlashbackConfigV1.java)
- A GitHub issue search of Moulberry/Flashback for macOS/"apple silicon" returned one item only (#60, a macOS Shift+scroll fix, closed 2026-06-14); the taskbar progress indicator is Windows-only — [GitHub issue search](https://github.com/Moulberry/Flashback/issues?q=macos); [Flashback changelog](https://modrinth.com/mod/flashback/changelog)

**Flashback — camera, keyframes, following a player**
- Keyframe types present in source: Camera, Camera Orbit, Camera Shake, Track Entity, FOV, Speed (tickrate), Timelapse, Freeze, Time of Day, Audio, Block Override — [keyframe/types directory](https://github.com/Moulberry/Flashback/tree/master/src/main/java/com/moulberry/flashback/keyframe/types)
- "Track Entity" keyframe added in 0.32.0 (2025-05-03); spectating a recorded player in first person is supported (view bobbing added 0.30.0, spectated player's skin/arm fixes 0.15.0, "show hotbar when spectating a player" 0.7.0); camera interpolation uses real time so changing replay speed mid-move does not speed up the camera (0.33.0) — [Flashback changelog](https://modrinth.com/mod/flashback/changelog)
- Recording controls: client commands `/flashback start`, `finish`/`end`, `pause`, `unpause`, `config`, `mark`; config `recordingControls.automaticallyStart` (default false) and `automaticallyFinish` (default true); `/hide` and `/show <entities>` inside a replay — [Flashback.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/Flashback.java); [FlashbackConfigV1.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/configuration/FlashbackConfigV1.java)
- Licence: custom, all rights reserved, no redistribution; no outside contributions; support via Discord only (no public docs site found) — [Flashback README](https://github.com/Moulberry/Flashback)

**ReplayMod — export, vertical, camera**
- Render settings accept any custom width/height; methods: Default, Stereoscopic, Cubic, Equirectangular; presets MP4 default/high/potato, MP4 custom bitrate, WEBM, MKV lossless, PNG sequence, OpenEXR sequence — [ReplayMod docs](https://www.replaymod.com/docs/)
- Requires an external ffmpeg; on macOS the docs say `brew install ffmpeg` (or a static build in /usr/local/bin); the ffmpeg command and argument template (`%WIDTH%`, `%HEIGHT%`, `%FPS%`, `%FILENAME%`, `%BITRATE%`) are user-editable in the render GUI — [ReplayMod docs](https://www.replaymod.com/docs/)
- Camera paths: position keyframes (x, y, z, yaw, pitch, roll; cubic spline or linear) and separate time keyframes; two time keyframes with the same timestamp freeze time; timeline up to 10 minutes; speed slider 0.1x-8x; spectator keyframes follow an entity (right-click a player / Player Overview `B`); keyframe presets saved per replay in the Keyframe Repository (`X`) — [ReplayMod docs](https://www.replaymod.com/docs/)
- Docs state Sodium's official build lacks the FREX Flawless Frames API needed to render and point to a custom Sodium build; Iris is listed as supported from 1.16.5 with that custom Sodium — [ReplayMod docs](https://www.replaymod.com/docs/)
- A `.mcpr` is a zip containing `metaData.json`, `recording.tmcpr` (timestamped packets), `markers.json`, `mods.json`, `visibility.json`, thumbnail, resource packs — [ReplayStudio AbstractReplayFile.java](https://github.com/ReplayMod/ReplayStudio/blob/master/src/main/java/com/replaymod/replaystudio/replay/AbstractReplayFile.java)

**ServerReplay — record the bot 24/7 with no client**
- Fully server-side Fabric mod that records replays "for replay mod or flashback"; requires Fabric Loader, Fabric API, Fabric Kotlin — [ServerReplay README](https://github.com/senseiwells/ServerReplay)
- `/replay start players <player(s)>` records that player's view at server view distance and stops when the player leaves; `/replay start chunks from <x> <z> to <x> <z>` / `around <x> <z> radius <r>` records a fixed area independent of any player; `/replay stop ...`, `/replay status`; needs op level 4 or the `server-replay.commands.replay` permission — [ServerReplay README](https://github.com/senseiwells/ServerReplay)
- Config `automatically_record` + `player_predicate` (`all`, `has_name`, `has_uuid`, `has_op`, `in_team`, `is_fake`, with `not`/`and`/`or`) auto-records matching players on join; `max_file_size`, `max_duration`, `restart_after_max_*` roll files — [ServerReplay README](https://github.com/senseiwells/ServerReplay)
- Output defaults to `./recordings/players/<uuid>/<date-time>.mcpr`, to be copied into the client's `replay_recordings` folder for ReplayMod; `/replay encoding default set <flashback|replay_mod>` switches the format; recorded players need no client mod; replays can also be viewed server-side (`/replay view ...`) and downloaded over HTTP if enabled — [ServerReplay README](https://github.com/senseiwells/ServerReplay)
- Stated limits: player recordings may not be 100% identical to a client ReplayMod recording; chunk recordings miss some features; Carpet fake players need `fix_carpet_bot_view_distance` — [ServerReplay README](https://github.com/senseiwells/ServerReplay)
- A separate "Replay To Flashback Converter" mod writes a `-flashback.zip` from a ReplayMod file — [CurseForge](https://www.curseforge.com/minecraft/mc-mods/replay-to-flashback-converter)

### Inferences
- Best-fit pipeline for "repeatable capture of the bot": run the test server as Fabric 26.1 with ServerReplay set to `automatically_record` + `has_name: <bot>` and Flashback encoding; every bot session is then recorded with no client open. A human (or GUI automation) later opens the file in Flashback on the Mac, frames shots with Track Entity / Orbit keyframes and exports 1080x1920.
- A mineflayer bot is a real protocol client, not a Carpet fake player, so ServerReplay's player recorder should treat it as a normal player; this is not stated anywhere and should be tested once.
- Alternative without a Fabric server (vanilla/Paper): a second account with Flashback or ReplayMod installed joins, stays near the bot (spectator mode is fine; Flashback has a "hide all spectators" option) and records client-side; the replay contains everything in that client's view distance, and the camera is chosen afterwards.
- Both replay mods render frames offline (not real time), so export quality is independent of live FPS on the M1 Max and of the window size; SSAA + H.264/H.265/ProRes at 1080x1920@60 is far above what Shorts needs.
- Flashback is the better choice on 26.1 for vertical work (9:16 aspect mode, vertical overlay add-on, bundled arm64 ffmpeg, Track Entity). ReplayMod is the fallback for versions Flashback lacks (below 1.21, and 1.21.2/1.21.3).

### Gaps
- No first-hand report found of Flashback exporting on Apple Silicon with 26.1; support is inferred from bundled natives and the absence of macOS issues. Which hardware encoders (e.g. VideoToolbox) appear in the encoder list on macOS was not checked.
- Flashback has no public documentation site; feature behaviour comes from source and changelog only.
- The file extension/layout ServerReplay produces in Flashback mode is not documented in its README (Flashback itself stores replays as zips under `<gameDir>/flashback/replays` with a `metadata.json`).
- Whether ReplayMod 2.6.28 still needs a custom Sodium build on 26.1 could not be confirmed (docs may be stale).
- Whether a 26.1 server accepts 26.1.1/26.1.2 clients (protocol compatibility inside 26.1.x) was not checked; safest is client = server = exactly 26.1.

## 2. Live capture: spectator account + OBS / macOS screen capture, native 9:16, camera mods

### Takeaway
Live capture works on Apple Silicon (OBS 33 has a native arm64 build; Aitum Vertical 1.6.7 supports macOS; ffmpeg's avfoundation device can grab the screen from a script), but it bakes framing in at record time. Camera tooling for 26.1 exists (Freecam 1.5.1, Lumiera, CineCam, NarrativeCraft), while CMDCam had no 26.1 build found.

### Cited Findings
- `/spectate <target> [<player>]`: the spectating player must be in Spectator mode; view is from the target's perspective (first person); `/spectate` with no args stops; permission level 2; works across dimensions since 1.19.4; added in 1.15 — [Minecraft Wiki /spectate](https://minecraft.wiki/w/Commands/spectate)
- OBS Studio current macOS release is 33.0.2 with a separate Apple Silicon (arm64) installer; requires macOS 13+ — [OBS download page](https://obsproject.com/download)
- Aitum Vertical 1.6.7 (updated 2026-10-27) adds a separate vertical canvas to OBS with scenes linked to the normal ones; minimum OBS 29; platforms Windows, macOS, Linux — [OBS resource page](https://obsproject.com/forum/resources/aitum-vertical.1715/)
- Forum logs show Aitum Vertical running on Apple M3 Pro with a 1080x1920 base resolution; one Apple Silicon user reported installer errors (no resolution shown) — [OBS forum thread](https://obsproject.com/forum/threads/aitum-vertical.166504/)
- ffmpeg's `avfoundation` input device on macOS lists devices with `-list_devices true` and has `-framerate`, `-video_size`, `-pixel_format`, `-capture_cursor` (default 0) and `-capture_mouse_clicks` options — [FFmpeg devices documentation](https://ffmpeg.org/ffmpeg-devices.html#avfoundation)
- Quick Play game arguments (since 1.20): `--quickPlayMultiplayer <server address>` joins a server straight after launch; `--quickPlaySingleplayer`, `--quickPlayRealms`, `--quickPlayPath` also exist — [Minecraft Wiki Quick Play](https://minecraft.wiki/w/Quick_Play)
- Freecam 1.5.1 (2026-10-20) covers 26.1-26.3, 1.21.11 and 1.20.5/1.20.6 (older builds for other 1.21.x); Fabric/Forge/NeoForge; features: detached camera, up to 9 "tripod" camera positions on hotbar keys, player/hand visibility toggles; flagged as possibly treated as cheating on public servers — [Freecam on Modrinth](https://modrinth.com/mod/freecam); [Modrinth API](https://api.modrinth.com/v2/project/freecam/version)
- Camera-path mods listing 26.1: Lumiera (alpha; Fabric + NeoForge; keyframes with linear/Catmull-Rom/Bezier/cosine/step interpolation, timed fades and sound cues) — [Lumiera](https://modrinth.com/mod/lumiera); NarrativeCraft 2.0.0 beta for Fabric 26.1.2 (rebuilt cutscene editor with camera/FOV timeline layers) — [NarrativeCraft](https://modrinth.com/mod/narrativecraft); CineCam 3.0.0 for Fabric 26.1.2 (flythroughs, static shots, cuts, entity tracking) — [CineCam listing](https://skinmc.net/project/cinecam)
- PortraitCraft (NeoForge, client) switches the game window to portrait, default 720x1280, and recommends a 1080x1920 OBS canvas — [PortraitCraft](https://www.curseforge.com/minecraft/mc-mods/portraitcraft)

### Inferences
- Simplest live setup: owner account in spectator mode, `/spectate <bot>` for first-person or free-fly/Freecam tripod for third-person, Minecraft window sized 9:16, recorded by OBS (window capture, 1080x1920 canvas) or by a scripted `ffmpeg -f avfoundation` capture cropped to the window. A plain 1080x1920 OBS canvas already gives vertical output; Aitum Vertical is only needed to produce horizontal and vertical simultaneously.
- On a Retina MacBook a 540x960-point window has a 1080x1920-pixel framebuffer, so the game can render native 9:16 without exceeding the screen height; this is an inference about macOS HiDPI scaling, not something a source confirmed for 26.1.
- `/spectate` gives only the bot's own first-person view (no bot model visible), which reads poorly for "look what the bot built"; third-person needs a free camera (spectator fly, Freecam, or a camera-path mod).
- Because any second account with op level 2 can be moved by server commands (`/spectate`, `/tp <cam> x y z yaw pitch`, `/tp <cam> ... facing entity <bot>`), a camera account's framing can be scripted from the server console even though the camera client itself is a normal GUI client.
- Live capture cannot be re-framed, re-timed or re-rendered at higher quality afterwards; replay mods can. For recurring devlogs, live capture is the quick-and-dirty option.

### Gaps
- No source confirmed CMDCam, Camera Utils or Camerapture builds for 26.1 (search found a `cmdcam-fabric` Modrinth project but no 26.1 listing); Camera Utils/Camerapture were not checked individually.
- The launcher's per-installation "Resolution" field and the `--width/--height` game arguments are widely used for custom window sizes, but no fetched source documents them for 26.1.
- macOS screen-recording permission (TCC) must be granted to OBS/Terminal/ffmpeg by the user; no source fetched on this.
- No 2025-2026 creator tutorial specifically on recording Minecraft Shorts was found; search surfaced only mod listings.

## 3. Cosmetic polish: shaders on macOS Apple Silicon

### Takeaway
Sodium and Iris both have 26.1.x builds, and Flashback has explicit (if fragile) Iris integration, so shaders are technically available for 26.1 footage. Mojang is moving Java Edition from OpenGL to Vulkan (via a translation layer on macOS), which will affect rendering mods on later versions, but 26.1 predates that being mandatory.

### Cited Findings
- Iris: 26.1 / 26.1.1 / 26.1.2 -> 1.11.4+26.1 (2026-09-13); 26.3 -> 1.11.7 (2026-09-30); 1.21.11 -> 1.10.8 (2026-09-29); loaders Fabric, NeoForge, Quilt — [Modrinth API](https://api.modrinth.com/v2/project/iris/version); [Iris on Modrinth](https://modrinth.com/mod/iris)
- Sodium: 26.1.2 -> mc26.1.2-0.9.4-beta.1 (2026-11-24); 26.1 / 26.1.1 -> mc26.1.1-0.8.9 (2026-04-03); 26.2 and 26.3 builds are 0.9.4 betas (2026-11-24) — [Modrinth API](https://api.modrinth.com/v2/project/sodium/version)
- Flashback and Iris: time variables updated for shaders during export (0.4.0); time-of-day keyframes change how some shaders look (0.32.0); Iris first-person hand rendering compatibility was removed in 0.39.6 / 0.41.1 with the note that Iris code was too unstable — [Flashback changelog](https://modrinth.com/mod/flashback/changelog)
- Mojang announced (Feb 2026) that Java Edition is switching from OpenGL to Vulkan for Vibrant Visuals; macOS will use a translation layer because Vulkan is not native there; OpenGL removal only after Vulkan is stable; mods that render with OpenGL will need more work than a normal update — [GamingOnLinux](https://gamingonlinux.com/2026/02/minecraft-java-is-switching-from-opengl-to-vulkan-for-the-vibrant-visuals-update); [Neowin](https://www.neowin.net/news/minecraft-java-edition-is-upgrading-to-vulkan-but-its-not-great-news-for-mods/); [minecraft.net article](https://www.minecraft.net/en-us/article/another-step-towards-vibrant-visuals-for-java-edition)

### Inferences
- For 9:16 Shorts viewed on phones, compression and small screen size hide most shader detail; the larger visual wins are composition (bot centred, close camera), time of day, a decent render distance, and SSAA on export. Shaders are optional polish, and each extra rendering mod is another thing that can break a repeatable pipeline.
- If shaders are wanted, the lowest-risk combination on 26.1 is Fabric + Sodium + Iris + Flashback with a lightweight pack, tested once for export correctness (Flashback's own changelog shows repeated Iris breakage).

### Gaps
- No source fetched on Iris's macOS-specific limits (macOS caps OpenGL at 4.1, which historically blocks shader packs needing newer GL features); treat pack compatibility on the M1 Max as untested.
- Whether 26.1 itself already contains the optional Vulkan backend was not confirmed (only an unofficial forum report that a 26.2 snapshot had a manual Vulkan toggle).

## 4. Headless / code-driven rendering: prismarine-viewer and browser clients

### Takeaway
prismarine-viewer was revived in Sept-Oct 2026: master now lists 26.1 and gained player skins, limb animation, dropped items and animated textures, but none of that is on npm (latest npm is 1.33.0 from Feb 2025, max 1.21.4). Its headless mode renders the bot's first-person view to JPEG frames piped into ffmpeg at any width/height, so a fully scripted vertical clip is possible, at clearly sub-vanilla visual fidelity. zardoy's web client stops at server 1.21.5.

### Cited Findings
**prismarine-viewer**
- `supportedVersions` on master: 1.8.8 ... 1.20.1, 1.21.1, 1.21.4, `26.1`; other versions of the same major snap to the closest supported assets. The README still lists support only up to 1.21.4 (README and code disagree) — [viewer/lib/version.js](https://github.com/PrismarineJS/prismarine-viewer/blob/master/viewer/lib/version.js); [README](https://github.com/PrismarineJS/prismarine-viewer)
- Recent commits: "Add Minecraft 26.1 support" (#484, 2026-09-21), "Render dropped items" (#506, 2026-09-21), "Render player skins" (#490, 2026-09-14), "Animate limbs of walking entities" (#491, 2026-09-06), animated `.mcmeta` textures (#493, 2026-09-04), stairs/blocks rendering fix (#516, 2026-10-03). Before that the previous feature commit was Feb 2025 — [commit history](https://github.com/PrismarineJS/prismarine-viewer/commits/master)
- npm `latest` is 1.33.0, published 2025-02-09; depends on three 0.128.0, express, socket.io — [npm registry](https://registry.npmjs.org/prismarine-viewer)
- Headless mode options: `output` (file path or `host:port`; default `output.mp4`), `frames` (default 200, -1 = infinite), `width`/`height` (default 512x512), `viewDistance` (default 6); requires `node-canvas-webgl` installed from GitHub — [README](https://github.com/PrismarineJS/prismarine-viewer); [examples/headless.js](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/headless.js)
- Implementation: every frame is rendered on a node-canvas WebGL canvas, encoded as JPEG and written to `ffmpeg -y -i pipe:0 <output>` (mp4 mode, no fps/pix_fmt given), to an RTMP ffmpeg (libx264, 20 fps, forced 1280x720) or to a TCP socket as length-prefixed JPEGs; frames are scheduled with `setTimeout(update, 16)` rather than a fixed clock; the camera is first-person only, set from `bot.entity.position/yaw/pitch` on each `move` — [lib/headless.js](https://github.com/PrismarineJS/prismarine-viewer/blob/master/lib/headless.js)
- A PR that added a recording handle with `stop()`, wall-clock pacing at a set fps, `-pix_fmt yuv420p` and a wait-until-ready first frame (#504) was closed without being merged; its description says the current code produces videos that play at the wrong speed (ffmpeg assumes 25 fps) and start with blank-sky frames — [PR #504](https://github.com/PrismarineJS/prismarine-viewer/pull/504)
- Third-person/overhead recording in headless mode is an open, unanswered request — [issue #477](https://github.com/PrismarineJS/prismarine-viewer/issues/477)
- Native-module constraint: `node-canvas-webgl` depends on `gl`, whose prebuilt binaries cover Node ABIs 108/115/127/134 but not 137 (Node 24); the suggested workaround is running the viewer process on Node 20/22 — [PR #522](https://github.com/PrismarineJS/prismarine-viewer/pull/522)
- README: players render with skin (wide/slim) and cape when the server sends skin data (online-mode servers); web viewer options `viewDistance`, `firstPerson` (default false, i.e. third-person orbit view in the browser), `port` — [README](https://github.com/PrismarineJS/prismarine-viewer)

**Browser clients**
- zardoy/minecraft-web-client (mcraft.fun): active (last push 2026-11-26), supports server versions 1.8-1.21.5 with 1.19.4 and 1.21.4 first-class; three.js WebGL2 renderer with entities, text and resource packs; shaders "not planned"; connects to Java servers through a WebSocket-to-TCP proxy (self-hostable, Docker image); URL params `ip`, `version`, `proxy`, `username`, `autoConnect=true` (needs `allowAutoConnect` in config.json), `replayFileUrl=<url>` to play a packet replay — [minecraft-web-client README](https://github.com/zardoy/minecraft-web-client)
- zardoy/mcraft-fun-mineflayer-plugin (npm `mcraft-fun-mineflayer`): a mineflayer plugin exposing a "viewer connector" (WebSocket port 25588, TCP port 25587 for vanilla clients) so mcraft.fun or a vanilla client can watch the bot's view; mentions a Puppeteer-based headless option to capture the viewer's video stream; README notes known visual issues on 1.21.4; last push 2025-04-30 — [mcraft-fun-mineflayer-plugin](https://github.com/zardoy/mcraft-fun-mineflayer-plugin)
- `mineflayer-spectator` (spectate a bot in-game) only targets the then-latest version, 1.20.1 — [npm mineflayer-spectator](https://npmjs.org/package/mineflayer-spectator)

### Inferences
- For bot on 26.1, the only code-only renderer that claims support is prismarine-viewer installed from GitHub master (not npm). It needs: Node 20/22 (the project runs on Bun, and `gl`/`canvas` are native Node addons, so the capture script should be a separate Node process), `node-canvas-webgl`, and a patched or wrapped headless loop for fixed-fps pacing (e.g. the TCP-socket output mode feeding an own `ffmpeg -framerate 20 -f image2pipe ... -pix_fmt yuv420p`).
- Vertical output is just `width: 1080, height: 1920` in headless options; software/ANGLE GL performance at that size on M1 Max is untested, and real-time 20-60 fps is not guaranteed since rendering is not decoupled from wall time.
- Third-person shots in code: either modify the three.js camera on the viewer after each update, or log in a second "camera" mineflayer bot (spectator mode, positioned by server `/tp ... facing entity <bot>`) and record that bot's first-person headless view; the main bot then appears as a skinned, limb-animated player model. Both are workable but custom.
- Visual quality: block meshes with textures, no vanilla lighting/shadows pipeline, particles, weather, block-breaking animation, held items, or sound are mentioned anywhere; expect a "debug viewer" look. Good as a picture-in-picture or "bot's-eye" insert, weak as the main footage of a Short.
- The mcraft.fun route (Playwright opens the web client, auto-connects through the proxy, records the page) is limited to servers at 1.21.5 or older, so it only applies if the devlog scenario is run on an older server version; spectator/follow behaviour would be whatever a normal logged-in player can do (`/spectate` by command).

### Gaps
- No rendered sample of prismarine-viewer on 26.1 was viewed; fidelity claims are from commit titles and code, not from footage.
- Whether `gl` builds/works on macOS arm64 with current Node 22 was not verified first-hand.
- Whether the web viewer (`firstPerson: false`) third-person view can be recorded reliably through Playwright video capture was not tested; Playwright's built-in video recording quality/fps limits were not researched.
- Whether mcraft.fun honours a server-side `/spectate` camera packet is undocumented.

## 5. Automation: can an AI coding agent drive capture end to end?

### Takeaway
Recording can be fully scripted today (server console commands + ServerReplay, or Flashback's auto-start), and prismarine-viewer can be scripted end to end, but neither replay mod exposes a command-line "render this replay" entry point: export is a GUI action inside a running client. Flashback's shot definitions live in plain JSON, which makes generated camera work plausible but undocumented.

### Cited Findings
- Server-side recording is command-driven: `/replay start players <name>`, `/replay stop players <name>`, or config-based auto-record by player name — [ServerReplay README](https://github.com/senseiwells/ServerReplay)
- Flashback client: `/flashback start|finish|pause|unpause|mark` commands and `automaticallyStart` config; `forceDefaultExportSettings` config block can pin resolution, framerate, container, codec, encoder, SSAA, no-GUI, audio and default export path every time the export window opens — [Flashback.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/Flashback.java); [ForceDefaultExportSettings.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/configuration/ForceDefaultExportSettings.java)
- Flashback stores per-replay editor state (scenes, keyframe tracks) as Gson-serialized JSON at `<gameDir>/flashback/editor_states/<replay-uuid>.json`; replay metadata (`uuid`, `name`, `version_string`, `protocol_version`, `total_ticks`, `markers`, chunk list) is `metadata.json` inside the replay — [EditorStateManager.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/state/EditorStateManager.java); [EditorState.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/state/EditorState.java); [FlashbackMeta.java](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/record/FlashbackMeta.java)
- The editor-state format has broken before: the 0.13.0 changelog warns that existing keyframe information is lost when updating from 0.12.0 — [Flashback changelog](https://modrinth.com/mod/flashback/changelog)
- Flashback has an in-GUI export queue (source has `ExportJobQueue`, `ExportQueueWindow`); the FlashBatch add-on (26.1.x, 26.2) queues every scene of a replay in one click with per-batch resolution/fps/codec and filename patterns (`%seq%`, `%scene%`, `%date%`, `%replay%`), but nothing renders without the user starting it and there is no CLI — [FlashBatch](https://modrinth.com/mod/flashbatch); [Flashback exporting source](https://github.com/Moulberry/Flashback/tree/master/src/main/java/com/moulberry/flashback/exporting)
- Markers can be dropped during recording (`/flashback mark`, four configurable marker keybinds since 0.37.0) to tag moments for later — [Flashback changelog](https://modrinth.com/mod/flashback/changelog)
- ReplayMod docs describe no automated/scripted or command-line rendering — [ReplayMod docs](https://www.replaymod.com/docs/)
- Launching straight into the server is scriptable via the `--quickPlayMultiplayer <address>` game argument — [Minecraft Wiki Quick Play](https://minecraft.wiki/w/Quick_Play)
- `/spectate <target> <player>` and `/tick` are server commands (permission 2 and 3) usable from the console; `/tick` cannot be run from command blocks — [Minecraft Wiki /spectate](https://minecraft.wiki/w/Commands/spectate); [Minecraft Wiki /tick](https://minecraft.wiki/w/Commands/tick)
- prismarine-viewer headless is a plain function call on a mineflayer bot that writes an mp4 through ffmpeg — [examples/headless.js](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/headless.js)

### Inferences
- Fully automatable today (no GUI): start Fabric server -> start bot -> scripted scenario via owner chat -> ServerReplay auto-records the bot -> stop -> a `.mcpr`/Flashback file per scenario lands on disk. This is the durable "raw footage archive" per batch of code changes.
- Semi-automatable (GUI in the loop): opening the replay in Flashback and exporting. Options ranked by robustness: (a) human does 2-5 minutes of framing per clip; (b) agent pre-writes the `editor_states/<uuid>.json` (camera/track-entity/timelapse keyframes computed from the bot's logged coordinates and markers) so the human only opens the replay and clicks export; (c) agent drives the Minecraft window through desktop automation. (b) depends on reverse-engineering an undocumented, version-fragile JSON schema: create one replay by hand, read the resulting JSON, then template it.
- Fully automatable but low fidelity: prismarine-viewer headless (first-person, or a second camera bot) producing 1080x1920 mp4 directly from the same script that runs the scenario.
- Fully automatable live capture: launcher/client started with Quick Play, camera account moved by console `/tp`/`/spectate`, `ffmpeg -f avfoundation` (or OBS via its WebSocket API) recording the window. This requires a logged-in GUI session and screen-recording permission, and is sensitive to window placement.
- A mineflayer "camera bot" has no picture of its own, but it is still useful as a scripted camera rig when paired with either the headless viewer or a GUI client told to `/spectate` it (the GUI client then sees through a smoothly scripted, invisible spectator).

### Gaps
- ReplayMod's camera-path storage: a forum post surfaced by search says paths live in a `paths.json` inside the `.mcpr` and can be copied between replays, but the thread was not opened and ReplayStudio's entry list does not show that name; treat as unverified.
- No evidence found of anyone rendering Flashback or ReplayMod exports from the command line or CI; no JVM flag/system property for auto-export was seen in the Flashback entry class.
- OBS WebSocket scripting on macOS was not researched in this pass.
- The official launcher's support for passing Quick Play args from a shell (versus third-party launchers) was not verified.

## 6. Timelapse of builds

### Takeaway
Do timelapses in the replay, not on the live server: Flashback has dedicated Timelapse and Speed keyframes (with camera motion kept in real time), ReplayMod has time keyframes, and both render offline so any speed-up stays smooth. Server-side `/tick rate` speeds the world but not players, so it will not make a mineflayer bot build faster.

### Cited Findings
- Flashback has Timelapse, Speed (tickrate) and Freeze keyframe types — [keyframe/types directory](https://github.com/Moulberry/Flashback/tree/master/src/main/java/com/moulberry/flashback/keyframe/types)
- Flashback changelog: timelapse keyframe made easier to use (0.3.0); camera-shake speed unaffected by Speed/Timelapse keyframes (0.13.0); non-time keyframes interpolate in real time so speed changes do not speed up camera moves (0.33.0); timelapse duration bug fixed with higher-precision maths (0.43.3); Flashback Extras fixes audio-track sync when timeline speed changes — [Flashback changelog](https://modrinth.com/mod/flashback/changelog); [Flashback Extras](https://modrinth.com/mod/flashback-extras)
- Flashback Camera Orbit keyframe exists (orbit interpolation fix in 0.30.0) — [Flashback changelog](https://modrinth.com/mod/flashback/changelog)
- ReplayMod: time keyframes map replay time onto the path timeline (so a long build can be compressed into seconds); same-timestamp keyframes freeze time; live playback speed slider 0.1x-8x; path timeline max 10 minutes of output — [ReplayMod docs](https://www.replaymod.com/docs/)
- `/tick rate <1.0-10000.0>` (default 20), `/tick freeze|unfreeze`, `/tick step`, `/tick sprint`; added in 1.20.3; rates above default do not speed up players; during a freeze players keep moving — [Minecraft Wiki /tick](https://minecraft.wiki/w/Commands/tick)
- ServerReplay chunk recordings capture a fixed area for as long as the server runs, independent of any player being present — [ServerReplay README](https://github.com/senseiwells/ServerReplay)
- ServerReplay's server-side viewer supports `/replay view speed <multiplier>` — [ServerReplay README](https://github.com/senseiwells/ServerReplay)

### Inferences
- Recipe for "bot builds a house" in 10-15 seconds: record the whole build (ServerReplay player or chunk recording), then in Flashback place an Orbit or slow dolly camera around the build site plus one Timelapse keyframe pair spanning the build; export 1080x1920. The camera glides at normal speed while the build runs at e.g. 30-60x.
- A ServerReplay chunk recording around the build site is a good fit for static-site timelapses because it does not depend on the bot staying in range, but the bot player itself should also be recorded (player recording) if it must appear in frame; whether chunk recordings include players inside the area was not confirmed.
- `/tick rate` above 20 is counter-productive for a mineflayer bot: the bot is a player-type client ticking its own physics at 20/s, so only the world (crops, furnaces, mobs) accelerates. `/tick sprint` is useful for skipping waits (night, smelting, crop growth) before the recorded part.
- A plain ffmpeg speed-up (`setpts`) of live-captured footage also works but multiplies camera shake and gives no camera control.

### Gaps
- Exact semantics/UI of Flashback's Timelapse keyframe (how the target duration is specified) are not documented outside the in-game editor.
- No measured numbers on replay file size per hour of recording for long builds.

## 7. Minecraft Usage Guidelines (videos and monetization)

### Takeaway
Mojang's Usage Guidelines explicitly allow making, sharing and ad-monetizing gameplay videos on YouTube/Twitch/other sites, provided the videos are free to watch, contain enough of the creator's own content, are not sold, and are not vehicles for advertising unrelated products.

### Cited Findings
- The guidelines state creators may create, use and share videos, streams and screenshots of playing or using Minecraft, and: "You may also make money from your videos and streams, through ad revenue" — [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)
- Conditions listed in the same section: the whole video must be free to view (no paywall); the creator must add enough unique content of their own (own commentary qualifies; merely putting a logo, web address or overlays on gameplay does not, and Mojang reserves the right to judge); no distribution of full uninterrupted gameplay via major TV broadcast networks; no public projection in commercial venues; videos must not exist to advertise or promote products or services unrelated to Minecraft; title cards, end credits and sponsorship notices must sit outside the actual game content and be suitable for minors; copies of videos must not be sold — [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)
- The guidelines address the community of players and fans; they do not authorize commercial companies, corporate brands, ad agencies, non-profits, politicians or governments to use these allowances — [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)
- "Commercial use" is defined broadly as any use of the name, brand or assets shared with others, paid or free, including videos and streams — [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)

### Inferences
- A solo developer's devlog Shorts showing an AI bot playing Minecraft, with the creator's own narration/captions and code overlays, fits the allowed pattern (own unique content, free to view, ad revenue only).
- Two things to watch: keep any sponsor or product call-outs outside the gameplay footage, and avoid making the video primarily an advertisement for a non-Minecraft product (a Minecraft bot project is Minecraft-related, but a pitch for an unrelated paid service would not be).

### Gaps
- The naming/branding section of the guidelines (how "Minecraft" may appear in channel or project names) was not extracted in this pass.
- The page's last-updated date was not captured.
- Third-party mods (Flashback is all-rights-reserved with a no-redistribution licence) place no stated restriction on publishing footage, but the Flashback licence text itself was not read.

## 8. Overall comparison of capture methods (objective)

### Takeaway
For repeatable vertical devlogs on 26.1 from an M1 Max, the strongest combination is server-side recording (ServerReplay) or client-side Flashback recording, followed by Flashback export at 1080x1920; live OBS/ffmpeg capture is the fastest to start; prismarine-viewer headless is the only zero-GUI path but looks like a debug view.

### Cited Findings
- Version anchors used in the table: Flashback 0.43.6 for 26.1 and 0.39.10 for 1.21.x — [Modrinth API](https://api.modrinth.com/v2/project/flashback/version); ReplayMod 2.6.28 for 26.1 — [Modrinth API](https://api.modrinth.com/v2/project/replaymod/version); ServerReplay 3.4.3+26.1 — [Modrinth API](https://api.modrinth.com/v2/project/server-replay/version); prismarine-viewer master lists 26.1, npm 1.33.0 does not — [version.js](https://github.com/PrismarineJS/prismarine-viewer/blob/master/viewer/lib/version.js), [npm registry](https://registry.npmjs.org/prismarine-viewer); minecraft-web-client supports up to 1.21.5 — [README](https://github.com/zardoy/minecraft-web-client); OBS 33.0.2 macOS arm64 — [OBS download](https://obsproject.com/download)

### Inferences
Comparison (synthesis of the sections above; "auto" = can run with no human GUI step):

| Method | MC versions | macOS Apple Silicon | Vertical 1080x1920 | Camera control | Recording auto | Rendering auto | Look | Effort |
|---|---|---|---|---|---|---|---|---|
| ServerReplay (server) -> Flashback export | Server 1.17.1-26.3 (26.1: 3.4.3); Flashback 1.21/1.21.1, 1.21.4-1.21.11, 26.1-26.3 | Server is plain Java; Flashback bundles arm64 ffmpeg | Native (9:16 aspect mode, free resolution) | Full, after the fact: camera, orbit, track entity, FOV, time of day | Yes (auto-record by player name) | No CLI; GUI export (pre-written JSON or desktop automation possible) | Real vanilla client render, SSAA, optional shaders | Medium: needs Fabric server + one-time Flashback learning |
| Flashback recorded by a second (spectator) account | 1.21/1.21.1, 1.21.4-1.21.11, 26.1-26.3 | Yes (see above) | Native | Full, after the fact | Partly (`automaticallyStart`, but a GUI client must be running and near the bot) | No CLI | Same as above | Low-medium; works on vanilla/Paper servers |
| ReplayMod (client) or ServerReplay -> ReplayMod | 1.8-26.3 (widest) | Needs Homebrew ffmpeg; Sodium caveat for rendering | Any custom resolution | Position + time keyframes, spectator keyframes | Same as Flashback variants | No CLI documented | Real client render | Medium; older UI, best for versions Flashback lacks |
| Live: spectator account + OBS (optionally Aitum Vertical) | Any | OBS 33 arm64; Aitum Vertical supports macOS | 1080x1920 canvas or 9:16 window | Live only (`/spectate` first-person, free-fly, Freecam tripods, camera-path mods) | Yes with scripting (Quick Play + console `/tp`/`/spectate`) but GUI session required | n/a (real-time) | Real client render at live FPS | Lowest to start; no re-framing later |
| Live: `ffmpeg -f avfoundation` screen grab | Any | Yes (needs screen-recording permission) | Crop/scale in ffmpeg | Same as above | Yes, shell-scriptable | n/a | Same as above, cursor/window caveats | Low |
| prismarine-viewer headless (GitHub master) | 1.8.8-1.21.4 + 26.1 (master only) | Needs Node 20/22 + native `gl`/`canvas` | `width`/`height` options | First-person only out of the box; custom code or a camera bot for third-person | Yes | Yes (ffmpeg pipe), pacing needs a fix | Simplified three.js render: blocks, skinned animated players, dropped items; no vanilla effects | Medium (native deps, patching) |
| mcraft.fun web client + Playwright | Server 1.8-1.21.5 only | Browser-based | Browser viewport size | Whatever a logged-in player can do | Yes in principle | Yes in principle (page video capture) | WebGL2 approximation, no shaders | Medium-high, and excludes 26.1 |

- Suggested default: keep ServerReplay running on the dev server so every scenario is archived automatically; cut devlog clips in Flashback at 1080x1920; use prismarine-viewer headless only for automated "bot's-eye" inserts or CI smoke previews.

### Gaps
- None of these pipelines was executed in this research; all compatibility statements come from listings, source code and docs, not from a test on the creator's machine.
- No hard numbers were found for Flashback export speed on M1 Max at 1080x1920 with SSAA.
