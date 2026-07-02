// In-process stand-in for QLab's OSC interface, listening on alternate ports so
// real QLab and a running app instance stay untouched. config.json leaves the
// ports empty, so pointing the bridge here is just setting the env vars below
// BEFORE requiring osc/qlabBridge.js.
//
// It implements only what the bridge speaks: /connect, notes get/set, the
// confirm-cue start, and the main-cue-list playhead queries. Reply shapes match
// live QLab 5 behavior, including the quirks the bridge works around (set
// echoes carry no data field; a bad passcode is status:"ok" + data:"badpass").
const path = require('path');
const { Client, Server } = require('node-osc');

const SEND_PORT = 63000;
const RECV_PORT = 63001;
const MAIN_LIST_ID = 'LIST-MAIN-ID';

const config = require(path.join(__dirname, '../config.json'));

process.env.QLAB_HOST         = '127.0.0.1';
process.env.QLAB_SEND_PORT    = String(SEND_PORT);
process.env.QLAB_RECEIVE_PORT = String(RECV_PORT);

function startFakeQlab() {
  const reply  = new Client('127.0.0.1', RECV_PORT);
  const server = new Server(SEND_PORT, '0.0.0.0');

  const fake = {
    notes: {},                 // cueId → notes value
    refuseWrites: new Set(),   // cueIds whose set-commands are always ignored
    dropNextWrite: new Set(),  // cueIds whose NEXT set-command is ignored (lost packet)
    connectMode: 'ok',         // 'ok' | 'badpass' — badpass also mutes cue replies (unauthenticated)
    playbackPositionId: 'CUE-42',
    confirmFired: 0,
    connects: 0,

    // Simulate QLab's reactive playhead push for a given cue list. Only the
    // main list's move changes what the poll query answers — exactly like QLab,
    // where each cue list keeps its own playback position.
    pushPlayhead(listId, cueId) {
      if (listId === MAIN_LIST_ID) fake.playbackPositionId = cueId;
      reply.send(`/update/workspace/test/cueList/${listId}/playbackPosition`, cueId);
    },

    close() {
      try { reply.close(); } catch {}
      try { server.close(); } catch {}
    },
  };

  server.on('message', ([address, ...args]) => {
    const send = (body) => reply.send(`/reply${address}`, JSON.stringify(body));
    let m;

    if (address.endsWith('/connect')) {
      fake.connects++;
      if (fake.connectMode === 'badpass') send({ status: 'ok', data: 'badpass' });
      else send({ status: 'ok', data: 'ok:view|edit|control' });
      return;
    }
    if (address === '/updates') return; // subscription — no reply
    if (fake.connectMode !== 'ok') return; // unauthenticated: mute all cue replies

    if (address.endsWith(`/cue/${config.qlabMainCueList}/uniqueID`)) {
      send({ status: 'ok', data: MAIN_LIST_ID });
    } else if (address.endsWith(`/cue/${config.qlabMainCueList}/playbackPositionId`)) {
      send({ status: 'ok', data: fake.playbackPositionId });
    } else if ((m = address.match(/\/cue_id\/CUE-(\d+)\/number$/))) {
      send({ status: 'ok', data: m[1] });
    } else if (address.match(/\/cue_id\/[^/]+\/name$/)) {
      send({ status: 'ok', data: 'Test Cue' });
    } else if ((m = address.match(/\/cue\/([^/]+)\/notes$/))) {
      const id = m[1];
      if (args.length > 0) { // set
        if (fake.dropNextWrite.delete(id)) return; // silent drop, once
        if (fake.refuseWrites.has(id)) return;
        fake.notes[id] = args[0];
        send({ status: 'ok' }); // set echo: no data field
      } else { // GET
        send({ status: 'ok', data: fake.notes[id] ?? '' });
      }
    } else if (address.endsWith(`/cue/${config.castConfirmedCue}/start`)) {
      fake.confirmFired++;
      send({ status: 'ok' });
    }
  });

  return fake;
}

module.exports = { startFakeQlab, SEND_PORT, RECV_PORT, MAIN_LIST_ID };
