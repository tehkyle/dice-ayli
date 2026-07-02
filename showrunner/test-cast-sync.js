// Self-check for the verified cast send in osc/qlabBridge.js, run against a
// fake in-process QLab. Usage: node test-cast-sync.js
//
// Covers:
//  1. happy path — send, read-back verify, synced:true
//  2. dropped packet — fake QLab ignores the first notes write for one track;
//     the bridge must detect the mismatch, reconnect, retry, and end synced:true
//  3. hard mismatch — fake QLab refuses all writes for one track → synced:false
//     with that track reported, and the confirm cue must NOT fire
const assert = require('assert');
const path = require('path');
const { Client, Server } = require('node-osc');

// Alternate ports so real QLab and a running app instance stay untouched.
// config.json leaves ports empty, so the bridge falls through to these env vars.
const SEND_PORT = 63000, RECV_PORT = 63001;
process.env.QLAB_HOST         = '127.0.0.1';
process.env.QLAB_SEND_PORT    = String(SEND_PORT);
process.env.QLAB_RECEIVE_PORT = String(RECV_PORT);

// ── Fake QLab ──────────────────────────────────────────────────────────────────
const notes = {};            // cueId → notes value
const refuseWrites = new Set(); // cueIds whose set-commands are ignored
let dropNextWrite = new Set();  // cueIds whose NEXT set-command is ignored
let confirmFired = 0;
let connects = 0;

const reply = new Client('127.0.0.1', RECV_PORT);
const fake = new Server(SEND_PORT, '0.0.0.0');
fake.on('message', ([address, ...args]) => {
  const send = (body) => reply.send(`/reply${address}`, JSON.stringify(body));
  let m;
  if (address.endsWith('/connect')) {
    connects++;
    send({ status: 'ok', data: 'ok:view|edit|control' });
  } else if (address === '/updates') {
    // no reply needed
  } else if (address.endsWith('/cue/MAIN/uniqueID')) {
    send({ status: 'ok', data: 'LIST-MAIN-ID' });
  } else if (address.endsWith('/cue/MAIN/playbackPositionId')) {
    send({ status: 'ok', data: 'CUE-42' });
  } else if ((m = address.match(/\/cue_id\/CUE-(\d+)\/number$/))) {
    send({ status: 'ok', data: m[1] });
  } else if (address.match(/\/cue_id\/[^/]+\/name$/)) {
    send({ status: 'ok', data: 'Test Cue' });
  } else if ((m = address.match(/\/cue\/([^/]+)\/notes$/))) {
    const id = m[1];
    if (args.length > 0) { // set
      if (dropNextWrite.has(id)) { dropNextWrite.delete(id); return; } // silent drop
      if (refuseWrites.has(id)) return;
      notes[id] = args[0];
      send({ status: 'ok' }); // set echo: no data field
    } else { // GET
      send({ status: 'ok', data: notes[id] ?? '' });
    }
  } else if (address.includes('/CAST_CONFIRMED/start')) {
    confirmFired++;
    send({ status: 'ok' });
  } else if ((m = address.match(/\/cue\/([^/]+)\/name$/))) {
    send({ status: 'ok', data: 'cue' });
  }
});

// ── Tests ──────────────────────────────────────────────────────────────────────
(async () => {
  const bridge = require(path.join(__dirname, 'osc/qlabBridge.js'));
  bridge.startReceiver({ data: { shows: [], scene_log: [], cast_assignments: [] }, write() {} }, null);

  // 1. happy path, no confirm cue
  let r = await bridge.sendCastToQLab({ Track_1: 'Alice', Track_2: 'Bob' }, { fireConfirm: false });
  assert.deepStrictEqual(r, { synced: true, mismatches: [], connectStatus: 'ok' }, `happy: ${JSON.stringify(r)}`);
  assert.strictEqual(notes.Track_1, 'Alice');
  assert.strictEqual(confirmFired, 0, 'confirm must not fire with fireConfirm:false');
  console.log('ok 1 happy path, confirm suppressed');

  // 2. dropped packet → detected by verify, recovered by retry
  dropNextWrite = new Set(['Track_2']);
  const connectsBefore = connects;
  r = await bridge.sendCastToQLab({ Track_1: 'Carol', Track_2: 'Dave' }, { fireConfirm: true });
  assert.strictEqual(r.synced, true, `retry should recover: ${JSON.stringify(r)}`);
  assert.strictEqual(notes.Track_2, 'Dave');
  assert.ok(connects > connectsBefore, 'retry should reconnect first');
  await new Promise(r => setTimeout(r, 200)); // confirm send is fire-and-forget UDP
  assert.strictEqual(confirmFired, 1, 'confirm fires after clean verify');
  console.log('ok 2 dropped packet recovered via reconnect+retry, confirm fired');

  // 3. hard failure on one track → synced:false, names it, confirm NOT fired
  refuseWrites.add('Track_1');
  r = await bridge.sendCastToQLab({ Track_1: 'Eve', Track_2: 'Frank' }, { fireConfirm: true });
  assert.strictEqual(r.synced, false);
  assert.deepStrictEqual(r.mismatches, ['Track_1'], `mismatches: ${JSON.stringify(r.mismatches)}`);
  assert.strictEqual(confirmFired, 1, 'confirm must not fire on failed verify');
  assert.strictEqual(notes.Track_2, 'Frank', 'healthy track still updated');
  console.log('ok 3 hard mismatch reported, confirm suppressed');

  // 4. playhead is scoped to the main cue list
  await new Promise(res => setTimeout(res, 300)); // let connect-time playhead query land
  assert.deepStrictEqual(bridge.getPlayhead(), { cueNumber: '42', cueName: 'Test Cue' });
  // a push from some other cue list must be ignored…
  reply.send('/update/workspace/test/cueList/OTHER-LIST/playbackPosition', 'CUE-99');
  await new Promise(res => setTimeout(res, 300));
  assert.strictEqual(bridge.getPlayhead().cueNumber, '42', 'other-list push must not move playhead');
  // …while a push from the main list updates it
  reply.send('/update/workspace/test/cueList/LIST-MAIN-ID/playbackPosition', 'CUE-99');
  await new Promise(res => setTimeout(res, 300));
  assert.strictEqual(bridge.getPlayhead().cueNumber, '99', 'main-list push should move playhead');
  console.log('ok 4 playhead scoped to main cue list');

  console.log('PASS');
  process.exit(0);
})().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
