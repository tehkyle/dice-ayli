const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { Client, Server } = require('node-osc');

const QLAB_HOST         = process.env.QLAB_HOST || '127.0.0.1';
const QLAB_SEND_PORT    = parseInt(process.env.QLAB_SEND_PORT, 10) || 53000;
const QLAB_RECEIVE_PORT = parseInt(process.env.QLAB_RECEIVE_PORT, 10) || 53001;

// All QLab replies arrive on our receive port (53001) and are forwarded here.
const replyBus = new EventEmitter();
replyBus.setMaxListeners(20);

// Single persistent UDP client — never closed, matches test-qlab.js behaviour.
// Creating+closing a new Client per send races with the async UDP write and drops packets.
const oscClient = new Client(QLAB_HOST, QLAB_SEND_PORT);

// Session state — reset if QLab restarts
let workspaceId   = null;
let connected     = false;
let activeShowId  = null; // set when a show is locked, cleared on /show/end

function timestamp() {
  return new Date().toISOString();
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
}

function extractWorkspaceId(body) {
  if (body?.workspace_id) return body.workspace_id;
  if (Array.isArray(body?.data) && body.data[0]?.workspace_id) return body.data[0].workspace_id;
  return null;
}

// Resolve the workspace qualifier to use in OSC addresses.
// Priority: configured UUID → configured name → discovered UUID → null (broadcast)
function workspaceQualifier() {
  const { qlabWorkspaceName, qlabWorkspaceId } = loadConfig();
  if (qlabWorkspaceId)   return qlabWorkspaceId;
  if (qlabWorkspaceName) return qlabWorkspaceName;
  if (workspaceId)       return workspaceId;
  return null;
}

function cueAddress(trackId, command) {
  const ws = workspaceQualifier();
  if (ws) return `/workspace/${ws}/cue/${trackId}/${command}`;
  return `/cue/${trackId}/${command}`; // broadcast — hits all open workspaces
}

// --- Connection management ---

function discoverWorkspace() {
  return new Promise((resolve) => {
    if (workspaceId) return resolve(workspaceId);

    let done = false;
    function onReply(_address, args) {
      if (done) return;
      try {
        const body = JSON.parse(args[0]);
        const found = extractWorkspaceId(body);
        if (found) {
          done = true;
          replyBus.off('reply', onReply);
          workspaceId = found;
          console.log(`[OSC] Workspace ID: ${workspaceId}`);
          resolve(workspaceId);
        }
      } catch (_) {}
    }

    replyBus.on('reply', onReply);
    oscClient.send('/workspaces');

    setTimeout(() => {
      if (!done) {
        replyBus.off('reply', onReply);
        resolve(null);
      }
    }, 2000);
  });
}

async function connectQLab() {
  if (connected) return 'ok';

  const { qlabPasscode } = loadConfig();
  const ws = workspaceQualifier() || await discoverWorkspace();
  if (!ws) return 'no_workspace';

  return new Promise((resolve) => {
    let done = false;

    function onReply(address, args) {
      if (done || !address.includes('/connect')) return;
      done = true;
      replyBus.off('reply', onReply);
      try {
        const body = JSON.parse(args[0]);
        const status = body?.status || 'unknown';
        if (status === 'ok') {
          connected = true;
          console.log(`[OSC] Connected to QLab workspace`);
        } else {
          console.error(`[OSC] QLab connect failed: ${status}`);
        }
        resolve(status);
      } catch { resolve('unknown'); }
    }

    replyBus.on('reply', onReply);

    const addr = `/workspace/${ws}/connect`;
    if (qlabPasscode) {
      console.log(`[OSC OUT] ${timestamp()} ${addr} (with passcode)`);
      oscClient.send(addr, qlabPasscode);
    } else {
      console.log(`[OSC OUT] ${timestamp()} ${addr}`);
      oscClient.send(addr);
    }

    setTimeout(() => {
      if (!done) {
        replyBus.off('reply', onReply);
        resolve('timeout');
      }
    }, 2000);
  });
}

