const path = require('path');
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const express = require('express');

const { DATA_DIR } = require('./dataDir');
const { getDb } = require('./db/database');
const { startReceiver, setActiveShow } = require('./osc/qlabBridge');
const showsRouter  = require('./routes/shows');
const configRouter = require('./routes/config');
const qlabRouter   = require('./routes/qlab');
const authRouter   = require('./routes/auth');
const sheetsRouter = require('./routes/sheets');
const photosRouter = require('./routes/photos');
const { router: eventsRouter, broadcast } = require('./routes/events');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(path.join(DATA_DIR, 'photos')));

app.get('/history', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/camera',  (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.get('/api/version', (_req, res) => {
  res.json({ version: require('./package.json').version });
});

app.use('/api/shows',  showsRouter);
app.use('/api/config', configRouter);
app.use('/api/qlab',   qlabRouter);
app.use('/api/auth',   authRouter);
app.use('/api/sheets', sheetsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/photos', photosRouter);

const db = getDb();

const midShowShow = db.data.shows.find(s => s.locked_at && !s.ended_at);
if (midShowShow) {
  setActiveShow(midShowShow.id);
  console.log(`[SERVER] Restored active show ID: ${midShowShow.id}`);
}

startReceiver(db, broadcast);

app.listen(PORT, () => {
  console.log(`[SERVER] Dacha DICE: AYLI running at http://localhost:${PORT}`);
});
