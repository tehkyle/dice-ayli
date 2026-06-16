#!/usr/bin/env node
/**
 * QLab memo cue round-trip test.
 *
 * Usage:
 *   node test-qlab.js [cueNumber] [passcode]
 *
 * Defaults:
 *   cueNumber = Track_1
 *   passcode  = (none)
 *
 * Before running:
 *   1. Stop the main Dacha DICE: AYLI server (port 53001 must be free).
 *   2. Ensure a Memo cue exists in QLab with cue NUMBER set to [cueNumber].
 */

const path = require('path');
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const { Client, Server } = require('node-osc');
const { extractWorkspaceId } = require('./utils');

const QLAB_HOST      = process.env.QLAB_HOST || '127.0.0.1';
const QLAB_SEND_PORT = parseInt(process.env.QLAB_SEND_PORT, 10) || 53000;
const RECEIVE_PORT   = parseInt(process.env.QLAB_RECEIVE_PORT, 10) || 53001;
const CUE_NUMBER      = process.argv[2] || 'Track_1';
const PASSCODE        = process.argv[3] || '';
const WORKSPACE_NAME  = process.argv[4] || ''; // optional: OSC-safe workspace name
const PROBE          = `PROBE_${Date.now()}`;

console.log(`\nQLab memo cue test`);
console.log(`  Cue number : ${CUE_NUMBER}`);
console.log(`  Passcode   : ${PASSCODE || '(none)'}`);
console.log(`  Workspace  : ${WORKSPACE_NAME || '(auto-discover UUID)'}`);
console.log(`  QLab       : ${QLAB_HOST}:${QLAB_SEND_PORT}`);
console.log(`  Probe val  : ${PROBE}\n`);

function waitForReply(server, matchFn, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const handler = (msg) => {
      const [address, ...args] = msg;
      let body = null;
      try { body = JSON.parse(args[0]); } catch { /* not a JSON reply */ }
      if (matchFn(address, body)) {
        clearTimeout(timer);
        server.off('message', handler);
        resolve({ address, body });
      }
    };
    server.on('message', handler);
  });
}

async function run() {
  const client = new Client(QLAB_HOST, QLAB_SEND_PORT);
  const server = await new Promise((resolve, reject) => {
    const s = new Server(RECEIVE_PORT, '0.0.0.0', () => resolve(s));
    s.on('error', reject);
  });

  // Phase 1: resolve workspace identifier (name, or discover UUID)
  let workspace = WORKSPACE_NAME;
  if (!workspace) {
    console.log('1. Discovering workspace UUID...');
    client.send('/workspaces');
    const wsReply = await waitForReply(server, (_, body) => !!extractWorkspaceId(body), 2000);
    if (!wsReply) {
      console.log('✗  No reply from QLab. Check it is running and OSC is enabled on port', QLAB_SEND_PORT);
      process.exit(1);
    }
    workspace = extractWorkspaceId(wsReply.body);
    console.log(`   Workspace UUID: ${workspace}`);
  } else {
    console.log(`1. Using workspace name: ${workspace}`);
  }

  // Phase 2: connect (with or without passcode)
  console.log(`\n2. Connecting to workspace${PASSCODE ? ' (with passcode)' : ''}...`);
  const connectAddr = `/workspace/${workspace}/connect`;
  if (PASSCODE) client.send(connectAddr, PASSCODE);
  else          client.send(connectAddr);

  const connectReply = await waitForReply(server, (addr) => addr.includes('/connect'), 2000);

  if (!connectReply) {
    console.log('✗  No reply to /connect. QLab may require a passcode.');
    process.exit(1);
  }

  const connectStatus = connectReply.body?.status;
  console.log(`   Status: ${connectStatus}`);

  if (connectStatus === 'badpass') {
    console.log('✗  Wrong passcode.');
    process.exit(1);
  }
  if (connectStatus !== 'ok') {
    console.log(`✗  Connect failed: ${connectStatus}`);
    process.exit(1);
  }

  // Phase 3: test cue operations
  const base = `/workspace/${workspace}/cue/${CUE_NUMBER}`;

  console.log(`\n3. GET ${base}/type  →  expect "ok" if cue exists`);
  client.send(`${base}/type`);
  const typeReply = await waitForReply(server, (addr) => addr.includes(`/cue/${CUE_NUMBER}/type`), 2000);

  console.log(`   Reply: ${JSON.stringify(typeReply?.body)}`);
  if (typeReply?.body?.status === 'denied') {
    console.log(`✗  Cue "${CUE_NUMBER}" not found. Check the cue NUMBER (# column) in QLab.`);
    process.exit(1);
  }

  console.log(`\n4. SET ${base}/notes = "${PROBE}"`);
  client.send(`${base}/notes`, PROBE);
  await new Promise(r => setTimeout(r, 400));

  console.log(`\n5. GET ${base}/notes`);
  client.send(`${base}/notes`);
  const notesReply = await waitForReply(server, (addr) => addr.includes(`/cue/${CUE_NUMBER}/notes`), 2000);

  console.log(`   Reply: ${JSON.stringify(notesReply?.body)}`);

  // Verdict
  console.log('\n─── Result ───────────────────────────────────');
  if (!notesReply) {
    console.log('~  Cue exists but /notes returned no reply.');
    console.log('   The notes property may not be readable via OSC for memo cues.');
  } else if (notesReply.body?.status === 'ok' && notesReply.body?.data === PROBE) {
    console.log('✓  CONFIRMED — memo cue notes work end-to-end via OSC.');
  } else if (notesReply.body?.status === 'ok') {
    console.log(`~  GET returned ok but value did not update.`);
    console.log(`   Got: "${notesReply.body?.data}", expected: "${PROBE}"`);
    console.log('   The /notes property may be read-only via OSC.');
  } else {
    console.log('?  Unexpected reply:', notesReply?.body);
  }
  console.log('──────────────────────────────────────────────\n');

  try { client.close(); } catch (_) {}
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
