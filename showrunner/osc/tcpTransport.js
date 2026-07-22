// OSC-over-TCP transport for talking to QLab.
//
// UDP requires telling QLab which port to reply to (/udpReplyPort), and that
// setting isn't reliably independent per-client in practice — a second local
// OSC client (e.g. a Stream Deck plugin hardcoded to port 53001) can lose its
// own replies the moment this app claims a different one. TCP sidesteps the
// whole problem for the main command connection: replies come back on the
// same socket that sent the request, so there's nothing to negotiate.
//
// `QLabTcpConnection` dials QLab's main OSC port (commands + replies).
// `QLabTcpListener` accepts a connection from QLab for its Network Cue push
// channel (/show/scene_started, etc.) — this app is the server, QLab the
// client, for that direction. Earlier debugging attempts got the direction
// of this second channel wrong more than once (a port that looked "held by
// QLab" turned out to be a stuck/cached internal service unrelated to the
// Network Cue patch, discovered only by fully quitting and relaunching QLab
// and watching the port actually clear) — if this file changes again, don't
// trust which side listens without verifying against a freshly-restarted
// QLab process, not one that's been reconfigured repeatedly during the same
// session.
const net = require('net');
const EventEmitter = require('events');
const { Message } = require('node-osc');
const { toBuffer, fromBuffer } = require('osc-min');
const { encode: slipEncode, SlipDecoder } = require('./slip');

const RECONNECT_DELAY_MS = 2000;

// Matches the flat [address, ...argValues] shape node-osc's UDP Server emits,
// so the message handling in qlabBridge.js doesn't need to know the transport
// underneath it changed.
function toFlatMessage(decoded) {
  if (decoded.oscType !== 'message') return null; // QLab never sends us a bundle
  return [decoded.address, ...decoded.args.map(a => a.value)];
}

class QLabTcpConnection extends EventEmitter {
  constructor(host, port) {
    super();
    this.host = host;
    this.port = port;
    this._socket = null;
    this._connecting = false;
    this._reconnectTimer = null;
    this._decoder = null;
    // Sends issued while a connection attempt is already in flight (always
    // true, briefly, right after construction or a reconnect) — flushed the
    // instant that attempt succeeds. Cleared, not carried over, if it fails:
    // a command queued across a genuine outage (QLab quit, network down)
    // would otherwise fire late and stale once QLab finally comes back,
    // which for a live show is worse than just dropping it.
    this._pendingWrites = [];
    // No auto-connect here: constructing this object must stay side-effect
    // free (it's created as a module-level singleton, which anything that
    // merely requires qlabBridge.js — even indirectly, for unrelated exports
    // — would otherwise trigger). The first real send() is what starts the
    // connection; see send() and connect() below.
  }

  // Starts (or is a no-op if already started) the connection eagerly, ahead
  // of the first send — called by startReceiver() once the app is actually
  // running for real, rather than leaving every caller's first send() to
  // pay the initial connect latency.
  connect() {
    this._connect();
  }

