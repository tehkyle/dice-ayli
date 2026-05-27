require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const path = require('path');

const { getDb } = require('./db/database');
const { startReceiver } = require('./osc/qlabBridge');
const showsRouter  = require('./routes/shows');
const configRouter = require('./routes/config');
const qlabRouter   = require('./routes/qlab');
const authRouter   = require('./routes/auth');
const sheetsRouter = require('./routes/sheets');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIO(httpServer);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/history', (_req, res) => res.sendFile(path.join(__dirname, 'public/history.html')));

app.use('/api/shows',  showsRouter);
app.use('/api/config', configRouter);
app.use('/api/qlab',   qlabRouter);
app.use('/api/auth',   authRouter);
app.use('/api/sheets', sheetsRouter);

// Initialize DB on startup
const db = getDb();

// Start OSC receiver (scaffolded for future scene logging / marketing display)
startReceiver(db, io);

// socket.io — scaffolded for future marketing display phase
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[SERVER] Dacha DICE: AYLI running at http://localhost:${PORT}`);
});
