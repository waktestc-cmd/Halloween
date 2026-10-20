# 🎃 Pumpkin Smash

A real-time multiplayer Halloween game for a 20–30 person team meeting (about 12 minutes).
Players hunt through a pitch-dark haunted house with a torch. Six of them find numbered pumpkins,
one finds the hammer, and everyone collects souls (vote weight). The room votes on which pumpkin
to smash. One of the six secretly holds **Friday afternoon off**, an exact 1-in-6 chance.

Built to be easy for people who don't play games: everything is one click, the lantern says what a click
will do ("Open the wardrobe"), and nothing kills you without warning.

**The house** has twelve rooms over four floors. It opens about one room for every two or three players
and more each act, so it is never empty. Doors lead to the quietest open room.

**Hidden pumpkins**: pumpkins and the hammer hide inside the furniture. A hidden pumpkin glows through
the cracks; one click opens a wardrobe, chest or oven. Empty ones sometimes hold a soul.

**Residents**, one per room, each with one rule. Light on them and they stop; if one reaches you, you
get a fright and drop a soul, never a death:

| Room | Resident | Rule |
| --- | --- | --- |
| Kitchen | Michael Myers | Comes closer while your light is elsewhere. Your light stops him; three seconds of it sends him away. |
| Lake | Jason | Rises out of the water, then the same as Michael. |
| Chapel | Valak | Steps out of the painting if you stop watching it, then the same. |
| Parlour | Samara | The television turns itself on; what crawls out stops in your light. |
| Nursery | Annabelle | Moves closer every time you look away. |
| Boiler room | Freddy | Comes if you stand still. Keep moving. |
| Hall | Ghostface | The telephone rings. Answer it for a fright and two souls. |
| Cellar | Pennywise | Do not take the balloon. |

* Node.js + Express + Socket.io, all state in memory, single process, single room.
* Plain HTML/CSS/JS. The hunt is a WebGL torch lighting twelve painted rooms (with a Canvas 2D fallback);
  everything else is drawn in code. Sound is synthesised with Web Audio, plus a few CC BY recordings
  credited in `ASSETS.md` and the end credits.
* Full spec: [SPEC.md](SPEC.md). Visual direction: [ART_DIRECTION.md](ART_DIRECTION.md) ("light is the only colour").
* Every asset, its source and licence: [ASSETS.md](ASSETS.md).

## Screens

| Route | Who | Notes |
| --- | --- | --- |
| `/host?key=HOST_KEY` | the shared screen you present on the call | QR code, costume wall, live feed, mini-map, pumpkin slots, leaderboard, vote bars, smash, result. Controls (quiet, bottom right): Open the house, Pause, Skip act, Next, Reset. Keys: `Space` pause, `→` next, `F` full screen, `M` mute. Add `&mild=1` for gentler host effects. |
| `/` | every player (laptop or phone) | name + costume, Spooky/Mild toggle, full-screen button, the hunt, voting. |

## Running a session (host checklist)

1. Open `/host?key=…` and share that tab (with audio, if your call tool supports it).
2. People scan the QR code or type the URL, pick a name and a costume, and appear on the costume wall.
3. Click **Open the house**. The game runs itself: Rules (20s) → Act 1 Pumpkin Rush (3:00) → Act 2 The Hammer (1:30) → Act 3 Soul Harvest (2:30) → Pitches (10s each) → Vote (45s) → Smash → Result.
4. During pitches, ask each pumpkin holder to unmute. **Next** moves on early.
5. **Reset** sends everyone back to the lobby for another round (players stay joined).

If someone's browser drops, they reopen the page: the same name in the same browser rejoins automatically
with their souls, pumpkin and hammer intact. From another device, typing the same name works once the old
connection has dropped. While it is still connected, the name is refused so two people can't share one.

## Run locally

```bash
npm install
HOST_KEY=letmein npm start          # http://localhost:3000  and  http://localhost:3000/host?key=letmein
```

`HOST_KEY` defaults to `spooky` when unset (fine locally, not in production). `PORT` defaults to 3000.

### Fallback: share your laptop with a tunnel

If Cloud Run isn't an option, run it locally and expose it with Cloudflare's free quick tunnel:

```bash
HOST_KEY=letmein npm start
cloudflared tunnel --url http://localhost:3000
```

Share the printed `https://….trycloudflare.com` URL. The host screen's QR code uses whatever URL the host page
was opened with, so open the host screen through the tunnel URL too.

## Testing on your own

```bash
DEV_FAST=1 npm start                 # all game timers at 15% (whole game ≈ 1.5 minutes)
npm run bots -- 25                   # 25 fake players join, wander, claim, die and vote
npm run bots -- 25 --start --exit    # …also start the game as host (uses HOST_KEY) and exit at the result
```

