const { app, BrowserWindow, utilityProcess, dialog, globalShortcut, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const http = require('http');

const PORT = parseInt(process.env.PORT, 10) || 3000;

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

function startServer() {
  const appRoot = app.getAppPath();
  log(`[Electron] appRoot: ${appRoot}`);

  serverProcess = utilityProcess.fork(path.join(appRoot, 'server.js'), [], {
    cwd:   appRoot,
    env:   { ...process.env, PORT: String(PORT) },
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

function waitForServer(onReady, attemptsLeft = 40) {
  const req = http.get(`http://localhost:${PORT}`, () => {
    pollTimer = null;
    onReady();
  });
  req.on('error', () => {
    if (attemptsLeft > 0) {
      pollTimer = setTimeout(() => waitForServer(onReady, attemptsLeft - 1), 250);
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

  // Check after a short delay so startup isn't blocked
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => log(`[Updater] Check failed: ${err.message}`));
  }, 5000);
}

app.whenReady().then(() => {
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
