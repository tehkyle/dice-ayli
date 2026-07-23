const fs   = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { QLabTcpConnection, QLabTcpListener } = require('./tcpTransport');
const { extractWorkspaceId, photoFolderName } = require('../utils');
const { getQlabPhotosDir } = require('../dataDir');

// ── Network config (config.json → .env → default) ──────────────────────────────
const DEFAULT_HOST      = '127.0.0.1';
const DEFAULT_PORT      = 53000;
// IANA's dynamic/private range (49152–65535) — never assigned to a named
// service, so nothing else defaults here. Deliberately not 53001: that's
// the port a naive OSC client (e.g. the QLab Stream Deck plugin) hardcodes
// for itself — irrelevant to this port's actual purpose (see cueReceiver
// below), but no reason to invite confusion by reusing it.
const DEFAULT_CUE_PORT  = 53100;

function resolveNetwork() {
  const { qlabHost, qlabSendPort, qlabCuePort } = loadConfig();
  return {
    host:    (qlabHost || '').trim() || process.env.QLAB_HOST || DEFAULT_HOST,
    port:    parseInt(qlabSendPort, 10) || parseInt(process.env.QLAB_PORT, 10)     || DEFAULT_PORT,
    cuePort: parseInt(qlabCuePort, 10)  || parseInt(process.env.QLAB_CUE_PORT, 10) || DEFAULT_CUE_PORT,
  };
}

// ── Timing constants ───────────────────────────────────────────────────────────
const WORKSPACE_DISCOVER_MS = 2000;
const CONNECT_TIMEOUT_MS    = 2000;
const HEALTH_CHECK_MS       = 3000;
const PLAYHEAD_QUERY_MS     = 500;
const PLAYHEAD_POLL_MS      = 2000;
// Success is silent (confirmed live) — every go/panic pays this wait in full, so
// keep it tight. Denied/error replies on loopback arrive in single-digit ms;
// 200ms leaves a large margin without making a successful go feel laggy.
const GO_REPLY_TIMEOUT_MS    = 200;
const PANIC_REPLY_TIMEOUT_MS = 200;
const CAST_VERIFY_MS         = 1500;

// ── QLab OSC address builders ──────────────────────────────────────────────────
// These are the complete set of OSC paths this module writes to or reads from.
const OSC = {
  workspaces: ()                   => '/workspaces',
  connect:    (ws)                 => `/workspace/${ws}/connect`,
  // Global toggle, not workspace-scoped — QLab has no /workspace/{ws}/updates address.
  updates:    ()                   => '/updates',
  cue:        (ws, id, cmd)        => ws ? `/workspace/${ws}/cue/${id}/${cmd}` : `/cue/${id}/${cmd}`,
  cueById:    (ws, id, prop)       => `/workspace/${ws}/cue_id/${id}/${prop}`,
  panic:      (ws)                 => ws ? `/workspace/${ws}/panic` : '/panic',
  playhead:   (ws, cue)            => `/workspace/${ws}/playhead/${cue}`,
};

// ── Internal state ─────────────────────────────────────────────────────────────
const replyBus = new EventEmitter();
replyBus.setMaxListeners(20);

// Single persistent TCP connection — replies arrive on the same socket that
// sent the request, so unlike UDP there's no reply-port to negotiate and no
// separate local listener that can collide with another app's OSC client.
const initialNetwork = resolveNetwork();
const oscClient = new QLabTcpConnection(initialNetwork.host, initialNetwork.port);
oscClient.on('message', handleIncomingMessage);
oscClient.on('send', (address, args) => recordOsc('out', address, args));
oscClient.on('rawData', (chunk) => recordOsc('in', '(raw)', [], { raw: chunk.toString('hex') }));
oscClient.on('decodeError', (frame, err) =>
  recordOsc('in', '(undecodable)', [], { raw: frame.toString('hex'), error: err.message }));

