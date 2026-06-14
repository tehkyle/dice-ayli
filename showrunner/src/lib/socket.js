let _socket = null;

export function getSocket() {
  if (!_socket) _socket = io();
  return _socket;
}
