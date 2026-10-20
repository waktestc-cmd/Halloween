# 🎃 Pumpkin Smash

A real-time multiplayer Halloween game for a 20–30 person team meeting (about 12 minutes).
Players hunt through a pitch-dark haunted house with a torch. Six of them find numbered pumpkins,
one finds the hammer, and everyone collects souls (vote weight). The room votes on which pumpkin
to smash. One of the six secretly holds **Friday afternoon off**, an exact 1-in-6 chance.

* Node.js + Express + Socket.io, all state in memory, single process, single room.
* Plain HTML/CSS/JS + Canvas 2D. Every graphic is drawn in code; every sound is synthesised with Web Audio.
* Full spec: [SPEC.md](SPEC.md).

## Screens

| Route | Who | Notes |
| --- | --- | --- |
| `/host?key=HOST_KEY` | the shared screen you present on the call | QR code, costume wall, live feed, mini-map, pumpkin slots, leaderboard, vote bars, smash, result. Controls: Start, Pause, Skip act, Next, Reset. Keys: `Space` pause, `→` next, `F` full screen, `M` mute. Add `&mild=1` for gentler host effects. |
| `/` | every player (laptop or phone) | name + costume, Spooky/Mild toggle, full-screen button, the hunt, voting. |

## Running a session (host checklist)

1. Open `/host?key=…` and share that tab (with audio, if your call tool supports it).
2. People scan the QR code or type the URL, pick a name and a costume, and appear on the costume wall.
3. Click **Start**. The game runs itself: Rules (20s) → Act 1 Pumpkin Rush (3:00) → Act 2 The Hammer (1:30) → Act 3 Soul Harvest (2:30) → Pitches (10s each) → Vote (45s) → Smash → Result.
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
* `public/player.js`: the dark house. Torch-lit canvas, five code-drawn rooms, client-side ghosts (Hollow Butler,
  Rag Doll Wraith, Bone Warden, Drowned Bride, Choir Shade), doors, hints, death and respawn.
* `public/host.js`: the shared screen.
* `public/common.js`: Web Audio synth (drones, creak, chimes, whispers, scream, drumroll, boom, fanfare),
  particles, screen shake, and all the drawing code (pumpkins, hammer, souls, doors, ghosts, costumes).
* `public/shared.js`: rooms, costumes, ghosts and events, shared by the server, clients and bots.
* `bots.js`: the bot simulator.
