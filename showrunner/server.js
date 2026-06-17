const path = require('path');
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const fs    = require('fs');
const https = require('https');
const express = require('express');

const { getDb } = require('./db/database');
const { getLanIp } = require('./utils');
const { getCameraCredentials } = require('./https-cert');
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

// Separate HTTPS listener for operator phones — getUserMedia requires a secure
// context, so /camera only works when loaded over this. Failure here shouldn't
// take down the main SM-facing http server.
(async () => {
  let config = {};
  try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch {}

  const httpsPort = parseInt(config.cameraHttpsPort, 10) || 8443;
  try {
    const credentials = await getCameraCredentials(config, getLanIp());
    https.createServer(credentials, app).listen(httpsPort, () => {
      console.log(`[SERVER] Camera HTTPS listening at https://${config.cameraHostname || getLanIp()}:${httpsPort}`);
    });
  } catch (err) {
    console.error(`[SERVER] Could not start camera HTTPS listener: ${err.message}`);
  }
})();
