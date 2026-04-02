const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('tvq', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  openContract: (symbol) => ipcRenderer.invoke('contract:open', symbol),
  max: () => ipcRenderer.invoke('win:max'),
  hide: () => ipcRenderer.invoke('win:hide'),
  close: () => ipcRenderer.invoke('win:close'),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  copyWechat: () => clipboard.writeText('whitestar0224'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (kind) => ipcRenderer.invoke('update:download', kind),
  openFile: (p) => ipcRenderer.invoke('file:open', p),
  onUpdateFound: (fn) => ipcRenderer.on('update:found', (_evt, data) => fn(data))
});
