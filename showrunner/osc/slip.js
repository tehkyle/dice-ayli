// SLIP framing (RFC 1055), "double END" variant — the framing QLab requires
// for OSC-over-TCP per the OSC 1.1 spec. Every message is bounded by END
// bytes on both sides, so a decoder can always resync on the next END byte
// even after garbage or a dropped connection mid-message.
const END     = 0xC0;
const ESC     = 0xDB;
const ESC_END = 0xDC;
const ESC_ESC = 0xDD;

function encode(buf) {
  const out = [END];
  for (const byte of buf) {
    if (byte === END) out.push(ESC, ESC_END);
    else if (byte === ESC) out.push(ESC, ESC_ESC);
    else out.push(byte);
  }
  out.push(END);
  return Buffer.from(out);
}

// Stateful decoder: feed it raw bytes as they arrive off the TCP socket in
// whatever chunks the OS hands over (a frame may span several chunks, or
// several frames may share one chunk) — push() returns every complete frame
// found in this chunk, unescaped.
class SlipDecoder {
  constructor() {
    this._bytes = [];
    this._escaping = false;
  }

  push(chunk) {
    const frames = [];
    for (const byte of chunk) {
      if (this._escaping) {
        this._escaping = false;
        if (byte === ESC_END) this._bytes.push(END);
        else if (byte === ESC_ESC) this._bytes.push(ESC);
        else this._bytes.push(byte); // malformed escape — pass the byte through rather than drop it
      } else if (byte === ESC) {
        this._escaping = true;
      } else if (byte === END) {
        // Double-END framing sends a boundary before AND after each message,
        // so an END with nothing accumulated is just the leading boundary —
        // not an empty frame.
        if (this._bytes.length > 0) frames.push(Buffer.from(this._bytes));
        this._bytes = [];
      } else {
        this._bytes.push(byte);
      }
    }
    return frames;
  }
}

module.exports = { encode, SlipDecoder };