// A TCP listener for QLab's own outbound pushes — a Network Cue firing
// /show/scene_started, /show/end, etc. QLab is the client on this channel,
// dialing in to us; this app is the server. (Opposite of oscClient above,
// where this app dials QLab.) Created lazily by startReceiver(), not here —
// see oscClient's lazy-connect reasoning; the same applies to binding a
// socket eagerly at module load.
const cueReceiver = new QLabTcpListener(initialNetwork.cuePort);
cueReceiver.on('message', handleIncomingMessage);
cueReceiver.on('error', (err) => logErr(err.message));
cueReceiver.on('connection', (addr) => log(`Cue port: connection from ${addr}`));
cueReceiver.on('disconnect', (addr) => log(`Cue port: ${addr} disconnected`));
// The only way to see what a misconfigured Network Cue patch actually put
// on the wire instead of just "nothing happened".
cueReceiver.on('rawData', (chunk) => recordOsc('in', '(raw)', [], { raw: chunk.toString('hex') }));
cueReceiver.on('decodeError', (frame, err) =>
  recordOsc('in', '(undecodable)', [], { raw: frame.toString('hex'), error: err.message }));

let workspaceId        = null;
let mainCueListId      = null;
let connected          = false;
let activeShowId       = null;
let lastKnownCueNumber = null;
let currentPlayhead    = { cueNumber: '', cueName: '' };
let playheadPollTimer  = null;

let _db = null;
let _broadcast = null;

// ── Logging ────────────────────────────────────────────────────────────────────
const ts     = () => new Date().toISOString();
const log    = (msg) => console.log(`[OSC]     ${ts()} ${msg}`);
const logOut = (msg) => console.log(`[OSC OUT] ${ts()} ${msg}`);
const logIn  = (msg) => console.log(`[OSC IN]  ${ts()} ${msg}`);
const logErr = (msg) => console.error(`[OSC ERR] ${ts()} ${msg}`);

// ── Helpers ────────────────────────────────────────────────────────────────────
function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
}

// Resolve the OSC workspace qualifier (configured name/UUID → discovered UUID → null for broadcast).
// QLab's OSC address accepts either the workspace's display name or its UUID interchangeably.
function workspaceQualifier() {
  const { qlabWorkspace } = loadConfig();
  return qlabWorkspace || workspaceId || null;
}

function cueAddress(trackId, command) {
  return OSC.cue(workspaceQualifier(), trackId, command);
}

// Waits for the next replyBus emission that satisfies matchFn(address, body).
// matchFn returns `undefined` to keep waiting, or any other value (including null/false) to resolve.
function waitForOscReply(matchFn, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;

    function onReply(address, args) {
      if (settled) return;
      let body;
      try { body = JSON.parse(args[0]); } catch { return; }
      const result = matchFn(address, body);
      if (result === undefined) return;
      settled = true;
      replyBus.off('reply', onReply);
      resolve(result);
    }

    replyBus.on('reply', onReply);
    setTimeout(() => {
      if (!settled) {
        settled = true;
        replyBus.off('reply', onReply);
        resolve(undefined);
      }
    }, timeoutMs);
  });
}

// ── Connection management ──────────────────────────────────────────────────────

async function discoverWorkspace() {
  if (workspaceId) return workspaceId;

  const found = waitForOscReply(
    (_addr, body) => extractWorkspaceId(body) || undefined,
    WORKSPACE_DISCOVER_MS
  );
  oscClient.send(OSC.workspaces());
  const id = await found;

  if (id) {
    workspaceId = id;
    log(`Workspace: ${workspaceId}`);
  }
  return id ?? null;
}

// All concurrent callers share one in-flight attempt — the receiver's denied
// handler and a send's ensureConnected() can otherwise race two /connect
// exchanges and cross-match each other's replies.
let connectPromise = null;
let lastConnectStatus = null;

function connectQLab() {
  return connectPromise ??= doConnect().finally(() => { connectPromise = null; });
}

