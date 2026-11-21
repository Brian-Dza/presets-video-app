const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('resolveBridge', {
  getContext: () => ipcRenderer.invoke('framebase:resolve-context'),
  applyPreset: (payload) => ipcRenderer.invoke('framebase:apply-preset', payload),
  saveProject: () => ipcRenderer.invoke('framebase:save-project'),
});

contextBridge.exposeInMainWorld('nativeHost', {
  isDesktop: true,
  version: '0.1.0',
  platform: process.platform,
  saveFile: (fileName, base64) => ipcRenderer.invoke('framebase:save-file', { fileName, base64 }),
});
