const { app, BrowserWindow, utilityProcess, dialog, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');

const PORT = parseInt(process.env.PORT, 10) || 3000;

let serverProcess;
let mainWindow;

function startServer() {
  const appRoot = app.getAppPath();
  serverProcess = utilityProcess.fork(path.join(appRoot, 'server.js'), [], {
    cwd:   appRoot,
    env:   { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', d => console.log('[Server]', d.toString().trimEnd()));
  serverProcess.stderr.on('data', d => console.error('[Server]', d.toString().trimEnd()));
  serverProcess.on('exit', code => console.log(`[Electron] Server exited with code ${code}`));
}

function waitForServer(onReady, attemptsLeft = 40) {
  http.get(`http://localhost:${PORT}`, () => {
    onReady();
  }).on('error', () => {
    if (attemptsLeft > 0) {
      setTimeout(() => waitForServer(onReady, attemptsLeft - 1), 250);
    } else {
      dialog.showErrorBox(
        'Dacha DICE: AYLI — Server failed to start',
        `The local server did not respond on port ${PORT} after 10 seconds.\n\nRun the app from Terminal for logs:\n  /Applications/Dacha-Dice-AYLI.app/Contents/MacOS/Dacha-Dice-AYLI`
      );
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1024,
    height: 768,
    title:  'Dacha DICE: AYLI',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  startServer();
  waitForServer(createWindow);

  globalShortcut.register('CommandOrControl+Alt+I', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
