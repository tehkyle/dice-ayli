const { test } = require('node:test');
const assert = require('node:assert');
const { encode, SlipDecoder } = require('../osc/slip');

function roundTrip(...buffers) {
  const decoder = new SlipDecoder();
  const frames = [];
  for (const buf of buffers) {
    frames.push(...decoder.push(encode(buf)));
  }
  return frames;
}

test('round-trips a plain payload', () => {
  const [frame] = roundTrip(Buffer.from('hello world'));
  assert.strictEqual(frame.toString(), 'hello world');
});

test('round-trips a payload containing raw END and ESC bytes', () => {
  const payload = Buffer.from([0x01, 0xC0, 0x02, 0xDB, 0x03, 0xC0, 0xC0, 0xDB, 0xDB]);
  const [frame] = roundTrip(payload);
  assert.deepStrictEqual(frame, payload);
});

test('decodes multiple frames delivered in one chunk', () => {
  const a = Buffer.from('first');
  const b = Buffer.from('second');
  const decoder = new SlipDecoder();
  const combined = Buffer.concat([encode(a), encode(b)]);
  const frames = decoder.push(combined);
  assert.strictEqual(frames.length, 2);
  assert.strictEqual(frames[0].toString(), 'first');
  assert.strictEqual(frames[1].toString(), 'second');
});

test('decodes a single frame split across multiple chunks, including mid-escape-sequence', () => {
  const payload = Buffer.from([0x01, 0xC0, 0x02]); // contains a byte that must be escaped
  const encoded = encode(payload);
  // Feed it one byte at a time — guarantees some call lands mid escape-sequence.
  const decoder = new SlipDecoder();
  const frames = [];
  for (let i = 0; i < encoded.length; i++) {
    frames.push(...decoder.push(encoded.subarray(i, i + 1)));
  }
  assert.strictEqual(frames.length, 1);
  assert.deepStrictEqual(frames[0], payload);
});

test('back-to-back END bytes (double-END framing) never produce an empty frame', () => {
  const decoder = new SlipDecoder();
  // END, END, "x", END, END — as if two encode() calls were concatenated with no gap.
  const frames = decoder.push(Buffer.from([0xC0, 0xC0, 0x78, 0xC0, 0xC0]));
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].toString(), 'x');
});
