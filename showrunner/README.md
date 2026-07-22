# Dacha DICE: AYLI

Cast management and QLab OSC bridge for interactive theatre.

## Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) + Node.js LTS
- [pm2](https://pm2.keymetrics.io/) (for production startup)

```bash
nvm install --lts
nvm use --lts
npm install -g pm2
```

## Installation

```bash
cd showrunner
npm install
```

## Configuration

Copy `.env.example` to `.env` and edit:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | HTTP port for the operator UI (default `3000`) |
| `QLAB_HOST` | IP address of the QLab machine (default `127.0.0.1`) |
| `QLAB_PORT` | Port QLab listens on for OSC, and where Dacha DICE: AYLI connects out to it over TCP (default `53000`) |
| `QLAB_CUE_PORT` | Port Dacha DICE: AYLI listens on for QLab's Network Cue pushes (scene-start events) — QLab connects *into* this app, the opposite direction from `QLAB_PORT` above (default `53100`) |
| `ACTORS` | Pipe-delimited list of actor names |
| `CHARACTER_TRACKS` | Pipe-delimited list of character track names — **must match QLab variable names exactly** |

## QLab Setup

### Enable OSC

QLab → Workspace Settings → OSC → Enable OSC control → Port **53000**. Dacha DICE: AYLI talks to QLab over TCP (not UDP) on this port — no other configuration needed on QLab's side for this direction.

### Required workspace variables

Declare these variables in the QLab workspace (Workspace Settings → Variables). Names must match `CHARACTER_TRACKS` in `.env`:

- `ROLE_LEAD`
- `ROLE_SUPPORT_A`
- `ROLE_SUPPORT_B`
- `ROLE_ENSEMBLE_1`
- `ROLE_ENSEMBLE_2`
- `ROLE_ENSEMBLE_3`

### CAST_CONFIRMED cue

Create a cue (or cue list) with the name/number `CAST_CONFIRMED`. Dacha DICE: AYLI fires `/cue/CAST_CONFIRMED/start` after all variables are set. Wire this cue to whatever confirmation logic the show needs.

### Scene-start events

For Dacha DICE: AYLI to track when a scene actually starts, create a Network Cue with a patch set to **TCP**, host `127.0.0.1` (or the app's IP if it's on a different machine), port **53100** (or whatever port is set in the app's Settings → QLab Connection → **Cue Port**, if changed from the default), sending:

```
/show/scene_started   "SceneName"
```

For this connection, Dacha DICE: AYLI listens and QLab connects to it — the normal direction for a "push" — the opposite of the "Enable OSC" connection above, where the app dials out to QLab. Just make sure the patch's **port** matches the app's Cue Port setting.

If scenes aren't showing up in the app, open the app's OSC Monitor (gear-row icon) first — it shows raw/undecodable traffic even if something arrives malformed, not just successfully-parsed messages. If it shows nothing at all, confirm with `lsof -iTCP:53100` (swap in your actual Cue Port) that the app is actually listening there, and if you've been reconfiguring ports while QLab stayed running, try fully quitting and relaunching QLab — a live settings change doesn't always take effect until QLab restarts.

A matching `/show/end` cue (no arguments) marks the show as finished.

## Running

### Development

```bash
npm run dev
```

### Production (pm2)

```bash
pm2 start server.js --name showrunner
pm2 save
pm2 startup   # follow the printed command to enable auto-start on boot
```

## Operator UI

Open `http://localhost:3000` in a browser on the show Mac.

Work through the three-screen flow:
1. **Welcome** — confirms today's date and performance number, then begins cast entry
2. **Cast Assignment** — assign each character track to an actor; duplicates are blocked
3. **Confirmation** — review the full cast, then lock and send to QLab

Cast is always saved to the local SQLite database at `db/showrunner.db` before OSC is attempted. If QLab is unreachable the UI displays a warning but the cast record is preserved.
