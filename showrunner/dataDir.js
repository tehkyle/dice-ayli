const path = require('path');

// The packaged Electron app sets this to Electron's userData directory so
// show history (db + photos) lives outside the app bundle and survives
// app upgrades — the bundle itself gets replaced wholesale on every install.
// Dev/test runs (node server.js, npm test) have no env var set and fall
// back to the project root, matching the old on-disk layout.
const DATA_DIR = process.env.SHOWRUNNER_DATA_DIR || __dirname;

module.exports = { DATA_DIR };