async function doConnect() {
  if (connected) return 'ok';

  const { qlabPasscode } = loadConfig();
  const ws = workspaceQualifier() || await discoverWorkspace();
  if (!ws) return (lastConnectStatus = 'no_workspace');

  const addr = OSC.connect(ws);
  const replyPromise = waitForOscReply(
    (address, body) => address.includes('/connect') ? (body ?? {}) : undefined,
    CONNECT_TIMEOUT_MS
  );

  logOut(addr + (qlabPasscode ? ' (with passcode)' : ''));
  // A workspace without a passcode accepts a bare /connect — an empty
  // qlabPasscode in config is a supported setup, not a misconfiguration.
  if (qlabPasscode) oscClient.send(addr, qlabPasscode);
  else oscClient.send(addr);

  const reply = await replyPromise;
  // QLab reports a rejected/missing passcode ("badpass") or other rejections
  // ("error", seen in the wild — QLab's own docs don't enumerate every value)
  // inside data, while the envelope status is still "ok" — trusting status
  // alone would mark a session connected that QLab will deny every write on.
  // Surface data's actual value rather than collapsing every non-ok case into
  // "badpass": that string drives a specific "check your passcode" UI hint
  // (ConfirmScreen.svelte) that would be actively misleading for a rejection
  // that has nothing to do with the passcode.
  let status;
  if (!reply)                        status = 'timeout';
  else if (reply.status !== 'ok')    status = reply.status ?? 'unknown';
  else if (reply.data === undefined || String(reply.data).startsWith('ok')) status = 'ok';
  else                               status = String(reply.data);
  lastConnectStatus = status;

  if (status === 'ok') {
    connected = true;
    log('Connected to QLab workspace');
    subscribeToUpdates();
    resolveMainCueListId()
      .then(() => queryPlayhead())
      .catch(() => {});
    startPlayheadPoll();
  } else {
    logErr(`Connect failed: ${status}`);
  }

  return status;
}

function subscribeToUpdates() {
  const addr = OSC.updates();
  logOut(addr);
  oscClient.send(addr, 1);
}

// Polls QLab's playback position on an interval as a fallback for when the
// reactive /updates push doesn't fire (e.g. GO pressed directly in QLab).
function startPlayheadPoll() {
  if (playheadPollTimer) return;
  playheadPollTimer = setInterval(() => {
    if (connected) queryPlayhead().catch(() => {});
  }, PLAYHEAD_POLL_MS);
}

async function ensureConnected() {
  if (!workspaceQualifier()) await discoverWorkspace();
  if (!connected) await connectQLab();
}

// ── Playhead tracking ──────────────────────────────────────────────────────────

// Called when QLab sends a playbackPosition update with a cue_id.
// Queries the cue's number + name and caches the result.
async function updatePlayhead(cueId) {
  const ws = workspaceQualifier();
  if (!ws || !cueId) return;

  const numPromise  = waitForOscReply(
    (addr, body) => addr.includes(`/cue_id/${cueId}/number`) ? (body?.data ?? '') : undefined,
    PLAYHEAD_QUERY_MS
  );
  const namePromise = waitForOscReply(
    (addr, body) => addr.includes(`/cue_id/${cueId}/name`) ? (body?.data ?? '') : undefined,
    PLAYHEAD_QUERY_MS
  );

  oscClient.send(OSC.cueById(ws, cueId, 'number'));
  oscClient.send(OSC.cueById(ws, cueId, 'name'));

  const [rawNumber, rawName] = await Promise.all([numPromise, namePromise]);
  const cueNumber = (rawNumber == null || rawNumber === '-') ? '' : rawNumber;
  const cueName   = rawName ?? '';

  currentPlayhead = { cueNumber, cueName };
  if (cueNumber) lastKnownCueNumber = cueNumber;
}

function getPlayhead() {
  return currentPlayhead;
}

// The workspace can hold several cue lists and QLab reports playhead activity
// for all of them; the show only runs from the configured main list. Update
// pushes are keyed by the list's unique ID, so resolve it once per connection
// to let the receiver filter out the other lists.
async function resolveMainCueListId() {
  const { qlabMainCueList } = loadConfig();
  if (!qlabMainCueList) return;

  const idPromise = waitForOscReply(
    (addr, body) => addr.includes(`/cue/${qlabMainCueList}/uniqueID`) ? (body?.data ?? null) : undefined,
    PLAYHEAD_QUERY_MS
  );
  oscClient.send(cueAddress(qlabMainCueList, 'uniqueID'));
  const id = await idPromise;
  if (id) {
    mainCueListId = id;
    log(`Main cue list ID: ${id}`);
  }
}

