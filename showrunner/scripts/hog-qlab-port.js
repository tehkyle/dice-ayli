#!/usr/bin/env node
/**
 * Occupies a UDP port the way a naive OSC client does — no /udpReplyPort
 * negotiation, just a hardcoded bind — to reproduce, without needing the
 * real Stream Deck plugin running, the port conflict that motivated moving
 * Showrunner's QLab connection to TCP. Leave this running, then start
 * Showrunner and confirm it still connects: proof the two no longer compete
 * for anything.
 *
 * Usage: node scripts/hog-qlab-port.js [port]   (defaults to 53001, QLab's
 * default UDP reply port and what the QLab Stream Deck plugin hardcodes)
 */
const dgram = require('dgram');

const port = parseInt(process.argv[2], 10) || 53001;
const socket = dgram.createSocket('udp4');

socket.on('error', (err) => {
  console.error(`Could not bind UDP port ${port}: ${err.message}`);
  process.exit(1);
});

socket.on('listening', () => {
  console.log(`Hogging UDP port ${port}. Leave this running, then start Showrunner (npm run dev) and confirm it still connects to QLab.`);
});

socket.bind(port, '0.0.0.0');
