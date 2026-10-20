# Pumpkin Smash — Build Spec

A real-time multiplayer Halloween game for a 20–30 person team meeting (~12 minutes). Players hunt in a pitch-dark haunted house. 6 players find pumpkins, 1 finds a hammer, everyone collects souls (vote weight). The room votes which pumpkin to smash. One of the 6 pumpkins secretly contains "Friday afternoon off" → exactly a 1-in-6 chance.

## Stack

* Node.js + Express + Socket.io. All game state in server memory. No database.
* Plain HTML/CSS/JS + Canvas 2D frontend (no framework, no image files). All graphics are drawn in code.
* Sound generated with the Web Audio API (no audio files).
* Single process, single room. Deploy to Google Cloud Run (max-instances=1).

## Routes

* `/host`: the shared screen (presented on the video call). Protect it with `?key=HOST_KEY` (env var).
* `/`: the player screen. Laptop-first (mouse), but it must still work on phones (touch).

## Join

* Player enters a name (max 16 chars) and picks a costume: Witch 🧙, Vampire 🧛, Mummy, Skeleton 💀, Werewolf 🐺, Zombie 🧟, Ghost 👻, Pumpkin-head 🎃, Bat 🦇, Black Cat 🐈‍⬛, Spider 🕷️, Devil 😈. (Emoji or simple code-drawn glyphs, shown in a glowing tile grid. Duplicates allowed.)
* Toggle: Spooky (full sound, flicker, jump scares) / Mild (no scream sounds, gentler effects).
* "Go full screen" button.
* Rejoin with the same name restores the player's state (handle disconnects).
* The costume appears everywhere: lobby, live feed, pumpkin holders, vote screen, results.

## Phases (server state machine)

1. **LOBBY**: The host shows the QR code + URL, the player count, and a costume wall of joined players. Host clicks Start.
2. **RULES** (20s): One big screen: "Find pumpkins. Find the hammer. Collect souls. Avoid ghosts."
3. **HUNT** (~7 min total, 3 acts, auto-advancing with timers; the host can Pause / Skip act):
   * Act 1 – Pumpkin Rush (3:00): A new numbered pumpkin (1–6) spawns every 30s in a random room. The first click claims it. Max 1 pumpkin per player. Pumpkins are SAFE once claimed (never dropped). If any pumpkin is still unclaimed when the act ends, the act extends until all 6 are claimed (the hint glows stronger).
   * Act 2 – The Hammer (1:30): One hammer, visible only to players without a pumpkin. It jumps position every 1.5s and changes room every 15s. If it is not found by the end, it is given to a random non-holder.
   * Act 3 – Soul Harvest (2:30): A soul storm: many more souls spawn, ghosts get faster, and a "Blood Moon" event halves the torch radius for 30s.
   * Souls exist throughout all acts (light spawn in Acts 1–2, heavy in Act 3). Each soul = +1 vote weight.
4. **PITCHES**: The host steps through the 6 holders (big costume + name + pumpkin number, 10s timer each, Next button).
5. **VOTE** (45s): Every player votes for one pumpkin and can change their vote until close. Vote weight = 1 + souls. Live weighted bars on the host. Ties are broken randomly.
6. **SMASH**: "🔨 [hammer holder] swings at Pumpkin N ([holder])…", then a 3s drumroll, screen shake, and an explosion of particles.
7. **RESULT**: The winning pumpkin index is chosen with crypto-random at game start and is NEVER sent to clients before this.
   * Winner → "FRIDAY AFTERNOON OFF!" with a massive confetti and colour storm.
   * Otherwise → "ZOMBIE PUMPKIN" with a red glitch, then reveal which pumpkin was the real winner.
   * Awards: Most Souls, Most Haunted (most deaths), Hammer Hero.
   * Host has a Reset game button.

## The dark house (player screen during HUNT)