// Pulls the main cue list's playback position directly, rather than waiting for
// the next reactive push — that push only fires on change, so if the playhead
// hasn't moved since we subscribed (e.g. right after connecting), nothing would
// otherwise populate currentPlayhead until the next go.
// Deliberately NOT the workspace-level /playbackPosition address: that answers
// for whichever cue list is currently active in QLab, so clicking around another
// list would hijack the showrunner's playhead display.
async function queryPlayhead() {
  const ws = workspaceQualifier();
  if (!ws) return;
  const { qlabMainCueList } = loadConfig();
  if (!qlabMainCueList) return;

  const idPromise = waitForOscReply(
    (addr, body) => addr.includes(`/cue/${qlabMainCueList}/playbackPositionID`) ? (body?.data ?? '') : undefined,
    PLAYHEAD_QUERY_MS
  );
  oscClient.send(cueAddress(qlabMainCueList, 'playbackPositionID'));
  const cueId = await idPromise;
  if (!cueId || cueId === 'none') return;

  await updatePlayhead(cueId);
}

function restorePlayhead(cueNumber) {
  if (!cueNumber) return;
  const ws = workspaceQualifier();
  if (!ws) return;
  const addr = OSC.playhead(ws, cueNumber);
  logOut(addr);
  try { oscClient.send(addr); } catch (err) {
    logErr(`restorePlayhead: ${err.message}`);
  }
}

async function reconnectQLab(cueNumber) {
  connected     = false;
  workspaceId   = null;
  mainCueListId = null;
  await discoverWorkspace();
  const status = await connectQLab();
  if (status === 'ok') {
    const target = cueNumber || lastKnownCueNumber;
    if (target) restorePlayhead(target);
  }
  return status;
}

// ── Public send API ────────────────────────────────────────────────────────────

function sendCastNotes(castMap) {
  for (const [track, actor] of Object.entries(castMap)) {
    const addr = cueAddress(track, 'notes');
    logOut(`${addr} "${actor}"`);
    try {
      oscClient.send(addr, actor);
    } catch (err) {
      logErr(`Failed to send ${addr}: ${err.message}`);
    }
  }
}

// Reads each track's notes back from QLab and compares against the actor we
// sent. Replies to set commands also arrive on /reply/.../notes but carry no
// data field — only GET replies do, so require body.data before comparing.
// Resolves with the track IDs that came back wrong or never answered.
function verifyCastInQLab(castMap) {
  const entries = Object.entries(castMap);
  if (entries.length === 0) return Promise.resolve([]);

  return new Promise((resolve) => {
    const pending    = new Map(entries);
    const mismatched = [];
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      replyBus.off('reply', onReply);
      clearTimeout(timer);
      resolve([...mismatched, ...pending.keys()]);
    }

    function onReply(address, args) {
      let body;
      try { body = JSON.parse(args[0]); } catch { return; }
      if (body?.status !== 'ok' || body.data === undefined) return;
      for (const [track, actor] of pending) {
        if (!address.includes(`/cue/${track}/notes`)) continue;
        pending.delete(track);
        if (String(body.data) !== String(actor)) mismatched.push(track);
        break;
      }
      if (pending.size === 0) finish();
    }

    replyBus.on('reply', onReply);
    const timer = setTimeout(finish, CAST_VERIFY_MS);

    try {
      for (const [track] of entries) oscClient.send(cueAddress(track, 'notes'));
    } catch (err) {
      logErr(`verifyCast send failed: ${err.message}`);
    }
  });
}

