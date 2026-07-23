const path = require('path');
const fs   = require('fs');

// The packaged Electron app sets this to Electron's userData directory so
// show history (db + photos) lives outside the app bundle and survives
// app upgrades — the bundle itself gets replaced wholesale on every install.
// Dev/test runs (node server.js, npm test) have no env var set and fall
// back to the project root, matching the old on-disk layout.
const DATA_DIR = process.env.SHOWRUNNER_DATA_DIR || __dirname;

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

// Where this process writes and serves photo bytes from. Defaults to
// DATA_DIR/photos — override (Settings → QLab tab) when QLab runs on a
// different machine and photos need to land on a share mounted from it
// instead of this machine's own disk. Read fresh each call so a Settings
// change takes effect without restarting the server.
function getPhotosDir() {
  const { photosDir } = loadConfig();
  return photosDir || path.join(DATA_DIR, 'photos');
}

// The same folder's path as QLab's own machine sees it — this is what gets
// sent over OSC for QLab to build video cues from. Only differs from
// getPhotosDir() when that folder is a network share mounted at a
// different local path on each machine; falls back to getPhotosDir() for
// the common same-machine setup.
function getQlabPhotosDir() {
  const { qlabPhotosDir } = loadConfig();
  return qlabPhotosDir || getPhotosDir();
}

module.exports = { DATA_DIR, getPhotosDir, getQlabPhotosDir };