* 5 rooms: Hall, Attic, Crypt, Swamp, Chapel. Each has its own accent colour and ambient drone. Each player starts in a random room. The room name is shown faintly in a corner.
* The full-screen canvas is near-black. The torch is a soft radial light (~8% of screen width) following the mouse or finger, with a slight flicker. Items are only visible inside the torch light. The player's costume glyph sits at the torch centre. Hide the system cursor.
* Doors: every 5–8s a glowing door fades in at a random spot for 3.5s. Clicking it moves the player to a random other room (creak sound and a short transition).
* Hints: if the player has collected nothing for 30s, a faint pulsing glow appears at the screen edge, pointing toward the nearest door or item in the current room.
* Ghosts: each room has its own original ghost, drawn in code (glowing translucent shape, distinct colour and motion): Hall – Hollow Butler; Attic – Rag Doll Wraith; Crypt – Bone Warden; Swamp – Drowned Bride; Chapel – Choir Shade. Ghosts are client-side. They drift and occasionally home in on the torch. Speed increases each act.
* Death: if a ghost overlaps the torch centre: red glitch, then "YOU WERE TAKEN BY THE [GHOST]" with the ghost's face. Respawn after 5s in a random room with 3s of invisibility. On death the player drops half their souls (rounded down) as shared souls at that spot, for anyone to grab. Report deaths to the server. Pumpkin and hammer holders keep their items.
* Random events (server-triggered, 2–3 per hunt, announced on all screens): Blood Moon (torch at half size), Locked Doors (no doors for 15s), Ghost Flood (one room gets 3 extra ghosts), Soul Shower (a burst of souls in one room).

## Shared objects (server-authoritative)

* Pumpkins, hammer and souls have `{id, type, room, x, y}` with x and y normalised to 0–1. The server broadcasts spawns, moves and claims. Claims are first-come and atomic on the server.
* Rate-limit claims (max ~10/s per player). Validate that the player is in the item's room.

## Host screen (shown on the call)

* Lobby: QR code, URL, costume wall.
* Hunt: act name + countdown, big live feed with costumes ("🧛 Priya grabbed Pumpkin 3!", "💀 Rob was taken by the Drowned Bride", "🔨 Sam found the hammer!"), a room mini-map showing players per room, the 6 pumpkin slots filling up, and the top-5 soul leaderboard.
* Then the pitches, vote bars, smash and result screens as above. Host controls: Start, Pause, Skip, Next, Reset.

## Visual direction: minimal shapes, intense colour

* Background `#05010a`. Neon palette: ultraviolet `#8b2bff`, toxic green `#39ff14`, blood orange `#ff5a00`, hot magenta `#ff2bd6`, ghost cyan `#00f0ff`, blood red `#ff1744`.
* Everything glows (canvas shadowBlur / additive blending). Heavy use of particles, trails, screen shake, chromatic flashes on claims, and confetti on the win. Bold display font from Google Fonts (e.g. "Creepster" for titles, "Inter" for UI). It should feel chaotic, saturated and HD, not cluttered.
* Respect Mild mode (reduced flashing; no screams).

## Sound (Web Audio, synthesised)

* Per-room ambient drone, door creak, claim chime, soul ping, ghost whisper on approach, death scream (Spooky only), drumroll, smash boom, victory fanfare. Global mute button.

## Testing

* `npm run bots -- 25`: a script that connects N fake players with random names and costumes. The bots wander rooms, claim items occasionally, die occasionally and vote randomly, so the full flow can be tested alone.
* A `DEV_FAST=1` env var shortens all timers to 10–20% for quick tests.

## Deployment

* `Dockerfile` (node:20-alpine), listen on `process.env.PORT`.
* README with deploy steps: `gcloud run deploy pumpkin-smash --source . --region europe-west2 --allow-unauthenticated --max-instances 1 --min-instances 1 --session-affinity --timeout 3600 --set-env-vars HOST_KEY=...`
* Note in the README: set min-instances back to 0 after the meeting to stay in the free tier.
* Also document running locally (`npm start`) plus `cloudflared tunnel --url http://localhost:3000` as a fallback.