// Sends the cast, reads it back to confirm QLab applied it, and retries once
// over a fresh session. The CAST_CONFIRMED cue fires only after a clean
// verify — QLab-side scripts must never read half-written notes.
async function sendCastToQLab(castMap, { fireConfirm = true } = {}) {
  await ensureConnected();

  sendCastNotes(castMap);
  let mismatches = await verifyCastInQLab(castMap);

  if (mismatches.length > 0) {
    logErr(`Cast verify failed for: ${mismatches.join(', ')} — reconnecting and retrying`);
    // A stale/denied session fails every write the same way; a plain re-send
    // would too. Reconnect first so the retry runs on a fresh session.
    connected = false;
    await ensureConnected();
    const retryMap = Object.fromEntries(mismatches.map(track => [track, castMap[track]]));
    sendCastNotes(retryMap);
    mismatches = await verifyCastInQLab(retryMap);
  }

  const synced = mismatches.length === 0;
  if (synced) log('Cast verified in QLab');
  else logErr(`Cast still unverified for: ${mismatches.join(', ')}`);

  if (synced && fireConfirm) {
    const { castConfirmedCue } = loadConfig();
    const confirmAddr = cueAddress(castConfirmedCue, 'start');
    logOut(confirmAddr);
    try {
      oscClient.send(confirmAddr);
    } catch (err) {
      logErr(`Failed to send ${confirmAddr}: ${err.message}`);
      return { synced: false, mismatches, connectStatus: lastConnectStatus };
    }
  }

  return { synced, mismatches, connectStatus: connected ? 'ok' : lastConnectStatus };
}

// Writes the show's photo folder's absolute path into a memo cue's notes, so a
// QLab-side AppleScript (e.g. a Script cue at the finale) can read it to know
// where to find that performance's uploaded photos. No-op if photosPathCue isn't
// configured — this is opt-in per-production, not every workspace has the cue.
async function sendPhotosPathToQLab(show) {
  const { photosPathCue } = loadConfig();
  if (!photosPathCue) return true;

  await ensureConnected();
  const photosPath = path.join(getQlabPhotosDir(), photoFolderName(show));
  const addr = cueAddress(photosPathCue, 'notes');
  logOut(`${addr} "${photosPath}"`);
  try {
    oscClient.send(addr, photosPath);
    return true;
  } catch (err) {
    logErr(`Failed to send ${addr}: ${err.message}`);
    return false;
  }
}

// Sends act scene selections to QLab by writing comma-separated scene IDs into
// the notes of the act memo cues. Prefix "ORDERED:" signals the QLab randomiser
// to pop from the front instead of shuffling.
async function sendScenesToQLab(scenesMap, orderedMap = {}) {
  await ensureConnected();
  let allOk = true;

  for (const [actCueId, scenes] of Object.entries(scenesMap)) {
    const addr  = cueAddress(actCueId, 'notes');
    const csv   = Array.isArray(scenes) ? scenes.join(',') : String(scenes);
    const value = orderedMap[actCueId] ? `ORDERED:${csv}` : csv;
    logOut(`${addr} "${value}"`);
    try {
      oscClient.send(addr, value);
    } catch (err) {
      logErr(`Failed to send ${addr}: ${err.message}`);
      allOk = false;
    }
  }

  return allOk;
}

async function sendGo() {
  await ensureConnected();
  const { qlabMainCueList } = loadConfig();
  const ws   = workspaceQualifier();
  const addr = OSC.cue(ws, qlabMainCueList, 'go');

  // Confirmed live against QLab: a successful go gets NO reply at all (only the
  // resulting playbackPosition/scene_started pushes) — QLab only replies here to
  // report a problem ('denied' for a stale/unauthenticated session, 'error' for a
  // bad cue target). So a reply within the short window means failure; silence
  // means success. Replies that do come arrive in single-digit ms on loopback,
  // well under this timeout.
  const failurePromise = waitForOscReply(
    (address, body) => address.includes(`/cue/${qlabMainCueList}/go`) ? (body?.status ?? 'unknown') : undefined,
    GO_REPLY_TIMEOUT_MS
  );

  logOut(addr);
  oscClient.send(addr);

  const status = await failurePromise;
  if (status && status !== 'ok') {
    // Redundant if the receiver already caught this same denied/error reply below —
    // harmless either way.
    connected = false;
    logErr(`Go failed: ${status}`);
    throw new Error(`QLab rejected go: ${status}`);
  }
}

