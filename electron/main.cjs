const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { getEditorsStatus, installInResolve, installInPremiere } = require('./localEditorHost.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function resolveAppIcon() {
  const candidate = path.join(__dirname, '..', 'build', 'icon.ico');
  return fsSync.existsSync(candidate) ? candidate : undefined;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#090b10',
    title: 'Framebase Presets',
    icon: resolveAppIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));

  return window;
}

ipcMain.handle('framebase:save-file', async (_event, fileName, base64) => {
  const safeName = path.basename(String(fileName || 'Framebase-Preset.drfx'));
  const ext = path.extname(safeName).replace(/^\./, '').toLowerCase() || 'drfx';
  const filterName = ext === 'mogrt'
    ? 'Plantilla Motion Graphics Premiere'
    : ext === 'prfpset'
      ? 'Preset Adobe Premiere Pro'
      : ext === 'zip'
        ? 'Colección de Presets ZIP'
        : 'Plantilla DaVinci Resolve';
  const result = await dialog.showSaveDialog({
    title: 'Exportar paquete de preset',
    defaultPath: safeName,
    filters: [{ name: filterName, extensions: [ext] }],
  });
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, Buffer.from(String(base64 || ''), 'base64'));
  return true;
});

ipcMain.handle('framebase:editors-status', () => getEditorsStatus());
ipcMain.handle('framebase:install-resolve', (_event, payload) => installInResolve(payload));
ipcMain.handle('framebase:install-premiere', (_event, payload) => installInPremiere(payload));

ipcMain.handle('framebase:get-always-on-top', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return Boolean(win && win.isAlwaysOnTop());
});

ipcMain.handle('framebase:set-always-on-top', (event, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  const next = Boolean(enabled);
  win.setAlwaysOnTop(next, 'floating');
  return win.isAlwaysOnTop();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
