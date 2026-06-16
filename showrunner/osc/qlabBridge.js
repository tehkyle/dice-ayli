const fs   = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { Client, Server } = require('node-osc');
const { extractWorkspaceId } = require('../utils');

// ── Network config (override via .env) ────────────────────────────────────────
const QLAB_HOST         = process.env.QLAB_HOST || '127.0.0.1';
const QLAB_SEND_PORT    = parseInt(process.env.QLAB_SEND_PORT,  10) || 53000;
const QLAB_RECEIVE_PORT = parseInt(process.env.QLAB_RECEIVE_PORT, 10) || 53001;

// ── Timing constants ───────────────────────────────────────────────────────────
const WORKSPACE_DISCOVER_MS = 2000;
const CONNECT_TIMEOUT_MS    = 2000;
const HEALTH_CHECK_MS       = 3000;
const PLAYHEAD_QUERY_MS     = 500;

// ── QLab OSC address builders ──────────────────────────────────────────────────
// These are the complete set of OSC paths this module writes to or reads from.
const OSC = {
  workspaces: ()                   => '/workspaces',
  connect:    (ws)                 => `/workspace/${ws}/connect`,
  updates:    (ws)                 => `/workspace/${ws}/updates`,
  cue:        (ws, id, cmd)        => ws ? `/workspace/${ws}/cue/${id}/${cmd}` : `/cue/${id}/${cmd}`,
  cueById:    (ws, id, prop)       => `/workspace/${ws}/cue_id/${id}/${prop}`,
  panic:      (ws)                 => ws ? `/workspace/${ws}/panic` : '/panic',
  playhead:   (ws, cue)            => `/workspace/${ws}/playhead/${cue}`,
};

// ── Internal state ─────────────────────────────────────────────────────────────
const replyBus = new EventEmitter();
replyBus.setMaxListeners(20);

// Single persistent UDP client — never closed between sends.
// Creating+closing per-send races the async UDP write and drops packets.
const oscClient = new Client(QLAB_HOST, QLAB_SEND_PORT);

let workspaceId        = null;
let connected          = false;
let activeShowId       = null;
let lastKnownCueNumber = null;
let currentPlayhead    = { cueNumber: '', cueName: '' };

let _db = null;
let _io = null;

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

// Resolve the OSC workspace qualifier (UUID → name → discovered UUID → null for broadcast).
function workspaceQualifier() {
  const { qlabWorkspaceId, qlabWorkspaceName } = loadConfig();
  return qlabWorkspaceId || qlabWorkspaceName || workspaceId || null;
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

async function connectQLab() {
  if (connected) return 'ok';

  const { qlabPasscode } = loadConfig();
  const ws = workspaceQualifier() || await discoverWorkspace();
  if (!ws) return 'no_workspace';

  const addr = OSC.connect(ws);
  const statusPromise = waitForOscReply(
    (address, body) => address.includes('/connect') ? (body?.status ?? 'unknown') : undefined,
    CONNECT_TIMEOUT_MS
  );

  logOut(addr + (qlabPasscode ? ' (with passcode)' : ''));
  if (qlabPasscode) oscClient.send(addr, qlabPasscode);
  else oscClient.send(addr);

  const status = (await statusPromise) ?? 'timeout';

  if (status === 'ok') {
    connected = true;
    log('Connected to QLab workspace');
    subscribeToUpdates(ws);
  } else {
    logErr(`Connect failed: ${status}`);
  }

  return status;
}

function subscribeToUpdates(ws) {
  const addr = OSC.updates(ws);
  logOut(addr);
  oscClient.send(addr, 1);
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
  connected   = false;
  workspaceId = null;
  await discoverWorkspace();
  const status = await connectQLab();
  if (status === 'ok') {
    const target = cueNumber || lastKnownCueNumber;
    if (target) restorePlayhead(target);
  }
  return status;
}

// ── Public send API ────────────────────────────────────────────────────────────

async function sendCastToQLab(castMap) {
  await ensureConnected();
  const { castConfirmedCue } = loadConfig();
  let allOk = true;

  for (const [track, actor] of Object.entries(castMap)) {
    const addr = cueAddress(track, 'notes');
    logOut(`${addr} "${actor}"`);
    try {
      oscClient.send(addr, actor);
    } catch (err) {
      logErr(`Failed to send ${addr}: ${err.message}`);
      allOk = false;
    }
  }

  const confirmAddr = cueAddress(castConfirmedCue, 'start');
  logOut(confirmAddr);
  try {
    oscClient.send(confirmAddr);
  } catch (err) {
    logErr(`Failed to send ${confirmAddr}: ${err.message}`);
    allOk = false;
  }

  return allOk;
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
  logOut(addr);
  oscClient.send(addr);
}

async function sendPanicAll() {
  await ensureConnected();
  const addr = OSC.panic(workspaceQualifier());
  logOut(addr);
  try { oscClient.send(addr); } catch (err) {
    logErr(`sendPanicAll: ${err.message}`);
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

  if (_io) _io.emit('show_ended', { showId, time: new Date().toISOString() });

  try {
    const { appendShowToSheet } = require('../integrations/googleSheets');
    const show = _db.data.shows.find(s => s.id === showId);
    if (!show) return;
    show.ended_at = new Date().toISOString();
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
        if (result && !result.success && _io) _io.emit('sheets_error');
      })
      .catch(err => logErr(err.message));
  } catch (err) {
    logErr(err.message);
  }
}

// ── OSC receiver ───────────────────────────────────────────────────────────────

function startReceiver(db, io) {
  _db = db;
  _io = io;
  const server = new Server(QLAB_RECEIVE_PORT, '0.0.0.0');

  server.on('message', (msg) => {
    const [address, ...args] = msg;
    logIn(`${address} ${args.join(' ')}`);

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
        if (body?.status === 'denied') {
          connected   = false;
          workspaceId = null;
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
      const cueId = args[0];
      if (cueId) updatePlayhead(cueId);
      return;
    }

    if (address === '/show/scene_started') {
      const sceneName = args[0];
      if (!sceneName) return;
      try {
        const { nextId } = require('../db/database');
        db.data.scene_log.push({
          id:         nextId(db.data.scene_log),
          show_id:    activeShowId,
          scene_name: sceneName,
          position:   null,
          timestamp:  new Date().toISOString(),
        });
        db.write();
      } catch (err) {
        logErr(`scene_log insert failed: ${err.message}`);
      }
      if (io) io.emit('scene_started', { scene: sceneName, time: ts() });
      return;
    }

    if (address === '/show/end') {
      log(`Show end received for show ${activeShowId}`);
      endShow(activeShowId);
    }
  });

  server.on('error', (err) => logErr(`Receiver: ${err.message}`));

  log(`Receiver listening on UDP port ${QLAB_RECEIVE_PORT}`);
  return server;
}

module.exports = {
  startReceiver,
  checkQLab,
  setActiveShow,
  endShow,
  getPlayhead,
  sendCastToQLab,
  sendScenesToQLab,
  sendGo,
  sendPanicAll,
  reconnectQLab,
};