async function sendPanicAll() {
  await ensureConnected();
  const addr = OSC.panic(workspaceQualifier());

  // Same reply behavior as go, confirmed live: silence means success, a reply
  // means QLab is reporting a problem. Panic is the emergency stop — it must not
  // fail silently any more than go does.
  const failurePromise = waitForOscReply(
    (address, body) => address.includes('/panic') ? (body?.status ?? 'unknown') : undefined,
    PANIC_REPLY_TIMEOUT_MS
  );

  logOut(addr);
  oscClient.send(addr);

  const status = await failurePromise;
  if (status && status !== 'ok') {
    connected = false;
    logErr(`Panic failed: ${status}`);
    throw new Error(`QLab rejected panic: ${status}`);
  }
}

// Pings QLab and confirms each character track has a corresponding memo cue.
async function checkQLab(trackIds) {
  await ensureConnected();

  if (!connected) {
    return { reachable: false, missingVars: [] };
  }

  return new Promise((resolve) => {
    let reachable = false;
    let finished  = false;
    const found   = new Set();

    function finish() {
      if (finished) return;
      finished = true;
      replyBus.off('reply', onReply);
      // Stale/failed session — force fresh reconnect on next send
      if (!reachable) connected = false;
      resolve({
        reachable,
        missingVars: reachable ? trackIds.filter(id => !found.has(id)) : [...trackIds],
      });
    }

    function onReply(address, args) {
      if (!address.includes('/cue/')) {
        reachable = true;
        return;
      }
      let body;
      try { body = JSON.parse(args[0]); } catch (err) {
        logErr(`checkQLab reply parse: ${err.message}`);
        return;
      }
      if (body?.status === 'denied') {
        // Session not authenticated — re-send passcode on next command
        connected = false;
      } else {
        reachable = true;
        if (body?.status === 'ok') {
          for (const id of trackIds) {
            if (address.includes(`/cue/${id}/`)) found.add(id);
          }
        }
      }
    }

    replyBus.on('reply', onReply);

    try {
      for (const id of trackIds) oscClient.send(cueAddress(id, 'type'));
    } catch (err) {
      logErr(`checkQLab send failed: ${err.message}`);
    }

    setTimeout(finish, HEALTH_CHECK_MS);
  });
}

function setActiveShow(id) {
  activeShowId = id;
  log(`Active show set to ${id}`);
}