  _connect() {
    if (this._connecting || (this._socket && !this._socket.destroyed)) return;
    this._connecting = true;
    // Fresh per connection — a partial frame left over from a dropped
    // connection must never bleed into the next one's byte stream.
    this._decoder = new SlipDecoder();

    const socket = net.createConnection({ host: this.host, port: this.port });

    // setTarget() can swap this._socket out from under an in-flight connection
    // attempt (destroy the old one, dial a new one) — these handlers fire
    // asynchronously, so each must confirm it's still the live socket before
    // touching shared state, or a stale old socket's belated 'close' could
    // clobber the new attempt's state.
    const isCurrent = () => this._socket === socket;

    socket.on('connect', () => {
      if (!isCurrent()) return;
      this._connecting = false;
      for (const buf of this._pendingWrites) socket.write(buf);
      this._pendingWrites = [];
      this.emit('connect');
    });

    socket.on('data', (chunk) => {
      if (!isCurrent()) return;
      const frames = this._decoder.push(chunk);
      if (frames.length === 0) this.emit('rawData', chunk); // nothing decoded from this chunk yet
      for (const frame of frames) {
        let decoded;
        try { decoded = fromBuffer(frame); } catch (err) { this.emit('decodeError', frame, err); continue; }
        const flat = toFlatMessage(decoded);
        if (flat) this.emit('message', flat);
      }
    });

    // 'close' always follows 'error' for a socket — no separate handling
    // needed here beyond swallowing the default unhandled-error crash.
    socket.on('error', () => {});
    socket.on('close', () => {
      if (!isCurrent()) return;
      this._connecting = false;
      this._socket = null;
      this._pendingWrites = [];
      this.emit('disconnect');
      this._scheduleReconnect();
    });

    this._socket = socket;
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, RECONNECT_DELAY_MS);
  }

  // Same call shape as node-osc's UDP Client — every existing
  // oscClient.send(address, ...args) call site keeps working unchanged.
  send(address, ...args) {
    // One choke point for every outgoing message, regardless of the many
    // call sites scattered through qlabBridge.js — lets the OSC monitor
    // observe all outbound traffic without each call site needing to know
    // about logging.
    this.emit('send', address, args);

    const message = new Message(address);
    for (const arg of args) message.append(arg);
    const buf = slipEncode(toBuffer(message));

    if (this._socket && !this._socket.destroyed && !this._connecting) {
      this._socket.write(buf);
      return;
    }
    if (this._connecting) {
      this._pendingWrites.push(buf);
      return;
    }
    // Fully idle between reconnect attempts — behave like UDP into a black
    // hole: drop this one and let the caller's own timeout/retry recover
    // once a connection re-establishes, same as the queue-discard case above.
    this._connect();
  }

  // Used by applyNetworkConfig() when the operator changes host/port in
  // Settings — tears down the old connection and dials the new target.
  setTarget(host, port) {
    this.host = host;
    this.port = port;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
    this._connect();
  }
}

// Accepts QLab's own connection for its Network Cue push channel — QLab is
// the client here, dialing in to deliver /show/scene_started etc.; this app
// is the server, unlike QLabTcpConnection above where roles are reversed.
class QLabTcpListener extends EventEmitter {
  constructor(port) {
    super();
    this.port = port;
    this._server = null;
    // Not started here — see QLabTcpConnection's constructor comment above;
    // the same require()-must-stay-inert reasoning applies. start() is
    // called by startReceiver() once the app is actually running.
  }

  start() {
    if (this._server) return;

    const server = net.createServer((socket) => {
      this.emit('connection', socket.remoteAddress);
      const decoder = new SlipDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.push(chunk);
        // Only when nothing decoded from this chunk — otherwise a normal
        // successful message would get logged twice (once raw, once decoded).
        if (frames.length === 0) this.emit('rawData', chunk);
        for (const frame of frames) {
          let decoded;
          try { decoded = fromBuffer(frame); } catch (err) { this.emit('decodeError', frame, err); continue; }
          const flat = toFlatMessage(decoded);
          if (flat) this.emit('message', flat);
        }
      });
      socket.on('error', () => {});
      socket.on('close', () => this.emit('disconnect', socket.remoteAddress));
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        this.emit('error', new Error(`Cue Port ${this.port} is already in use by another app. Change it in Settings.`));
      } else {
        this.emit('error', err);
      }
    });

    server.listen(this.port, '0.0.0.0');
    this._server = server;
  }

  stop() {
    if (this._server) {
      this._server.close();
      this._server = null;
    }
  }

  // Used by applyNetworkConfig() when the operator changes the Cue Port.
  setPort(port) {
    this.port = port;
    this.stop();
    this.start();
  }
}

module.exports = { QLabTcpConnection, QLabTcpListener };
