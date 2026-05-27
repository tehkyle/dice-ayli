let _socket = null;

// Returns the singleton socket.io connection.
// io() is the global created by /socket.io/socket.io.js loaded via script tag.
export function getSocket() {
  if (!_socket) _socket = io();
  return _socket;
}
