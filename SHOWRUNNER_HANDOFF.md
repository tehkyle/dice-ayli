# Showrunner — Claude Code Handoff & Build Brief

## Project Overview

Build a local Node.js application called **Showrunner** that serves as a cast management and QLab OSC bridge for an interactive theatre production. The show features:

- 9 potential actors filling 6 character tracks per performance
- Cast is set by an operator at top of show via a browser UI
- Cast data is sent to QLab via OSC to set variables that drive audio file targeting
- Every show's cast is recorded to a local SQLite database
- Show data is pushed to Supabase (cloud) for a marketing display (future phase)

**This first build phase covers:**
1. The Node.js server (bare metal, managed by pm2)
2. The operator cast-picker browser UI
3. The OSC bridge to QLab

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js (LTS) via nvm | Bare metal on show Mac, not Docker |
| Process manager | pm2 | Auto-start on boot |
| Web server | Express | Serves operator UI + REST API |
| OSC | node-osc | UDP send to QLab, UDP receive from QLab |
| Database | better-sqlite3 | Local SQLite, zero config |
| Realtime (future) | socket.io | Already scaffold in, for marketing display phase |
| Cloud sync (future) | Supabase | Scaffold config but don't implement yet |
| Frontend | Vanilla JS + CSS | No build step, no framework complexity |

---

## Project Structure

```
showrunner/
├── server.js               # Main entry point
├── package.json
├── .env                    # Config (ports, actor list, QLab IP)
├── .env.example
├── db/
│   ├── database.js         # SQLite connection + schema init
│   └── showrunner.db       # Auto-created on first run (gitignore)
├── osc/
│   └── qlabBridge.js       # OSC client + server, all QLab communication
├── routes/
│   ├── shows.js            # REST API routes for show/cast management
│   └── config.js           # Route to serve actor/character config to frontend
├── public/
│   ├── index.html          # Operator cast-picker UI
│   ├── style.css
│   └── app.js              # Frontend JS
└── README.md
```

---

## Environment Variables (.env)

```
PORT=3000
QLAB_HOST=127.0.0.1
QLAB_SEND_PORT=53000
QLAB_RECEIVE_PORT=53001

# Pipe-delimited list of actor names
ACTORS=Jordan|Sam|Alex|Morgan|Casey|Riley|Quinn|Drew|Taylor

# Pipe-delimited list of character track names (must match QLab variable names)
CHARACTER_TRACKS=ROLE_LEAD|ROLE_SUPPORT_A|ROLE_SUPPORT_B|ROLE_ENSEMBLE_1|ROLE_ENSEMBLE_2|ROLE_ENSEMBLE_3
```

---

## Database Schema

Initialize these tables on first run if they don't exist:

```sql
CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_date TEXT NOT NULL,
  performance_number INTEGER,
  locked_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cast_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES shows(id),
  character_track TEXT NOT NULL,
  actor_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scene_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER REFERENCES shows(id),
  scene_name TEXT NOT NULL,
  position INTEGER,
  timestamp TEXT NOT NULL
);
```

---

## OSC Bridge (`osc/qlabBridge.js`)

### Sending to QLab

QLab listens for OSC on UDP port 53000 (configurable via `.env`).

**Variable setter pattern** — QLab requires variables to be pre-declared in the workspace. The OSC address to set a variable named `ROLE_LEAD` is:

```
/var/ROLE_LEAD   "Jordan"
```

Send one message per character track when cast is locked.

**Cue trigger** — after all variables are set, fire the confirmation cue:

```
/cue/CAST_CONFIRMED/start
```

### Receiving from QLab

Listen on UDP port 53001. QLab Network Cues will send scene-pick events to this port:

```
/show/scene_picked   "SceneA"
```

When received, write to `scene_log` table and emit a `scene_played` socket.io event (for future marketing display).

### Implementation notes

- Use `node-osc` for both client and server
- Wrap sends in try/catch and log failures — never let an OSC error crash the server
- Log all outbound and inbound OSC messages to console with timestamps
- Export functions: `sendCastToQLab(castMap)`, `startReceiver(db, io)`

---

## REST API Routes

### `GET /api/config`
Returns actor list and character track list from `.env`. Used by frontend on load.

```json
{
  "actors": ["Jordan", "Sam", "Alex", ...],
  "characterTracks": ["ROLE_LEAD", "ROLE_SUPPORT_A", ...]
}
```

### `POST /api/shows`
Creates a new show record. Call this when operator starts setup.

Request body:
```json
{ "notes": "optional notes" }
```

Returns:
```json
{ "id": 1, "show_date": "2026-04-30", "performance_number": 3 }
```

Performance number is auto-calculated as count of today's shows + 1.

