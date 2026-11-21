const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('nativeHost', {
  isDesktop: true,
  version: process.versions.electron,
  platform: process.platform,
  saveFile: (fileName, base64) => ipcRenderer.invoke('framebase:save-file', fileName, base64),
  getEditorsStatus: () => ipcRenderer.invoke('framebase:editors-status'),
  installInResolve: (payload) => ipcRenderer.invoke('framebase:install-resolve', payload),
  installInPremiere: (payload) => ipcRenderer.invoke('framebase:install-premiere', payload),
  getAlwaysOnTop: () => ipcRenderer.invoke('framebase:get-always-on-top'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('framebase:set-always-on-top', enabled),
});
