// In-process stand-in for QLab's OSC-over-TCP interface, listening on an
// alternate port so real QLab and a running app instance stay untouched.
// config.json leaves qlabSendPort empty, so pointing the bridge here is just
// setting the env var below BEFORE requiring osc/qlabBridge.js.
//
// It implements only what the bridge speaks: /connect, notes get/set, the
// confirm-cue start, and the main-cue-list playhead queries. Reply shapes match
// live QLab 5 behavior, including the quirks the bridge works around (set
// echoes carry no data field; a bad passcode is status:"ok" + data:"badpass").
const path = require('path');
const net  = require('net');
const { toBuffer, fromBuffer } = require('osc-min');
const { Message } = require('node-osc');
const { encode: slipEncode, SlipDecoder } = require('../osc/slip');

const PORT = 63000;
// A separate port because it's a separate socket in the real bridge too: QLab
// dials in to push Network Cue events (/show/scene_started, etc.) rather
// than reusing the connection the bridge dials out on for commands/replies.
// This fake plays the QLab role for both — for the cue push, that means
// dialing OUT to the bridge's listener, same SLIP+OSC framing as the main
// connection.
const CUE_PORT = 63002;
const MAIN_LIST_ID = 'LIST-MAIN-ID';

const config = require(path.join(__dirname, '../config.json'));

process.env.QLAB_HOST = '127.0.0.1';
process.env.QLAB_PORT = String(PORT);
process.env.QLAB_CUE_PORT = String(CUE_PORT);

function startFakeQlab() {
  const sockets = new Set();

  function writeMessage(sock, address, args) {
    const message = new Message(address);
    for (const arg of args) message.append(arg);
    sock.write(slipEncode(toBuffer(message)));
  }

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
      for (const sock of sockets) {
        writeMessage(sock, `/update/workspace/test/cueList/${listId}/playbackPosition`, [cueId]);
      }
    },

    // Simulates a QLab Network Cue firing — a fresh outbound TCP connection
    // to the bridge's cue-port listener, same as real QLab dialing in.
    pushToApp(address, ...args) {
      const client = net.createConnection({ host: '127.0.0.1', port: CUE_PORT }, () => {
        writeMessage(client, address, args);
        client.end();
      });
    },

    close() {
      for (const sock of sockets) sock.destroy();
      server.close();
    },
  };

  function handleMessage(sock, address, args) {
    const send = (body) => writeMessage(sock, `/reply${address}`, [JSON.stringify(body)]);
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
    } else if (address.endsWith(`/cue/${config.qlabMainCueList}/playbackPositionID`)) {
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
  }

  const server = net.createServer((sock) => {
    sockets.add(sock);
    const decoder = new SlipDecoder();

    sock.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        let decoded;
        try { decoded = fromBuffer(frame); } catch { continue; } // malformed frame — ignore
        if (decoded.oscType !== 'message') continue;
        handleMessage(sock, decoded.address, decoded.args.map(a => a.value));
      }
    });
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
  });

  server.listen(PORT, '127.0.0.1');

  return fake;
}

module.exports = { startFakeQlab, PORT, CUE_PORT, MAIN_LIST_ID };