### `POST /api/shows/:id/cast`
Locks cast for a show. Saves to DB, sends OSC to QLab.

Request body:
```json
{
  "cast": {
    "ROLE_LEAD": "Jordan",
    "ROLE_SUPPORT_A": "Sam",
    "ROLE_SUPPORT_B": "Alex",
    "ROLE_ENSEMBLE_1": "Morgan",
    "ROLE_ENSEMBLE_2": "Casey",
    "ROLE_ENSEMBLE_3": "Riley"
  }
}
```

Returns:
```json
{ "success": true, "qlabNotified": true }
```

`qlabNotified` reflects whether OSC sends completed without error.

### `GET /api/shows`
Returns list of all shows with their cast assignments. Used for history view.

### `GET /api/shows/today`
Returns today's shows only.

---

## Operator UI (`public/`)

Three-screen single-page flow. No page reloads — just show/hide sections.

### Screen 1 — Welcome / Show Setup
- Display: today's date, performance number for today ("Performance #3")
- Button: "Begin Cast Entry" → calls `POST /api/shows`, stores returned show ID, advances to Screen 2

### Screen 2 — Cast Assignment
- Load character tracks and actor names from `GET /api/config`
- Render one row per character track, each with:
  - Character track label (human-readable, e.g. "Lead" not "ROLE_LEAD" — map these)
  - Dropdown of all 9 actors
  - Visual indicator (empty/filled state)
- Validation:
  - Same actor cannot be selected for two tracks
  - If duplicate detected, highlight both rows in red and disable confirm button
  - Confirm button only enables when all 6 tracks are assigned with no duplicates
- Button: "Review Cast →"

### Screen 3 — Confirmation
- Display full cast list clearly, large and readable (operator may be looking across a desk)
- Button: "Lock & Send to QLab" → calls `POST /api/shows/:id/cast`
- On success: show a clear "✓ CAST LOCKED — QLab notified" success state
- On OSC failure: show "✓ Cast saved — QLab notification failed" warning state (don't block the operator — cast is saved locally regardless)
- Button: "Start New Show" → resets to Screen 1

### Human-readable character track labels
Map the env variable names to display names in the frontend config:
```javascript
const trackLabels = {
  ROLE_LEAD: "Lead",
  ROLE_SUPPORT_A: "Support A",
  ROLE_SUPPORT_B: "Support B",
  ROLE_ENSEMBLE_1: "Ensemble 1",
  ROLE_ENSEMBLE_2: "Ensemble 2",
  ROLE_ENSEMBLE_3: "Ensemble 3"
};
```

### UI Design Notes
- Dark theme — this runs in a stage management environment, low light
- Large touch targets — operator may be using this under pressure
- High contrast text — legible at arm's length
- No unnecessary animations — clarity over flourish

---

## QLab Integration Notes

### What QLab needs on its end
The QLab workspace must have these pre-declared variables (matching `CHARACTER_TRACKS` in `.env`):
- `ROLE_LEAD`
- `ROLE_SUPPORT_A`
- `ROLE_SUPPORT_B`
- `ROLE_ENSEMBLE_1`
- `ROLE_ENSEMBLE_2`
- `ROLE_ENSEMBLE_3`

And a cue with the number or name `CAST_CONFIRMED` that the show calls when variables are set.

### OSC must be enabled in QLab
QLab → Workspace Settings → OSC → Enable OSC control, port 53000.

---

## Error Handling Priorities

1. **OSC failure must never block cast save** — always write to SQLite first, then attempt OSC
2. **Server crash must be recoverable** — pm2 restarts automatically, SQLite state persists
3. **Duplicate actor assignment** — catch in frontend before API call, also validate server-side
4. **QLab not running** — OSC send will fail silently; log the error, return `qlabNotified: false` in API response

---

## What NOT to Build Yet (Future Phases)

- Marketing / lobby display
- Supabase cloud sync
- Scene logging back-channel (OSC receive from QLab)
- Show history UI
- Actor photo support
- Weighted scene randomizer UI

Scaffold socket.io and the OSC receiver in the server so they're easy to activate, but don't build the consumer features yet.

---

## README Should Include

- Prerequisites (Node LTS, nvm)
- Installation steps
- `.env` setup instructions
- How to configure QLab (OSC port, required variables, CAST_CONFIRMED cue)
- pm2 startup instructions
- How to access the operator UI (`http://localhost:3000`)

---

## First Build Goal

A running local server where an operator can:
1. Open `http://localhost:3000` in a browser
2. Work through the three-screen flow
3. Confirm a cast
4. See the cast saved in SQLite
5. See OSC messages fire toward QLab (even if QLab isn't running — just confirm the sends are attempted and logged)