async function ensureConnected() {
  if (!workspaceQualifier()) await discoverWorkspace();
  if (!connected) await connectQLab();
}

// --- Public API ---

/**
 * Send cast assignments to QLab by writing actor names into memo cue notes,
 * then fire the CAST_CONFIRMED cue.
 * @param {Object} castMap - { trackId: "Actor Name", ... }
 * @returns {Promise<boolean>} true if all sends completed without error
 */
async function sendCastToQLab(castMap) {
  await ensureConnected();

  let allOk = true;

  for (const [track, actor] of Object.entries(castMap)) {
    const address = cueAddress(track, 'notes');
    console.log(`[OSC OUT] ${timestamp()} ${address} "${actor}"`);
    try {
      oscClient.send(address, actor);
    } catch (err) {
      console.error(`[OSC ERR] ${timestamp()} Failed to send ${address}: ${err.message}`);
      allOk = false;
    }
  }

  const confirmAddress = cueAddress('CAST_CONFIRMED', 'start');
  console.log(`[OSC OUT] ${timestamp()} ${confirmAddress}`);
  try {
    oscClient.send(confirmAddress);
  } catch (err) {
    console.error(`[OSC ERR] ${timestamp()} Failed to send ${confirmAddress}: ${err.message}`);
    allOk = false;
  }

  return allOk;
}

/**
 * Send act scene selections to QLab by writing comma-separated scene IDs
 * into the notes of the corresponding memo cues (A2_SCENES, A3_SCENES, A4_SCENES).
 * When orderedMap[actCueId] is true, the value is prefixed with "ORDERED:" so the
 * AppleScript randomiser pops from the front instead of randomising.
 * @param {Object} scenesMap   - { actCueId: ["sceneId", ...], ... }
 * @param {Object} orderedMap  - { actCueId: true, ... } (optional)
 * @returns {Promise<boolean>}
 */
async function sendScenesToQLab(scenesMap, orderedMap = {}) {
  await ensureConnected();

  let allOk = true;

  for (const [actCueId, scenes] of Object.entries(scenesMap)) {
    const address = cueAddress(actCueId, 'notes');
    const csv = Array.isArray(scenes) ? scenes.join(',') : String(scenes);
    const value = orderedMap[actCueId] ? `ORDERED:${csv}` : csv;
    console.log(`[OSC OUT] ${timestamp()} ${address} "${value}"`);
    try {
      oscClient.send(address, value);
    } catch (err) {
      console.error(`[OSC ERR] ${timestamp()} Failed to send ${address}: ${err.message}`);
      allOk = false;
    }
  }

  return allOk;
}

/**
 * Ping QLab and confirm each track has a corresponding memo cue.
 * @param {string[]} trackIds
 * @returns {Promise<{ reachable: boolean, missingVars: string[] }>}
 */
async function checkQLab(trackIds) {
  const TIMEOUT = 3000;

  await ensureConnected();

  return new Promise((resolve) => {
    let reachable = false; // only true when QLab actually replies — not just "we think we're connected"
    let finished  = false;
    const found   = new Set();

    function finish() {
      if (finished) return;
      finished = true;
      replyBus.off('reply', onReply);
      if (!reachable) connected = false; // stale/failed session — force fresh reconnect next time
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
      try {
        const body = JSON.parse(args[0]);
        if (body?.status === 'denied') {
          // Session not authenticated — reset so ensureConnected() re-sends the passcode next time
          connected = false;
        } else {
          reachable = true;
          if (body?.status === 'ok') {
            for (const id of trackIds) {
              if (address.includes(`/cue/${id}/`)) found.add(id);
            }
          }
        }
      } catch (_) {}
    }

    replyBus.on('reply', onReply);

    try {
      for (const id of trackIds) {
        oscClient.send(cueAddress(id, 'type'));
      }
    } catch (err) {
      console.error(`[OSC ERR] checkQLab send failed: ${err.message}`);
    }

    setTimeout(finish, TIMEOUT);
  });
}

/**
 * Set the active show ID so that incoming scene_picked events are associated
 * with the correct show. Called by routes/shows.js after a show is locked.
 * @param {number|null} id
 */