function endShow(showId) {
  if (showId == null || !_db) return;
  activeShowId = null;

  if (_broadcast) _broadcast('show_ended', { showId, time: new Date().toISOString() });

  try {
    const { appendShowToSheet } = require('../integrations/googleSheets');
    const show = _db.data.shows.find(s => s.id === showId);
    if (!show) return;
    show.ended_at = new Date().toISOString();
    show.photo_window_open      = false;
    show.photo_window_closed_at = show.ended_at;
    _db.write();

    const allSorted        = [..._db.data.shows].sort((a, b) => a.id - b.id);
    const performanceNumber = allSorted.findIndex(s => s.id === showId) + 1;
    const castAssignments   = _db.data.cast_assignments.filter(a => a.show_id === showId);
    const scenesPlayed      = _db.data.scene_log
      .filter(e => e.show_id === showId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const endTime = new Date(show.ended_at);
    scenesPlayed.forEach((entry, i) => {
      const next = scenesPlayed[i + 1];
      entry.duration_ms = (next ? new Date(next.timestamp) : endTime) - new Date(entry.timestamp);
    });
    _db.write();

    appendShowToSheet(show, performanceNumber, castAssignments, scenesPlayed)
      .then(result => {
        if (result && !result.success && _broadcast) _broadcast('sheets_error', null);
      })
      .catch(err => logErr(err.message));
  } catch (err) {
    logErr(err.message);
  }
}

// ── OSC traffic log (for the in-app OSC monitor) ────────────────────────────────
// A bounded ring buffer, not a growing array — this runs for an entire show,
// and the monitor only ever needs recent history plus whatever streams in
// live over SSE while it's open.
const OSC_LOG_MAX = 500;
const oscLog = [];

function recordOsc(direction, address, args, extra) {
  const entry = { time: ts(), direction, address, args, ...extra };
  oscLog.push(entry);
  if (oscLog.length > OSC_LOG_MAX) oscLog.shift();
  if (_broadcast) _broadcast('osc_log', entry);
}

function getOscLog() {
  return oscLog;
}

// ── OSC receiver ───────────────────────────────────────────────────────────────
// Wired to both oscClient's and cueReceiver's 'message' events (see the
// connection setup above) — replies arrive on the former, QLab's own pushed
// cues on the latter, but from here on they're handled identically.

function handleIncomingMessage(msg) {
  const [address, ...args] = msg;
  logIn(`${address} ${args.join(' ')}`);
  recordOsc('in', address, args);

  if (address.startsWith('/reply/')) {
    // Opportunistically grab workspace ID from any reply before we've discovered it
    if (!workspaceId) {
      try {
        const body = JSON.parse(args[0]);
        const found = extractWorkspaceId(body);
        if (found) {
          workspaceId = found;
          log(`Workspace: ${workspaceId}`);
        }
      } catch { /* not a JSON reply — ignore */ }
    }

    try {
      const body = JSON.parse(args[0]);
      // QLab also replies 'denied' for things like "no cue with that number" on
      // /cue/{id}/* queries — not just a stale session. Forcing a reconnect here
      // is harmless either way (idempotent), but don't read 'denied' as proof the
      // session itself was the problem.
      if (body?.status === 'denied') {
        connected     = false;
        workspaceId   = null;
        mainCueListId = null;
        log('Session denied by QLab — will reconnect on next send');
        reconnectQLab().catch(() => {});
      } else if (body?.status === 'error' && address.includes('/cue/')) {
        connected = false;
      }
    } catch { /* not a JSON reply — ignore */ }

    replyBus.emit('reply', address, args);
    return;
  }

  if (address.includes('/playbackPosition')) {
    // Pushes arrive per cue list (/update/.../cueList/{listId}/playbackPosition)
    // — ignore every list except the configured main one. If either ID is
    // still unknown, let the push through rather than showing no playhead.
    const pushListId = address.match(/\/cueList\/([^/]+)\//)?.[1];
    if (pushListId && mainCueListId && pushListId !== mainCueListId) return;
    const cueId = args[0];
    if (cueId) updatePlayhead(cueId);
    return;
  }

  if (address === '/show/scene_started') {
    const sceneName = args[0];
    if (!sceneName) return;
    try {
      const { nextId } = require('../db/database');
      _db.data.scene_log.push({
        id:         nextId(_db.data.scene_log),
        show_id:    activeShowId,
        scene_name: sceneName,
        position:   null,
        timestamp:  new Date().toISOString(),
      });
      _db.write();
    } catch (err) {
      logErr(`scene_log insert failed: ${err.message}`);
    }
    if (_broadcast) _broadcast('scene_started', { scene: sceneName, time: ts() });
    return;
  }

  if (address === '/show/end') {
    log(`Show end received for show ${activeShowId}`);
    endShow(activeShowId);
  }
}

function startReceiver(db, broadcast) {
  _db = db;
  _broadcast = broadcast;
  oscClient.connect();
  cueReceiver.start();
}

// Re-reads config.json and applies host/port changes to the live connections.
// Always drops the current session so the next send re-discovers/re-connects —
// this is also what makes a workspace-name/passcode-only change take effect.
function applyNetworkConfig() {
  const { host, port, cuePort } = resolveNetwork();
  connected     = false;
  workspaceId   = null;
  mainCueListId = null;
  oscClient.setTarget(host, port);
  cueReceiver.setPort(cuePort);
  log(`Network config applied: ${host}:${port} (cue port ${cuePort})`);
}

module.exports = {
  startReceiver,
  applyNetworkConfig,
  checkQLab,
  setActiveShow,
  endShow,
  getPlayhead,
  getOscLog,
  sendCastToQLab,
  sendScenesToQLab,
  sendPhotosPathToQLab,
  sendGo,
  sendPanicAll,
  reconnectQLab,
};