Open `/host?key=spooky` and `/` in a couple of tabs alongside the bots to play with them.
Bot options: `--url http://host:port` (default `http://localhost:$PORT` or `3000`).

`DEV_FORCE_WIN=1` (only honoured together with `DEV_FAST=1`) makes the smash always hit the prize pumpkin,
so you can rehearse the win screen.

## Deploy to Google Cloud Run

Prerequisites: a Google Cloud project with billing enabled, and the `gcloud` CLI logged in
(`gcloud auth login`, `gcloud config set project YOUR_PROJECT`).

```bash
gcloud run deploy pumpkin-smash \
  --source . \
  --region europe-west2 \
  --allow-unauthenticated \
  --max-instances 1 \
  --min-instances 1 \
  --session-affinity \
  --timeout 3600 \
  --set-env-vars HOST_KEY=choose-a-secret
```

* `--source .` builds the included `Dockerfile` (node:20-alpine) with Cloud Build. The app listens on `$PORT`.
* `--max-instances 1` is required: all game state lives in one process's memory.
* `--min-instances 1` keeps the instance warm, so nobody hits a cold start or loses state mid-game.
* `--session-affinity` + `--timeout 3600` keep WebSocket connections pinned and open for up to an hour.

The command prints the service URL. Players use `https://…run.app/`, and you open
`https://…run.app/host?key=choose-a-secret`.

> **After the meeting:** set min-instances back to 0 so you stay in the free tier:
>
> ```bash
> gcloud run services update pumpkin-smash --region europe-west2 --min-instances 0
> ```

## How it works

* `server.js`: Express routes (`/`, `/host` with key check, `/qr.svg`, `/healthz`), Socket.io wiring.
* `src/game.js`: the state machine (LOBBY → RULES → HUNT acts 1–3 → PITCHES → VOTE → SMASH → RESULT) on a
  pausable 100 ms tick. It is server-authoritative: pumpkins, the hammer and souls have `{id, t, r, x, y}` with
  normalised coordinates, and claims are atomic, rate-limited (10/s per player) and checked against the
  player's room. Random events: one in each of acts 1 and 2 (Locked Doors / Ghost Flood / Soul Shower), plus the
  Act 3 Blood Moon.
* The winning pumpkin is drawn with `crypto.randomInt` when the game starts. It is only ever sent in the RESULT
  payload.
* `public/room.js`: the room renderer. A fixed-camera painting lit by the player's lantern in WebGL: each pixel's
  3D position is rebuilt from the depth map and lit through its normal, with depth parallax, a foreground
  silhouette layer, door-crack and candle lights, film grain and a heavy vignette. Falls back to a Canvas 2D
  radial mask without WebGL (force it with `?nogl=1`).
* `public/player.js`: the hunt in room space (souls rest on the painted floor, pumpkins hide in the furniture;
  the camera pans toward the torch so phones in portrait can look around), client-side ghosts (one per room)
  and floor-bound zombies (in rooms without a resident; two in act 3) that shamble toward your light. A zombie
  never kills on touch: it rears up and snarls (the warning), then swipes; move the light away in time and it
  misses. Your lantern takes three hits from a zombie or a ghost (the three flames in the HUD) and relights one
  notch after 20 s without a hit. The other players in your room as their lanterns and silhouettes (their light reveals the room
  around them), doors that open a crack of light, dust in the beam, hints, death and respawn; plus join,
  pitches, vote, smash and result.
* `public/host.js`: the broadcast: house-facade lobby, the mantel of six pumpkins, a candle timer, the séance
  log, a floor plan, vote-by-brightness, the smash and end credits.
* `public/common.js`: design tokens, the 12 cut-paper costume silhouettes, pumpkins (unlit / lit), hammer,
  souls, smoke ghosts, event-only particles, the smash/result stage (with a 120 ms hit-stop), and the Web Audio
  synth (drones, creaks, footsteps, breathing, whispers, scream, drumroll, boom, bells).
* `tools/build_rooms.py`: turns the team's room paintings and character images into the game's files:
  each painting plus normal and depth maps from its one-point perspective, `public/rooms/rooms.json`
  (doors, hiding places, floors, where residents stand) and the WebP sprites in `public/sprites/`.
* `public/residents.js`: the eight residents, one per room, each with one easy rule.
  See [ASSETS.md](ASSETS.md) for swapping in painted rooms.
* `public/shared.js`: rooms, costumes, ghosts and events, shared by the server, clients and bots.
* `bots.js`: the bot simulator.

## Renaming the game

The name lives in one place: `TITLE` in `public/shared.js`. The pages, the host screen and the server log all
read it from there.