function setActiveShow(id) {
  activeShowId = id;
  console.log(`[OSC] Active show set to ${id}`);
}

/**
 * Start the OSC UDP receiver. Routes /reply/... to replyBus,
 * auto-discovers workspace ID, and handles incoming scene events.
 */
function startReceiver(db, io) {
  const server = new Server(QLAB_RECEIVE_PORT, '0.0.0.0');

  server.on('message', (msg) => {
    const [address, ...args] = msg;
    console.log(`[OSC IN]  ${timestamp()} ${address} ${args.join(' ')}`);

    if (address.startsWith('/reply/')) {
      if (!workspaceId) {
        try {
          const body = JSON.parse(args[0]);
          const found = extractWorkspaceId(body);
          if (found) {
            workspaceId = found;
            console.log(`[OSC] Workspace ID: ${workspaceId}`);
          }
        } catch (_) {}
      }
      // If QLab sends 'error' on a cue command, our session may have dropped
      try {
        const body = JSON.parse(args[0]);
        if (body?.status === 'error' && address.includes('/cue/')) {
          connected = false;
        }
      } catch (_) {}

      replyBus.emit('reply', address, args);
      return;
    }

    if (address === '/show/scene_started') {
      const sceneName = args[0];
      if (!sceneName) return;
      try {
        const { nextId } = require('../db/database');
        db.data.scene_log.push({
          id: nextId(db.data.scene_log),
          show_id: activeShowId,
          scene_name: sceneName,
          position: null,
          timestamp: new Date().toISOString(),
        });
        db.write();
      } catch (err) {
        console.error(`[OSC ERR] ${timestamp()} scene_log insert failed: ${err.message}`);
      }
      if (io) io.emit('scene_started', { scene: sceneName, time: timestamp() });
      return;
    }

    if (address === '/show/end') {
      const showId = activeShowId;
      activeShowId = null;
      console.log(`[OSC] Show end received for show ${showId}`);
      if (io) io.emit('show_ended', { showId, time: timestamp() });

      if (showId == null) return;

      try {
        const { appendShowToSheet } = require('../integrations/googleSheets');
        const show = db.data.shows.find(s => s.id === showId);
        if (!show) return;
        show.ended_at = new Date().toISOString();
        db.write();
        const performanceNumber = [...db.data.shows]
          .sort((a, b) => a.id - b.id)
          .findIndex(s => s.id === showId) + 1;
        const castAssignments = db.data.cast_assignments.filter(a => a.show_id === showId);
        const scenesPlayed = db.data.scene_log
          .filter(e => e.show_id === showId)
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // Compute and persist duration_ms for each scene now that all timestamps are known
        const endTime = new Date(show.ended_at);
        scenesPlayed.forEach((entry, i) => {
          const next = scenesPlayed[i + 1];
          entry.duration_ms = (next ? new Date(next.timestamp) : endTime) - new Date(entry.timestamp);
        });
        db.write();

        appendShowToSheet(show, performanceNumber, castAssignments, scenesPlayed)
          .then(result => {
            if (result && !result.success && io) {
              io.emit('sheets_error');
            }
          })
          .catch(err => {
            console.error(`[Sheets ERR] ${timestamp()} ${err.message}`);
          });
      } catch (err) {
        console.error(`[Sheets ERR] ${timestamp()} ${err.message}`);
      }
    }
  });

  server.on('error', (err) => {
    console.error(`[OSC ERR] ${timestamp()} Receiver error: ${err.message}`);
  });

  console.log(`[OSC] Receiver listening on UDP port ${QLAB_RECEIVE_PORT}`);
  return server;
}

async function sendGo() {
  await ensureConnected();
  const ws = workspaceQualifier();
  const addr = ws ? `/workspace/${ws}/go` : '/go';
  console.log(`[OSC OUT] ${timestamp()} ${addr}`);
  oscClient.send(addr);
}

module.exports = { sendCastToQLab, sendScenesToQLab, startReceiver, checkQLab, setActiveShow, sendGo };
