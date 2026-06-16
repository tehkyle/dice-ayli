const express = require('express');
const router  = express.Router();

// Open SSE connections — one per connected browser tab.
const clients = new Set();

router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection:      'keep-alive',
  });
  res.flushHeaders();

  clients.add(res);
  req.on('close', () => clients.delete(res));
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

module.exports = { router, broadcast };
