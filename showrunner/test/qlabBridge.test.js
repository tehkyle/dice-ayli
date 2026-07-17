// Behavior tests for osc/qlabBridge.js against the in-process fake QLab.
// Run: npm test   (or: node --test test/)
//
// The bridge is a stateful singleton (session flag, cached IDs, poll timers),
// so these tests share one bridge instance and run in file order — each test
// documents what state it assumes. Order matters: the badpass test must run
// before anything connects successfully.
const { test, after } = require('node:test');
const assert = require('node:assert');
const { startFakeQlab, MAIN_LIST_ID, RECV_PORT } = require('./fakeQlab'); // sets QLAB_* env — must precede the bridge require

const fake   = startFakeQlab();
const bridge = require('../osc/qlabBridge.js');
bridge.startReceiver({ data: { shows: [], scene_log: [], cast_assignments: [] }, write() {} }, null);

const settle = (ms = 300) => new Promise(res => setTimeout(res, ms));

test('bad passcode is surfaced as badpass, never a fake connection', async () => {
  fake.connectMode = 'badpass';
  const r = await bridge.sendCastToQLab({ Track_1: 'Alice' }, { fireConfirm: false });
  assert.strictEqual(r.synced, false);
  assert.strictEqual(r.connectStatus, 'badpass');
  assert.deepStrictEqual(r.mismatches, ['Track_1']);
  fake.connectMode = 'ok';
});

test('happy path: send, read-back verify, no confirm cue when fireConfirm:false', async () => {
  const r = await bridge.sendCastToQLab({ Track_1: 'Alice', Track_2: 'Bob' }, { fireConfirm: false });
  assert.deepStrictEqual(r, { synced: true, mismatches: [], connectStatus: 'ok' });
  assert.strictEqual(fake.notes.Track_1, 'Alice');
  assert.strictEqual(fake.confirmFired, 0);
  assert.strictEqual(fake.udpReplyPort, RECV_PORT, 'bridge must tell QLab our configured receive port on connect');
});

test('dropped packet: verify detects it, reconnect+retry recovers, confirm fires', async () => {
  fake.dropNextWrite.add('Track_2');
  const connectsBefore = fake.connects;

  const r = await bridge.sendCastToQLab({ Track_1: 'Carol', Track_2: 'Dave' }, { fireConfirm: true });

  assert.strictEqual(r.synced, true, JSON.stringify(r));
  assert.strictEqual(fake.notes.Track_2, 'Dave');
  assert.ok(fake.connects > connectsBefore, 'retry should reconnect first');
  await settle(); // confirm-cue send is fire-and-forget UDP
  assert.strictEqual(fake.confirmFired, 1, 'confirm fires after clean verify');
});

test('hard mismatch: named in result, confirm cue suppressed, healthy tracks still land', async () => {
  fake.refuseWrites.add('Track_1');

  const r = await bridge.sendCastToQLab({ Track_1: 'Eve', Track_2: 'Frank' }, { fireConfirm: true });

  assert.strictEqual(r.synced, false);
  assert.deepStrictEqual(r.mismatches, ['Track_1']);
  assert.strictEqual(fake.notes.Track_2, 'Frank');
  await settle();
  assert.strictEqual(fake.confirmFired, 1, 'confirm must not fire on failed verify');
  fake.refuseWrites.clear();
});

test('playhead tracks only the main cue list', async () => {
  await settle(); // let the connect-time playbackPositionId query land
  assert.deepStrictEqual(bridge.getPlayhead(), { cueNumber: '42', cueName: 'Test Cue' });

  // a push from some other cue list must be ignored (fake keeps answering the
  // 2s poll with the same cue, so the poll can't mask a filtering bug here)
  fake.pushPlayhead('OTHER-LIST', 'CUE-7');
  await settle();
  assert.strictEqual(bridge.getPlayhead().cueNumber, '42', 'other-list push must not move playhead');

  fake.pushPlayhead(MAIN_LIST_ID, 'CUE-99');
  await settle();
  assert.strictEqual(bridge.getPlayhead().cueNumber, '99', 'main-list push should move playhead');
});

// The bridge has no shutdown API (the server never stops it) — its poll timer
// and sockets would hang this child process forever, so exit explicitly.
// Failures still fail the run: the runner parses results before the exit.
after(() => {
  fake.close();
  setImmediate(() => process.exit(process.exitCode ?? 0));
});
