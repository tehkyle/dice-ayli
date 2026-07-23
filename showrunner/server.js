const path = require('path');
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const express = require('express');

const { getPhotosDir } = require('./dataDir');
const { getDb } = require('./db/database');
const { photoFolderName } = require('./utils');
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

// Photo URLs stay id-based (/photos/:showId/:filename) even though the
// on-disk folder is named by the show's start time (see photoFolderName) —
// this indirection is what keeps gallery links stable regardless of that
// naming scheme, and re-reads getPhotosDir() per request so a Settings
// change takes effect without a restart.
app.get('/photos/:showId/:filename', (req, res) => {
  const showId   = parseInt(req.params.showId, 10);
  const filename = req.params.filename;
  if (!/^[\w.-]+$/.test(filename)) return res.status(400).end();

  const show = getDb().data.shows.find(s => s.id === showId);
  if (!show) return res.status(404).end();

  res.sendFile(path.join(getPhotosDir(), photoFolderName(show), filename), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

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
