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
| `QLAB_SEND_PORT` | UDP port QLab listens on for OSC (default `53000`) |
| `QLAB_RECEIVE_PORT` | UDP port Dacha DICE: AYLI listens on for QLab events (default `53001`) |
| `ACTORS` | Pipe-delimited list of actor names |
| `CHARACTER_TRACKS` | Pipe-delimited list of character track names — **must match QLab variable names exactly** |

## QLab Setup

### Enable OSC

QLab → Workspace Settings → OSC → Enable OSC control → Port **53000**.

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

### Scene pick events (future)

If QLab needs to report scene picks back to Dacha DICE: AYLI, create a Network Cue pointing to `127.0.0.1:53001` sending:

```
/show/scene_picked   "SceneName"
```

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
