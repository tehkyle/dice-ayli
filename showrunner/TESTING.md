# Testing & pre-show runbook

Two layers: an automated suite you can run any time, and a manual live-QLab
checklist for before a performance. The automated suite proves the app's logic;
only the live checklist proves *your* workspace (cue numbers, passcode, script
cues) is wired right.

## Automated suite

```
npm test
```

- Needs nothing running — no QLab, no server. Safe to run while the real app
  and QLab are open: the tests talk to an in-process fake QLab on ports
  63000/63001 (see `test/fakeQlab.js`), never the real 53000/53001.
- Uses Node's built-in runner (`node --test`), no test dependencies.
- Reads `config.json` for cue names (`qlabMainCueList`, `castConfirmedCue`), so
  it exercises the same identifiers the show uses.

What's covered:

| File | Covers |
|------|--------|
| `test/qlabBridge.test.js` | Verified cast send: read-back verify, lost-packet reconnect+retry, hard-mismatch reporting, confirm cue fired only after clean verify, badpass surfaced instead of a zombie session, playhead pinned to the MAIN cue list |
| `test/format.test.mjs` | Duration/date/cue-display formatters |

Notes for writing more bridge tests: `osc/qlabBridge.js` is a stateful
singleton (session flag, cached workspace/cue-list IDs, poll timers), so bridge
tests live in **one file and run in order** — a test that needs an unconnected
bridge (like the badpass one) must run before anything connects. The `after()`
hook calls `process.exit` because the bridge has no shutdown API; a failing
test still fails `npm test` (the runner reads results before the exit).

## Live QLab smoke test (single cue round-trip)

`test-qlab.js` writes a probe value into one memo cue's notes over real OSC and
reads it back. Use it when a workspace misbehaves and you want to isolate
QLab-vs-app:

```
node test-qlab.js [cueNumber] [passcode] [workspaceName]
# e.g. node test-qlab.js Track_1 5436 ayli
```

**Quit the Dacha-Dice app first** — QLab replies on port 53001 and only one
process can own it.

## Pre-show checklist (live QLab + app)

Run with the real workspace open. Five minutes, in this order:

1. **Sync on review** — pick a cast, open the Confirm Cast screen. Expect
   `✓ Cast synced to QLab` and each `Track_*` memo cue's notes in QLab showing
   the right actor. The confirm cue must **not** have fired yet.
2. **Drift detection** — hand-edit one track cue's notes in QLab, hit Retry on
   the Confirm screen. Expect it to detect and overwrite your edit.
3. **Lock** — press Lock & Send. Expect `CAST_CONFIRMED` to fire in QLab and
   the Progress screen to show `✓ Cast synced to QLab`.
4. **Playhead** — on the Progress screen, click into a *different* cue list in
   QLab and move its playhead. The app's "Next" cue must not budge; moving the
   MAIN list's playhead must update it within ~2s.
5. **Recovery** — quit and relaunch QLab mid-show, then hit Resend Cast.
   Expect one reconnect, a clean re-sync, and the badge returning to green.

If QLab requires a passcode, also confirm the failure message: blank out the
passcode in app settings, retry a sync, and expect the explicit
"passcode required/incorrect" warning — not a silent green badge.

## When something's off at curtain

- **Badge says not synced** → hit **Resend Cast** (Progress screen). It
  reconnects, re-sends only the failed tracks, verifies, and fires the confirm
  cue on success.
- **Resend keeps failing** → check the named tracks: a track name in the
  warning means that cue number is missing/renamed in the workspace.
  `node test-qlab.js <track> <passcode>` (app stopped) isolates it.
- **"Passcode required/incorrect"** → fix `qlabPasscode` in app settings; any
  change forces a fresh session on the next send.
- **Playhead frozen** → Reconnect QLab button; it re-resolves the workspace
  and MAIN cue list and restores the playhead to the last known cue.
