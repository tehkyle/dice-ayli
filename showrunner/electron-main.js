const { app, BrowserWindow } = require('electron');
const path  = require('path');
const http  = require('http');
const { fork } = require('child_process');

const PORT = parseInt(process.env.PORT, 10) || 3000;

let serverProcess;
let mainWindow;

// Start the Express server as a child process, rooted at the app bundle directory
// so all relative paths (db/, config.json, .env, sheets-config.json) resolve correctly.
function startServer() {
  const appRoot = app.getAppPath();
  serverProcess = fork(path.join(appRoot, 'server.js'), [], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(PORT) },
    silent: false,
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron] Server process error:', err.message);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[Electron] Server process exited with code ${code}`);
  });
}

// Poll until Express responds, then open the window
function waitForServer(onReady, attemptsLeft = 40) {
  http.get(`http://localhost:${PORT}`, () => {
    onReady();
  }).on('error', () => {
    if (attemptsLeft > 0) {
      setTimeout(() => waitForServer(onReady, attemptsLeft - 1), 250);
    } else {
      console.error('[Electron] Server did not start in time');
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
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill('SIGTERM');
});
