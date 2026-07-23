const { app, BrowserWindow, utilityProcess, dialog, globalShortcut, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs   = require('fs');
const http = require('http');

const PORT = parseInt(process.env.PORT, 10) || 3000;

// Show history (db + photos) lives in userData, not the app bundle, so it
// survives the bundle being wholesale replaced on every app upgrade.
const DATA_DIR = app.getPath('userData');

// Startup polling — wait up to 10 seconds for the server to respond
const SERVER_POLL_INTERVAL_MS = 250;
const SERVER_POLL_ATTEMPTS    = 40;

// Delay update check so it doesn't race with app startup
const UPDATE_CHECK_DELAY_MS = 5000;

let serverProcess;
let mainWindow;
const serverLogs = [];
let pollTimer;

function log(line) {
  console.log(line);
  serverLogs.push(line);
}

function showFatalError(title) {
  const recentLogs = serverLogs.slice(-30).join('\n') || '(no output captured)';
  dialog.showErrorBox(
    `Dacha DICE: AYLI — ${title}`,
    `Server logs:\n\n${recentLogs}`
  );
}

// One-time carry-over for installs that still have show history sitting in
// the old location (inside the app bundle, from before DATA_DIR moved to
// userData). Safe to run every launch: no-ops once userData has its own db.
function migrateLegacyData() {
  const legacyDb     = path.join(app.getAppPath(), 'db', 'showrunner.json');
  const legacyPhotos = path.join(app.getAppPath(), 'photos');
  const newDb        = path.join(DATA_DIR, 'db', 'showrunner.json');
  const newPhotos    = path.join(DATA_DIR, 'photos');

  if (fs.existsSync(newDb)) return;

  if (fs.existsSync(legacyDb)) {
    fs.mkdirSync(path.dirname(newDb), { recursive: true });
    fs.copyFileSync(legacyDb, newDb);
    log('[Migration] Carried over existing show history to userData');
  }
  if (fs.existsSync(legacyPhotos)) {
    fs.cpSync(legacyPhotos, newPhotos, { recursive: true });
    log('[Migration] Carried over existing photos to userData');
  }
}

function startServer() {
  const appRoot = app.getAppPath();
  log(`[Electron] appRoot: ${appRoot}`);

  serverProcess = utilityProcess.fork(path.join(appRoot, 'server.js'), [], {
    cwd:   appRoot,
    env:   { ...process.env, PORT: String(PORT), SHOWRUNNER_DATA_DIR: DATA_DIR },
    stdio: 'pipe',
  });

  serverProcess.on('spawn', () => log('[Electron] Server process spawned'));

  serverProcess.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(log));
  serverProcess.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log('[ERR] ' + l)));

  serverProcess.on('exit', (code) => {
    log(`[Electron] Server exited with code ${code}`);
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
      showFatalError(`Server crashed (exit code ${code})`);
    }
  });
}

function waitForServer(onReady, attemptsLeft = SERVER_POLL_ATTEMPTS) {
  const req = http.get(`http://localhost:${PORT}`, () => {
    pollTimer = null;
    onReady();
  });
  req.on('error', () => {
    if (attemptsLeft > 0) {
      pollTimer = setTimeout(() => waitForServer(onReady, attemptsLeft - 1), SERVER_POLL_INTERVAL_MS);
    } else {
      pollTimer = null;
      showFatalError(`Server did not respond on port ${PORT} after 10 seconds`);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1024,
    title:  'Dacha DICE: AYLI',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.maximize();
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

const RELEASES_URL = 'https://tehkyle.github.io/dice-ayli/';

function setupUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type:      'info',
      title:     'Update available',
      message:   `Version ${info.version} is available`,
      detail:    'Open the download page to get the latest DMG installer.',
      buttons:   ['Download', 'Later'],
      defaultId: 0,
      cancelId:  1,
    }).then(({ response }) => {
      if (response === 0) shell.openExternal(RELEASES_URL);
    });
  });

  autoUpdater.on('error', (err) => {
    log(`[Updater] ${err.message}`);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => log(`[Updater] Check failed: ${err.message}`));
  }, UPDATE_CHECK_DELAY_MS);
}

// Native "choose folder" dialog for the Settings photos-folder field — picking
// a share by browsing avoids the operator hand-typing (and mistyping) a mount path.
ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

app.whenReady().then(() => {
  migrateLegacyData();
  startServer();
  waitForServer(() => {
    createWindow();
    setupUpdater();
  });

  globalShortcut.register('CommandOrControl+Alt+I', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
