const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('tvq', {
  getStatus: (force = false) => ipcRenderer.invoke('status:get', force),
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
  getExchangeCredentialStatus: (exchange) => ipcRenderer.invoke('exchange:credentials:status', exchange),
  setExchangeCredentials: (exchange, apiKey, apiSecret, passphrase) => ipcRenderer.invoke('exchange:credentials:set', exchange, apiKey, apiSecret, passphrase),
  testExchangeConnection: (exchange) => ipcRenderer.invoke('exchange:test', exchange),
  placeExchangeOrder: (payload) => ipcRenderer.invoke('exchange:order', payload),
  getBinanceCredentialStatus: () => ipcRenderer.invoke('exchange:credentials:status', 'BINANCE'),
  setBinanceCredentials: (apiKey, apiSecret) => ipcRenderer.invoke('exchange:credentials:set', 'BINANCE', apiKey, apiSecret, ''),
  testBinanceConnection: () => ipcRenderer.invoke('exchange:test', 'BINANCE'),
  placeBinanceOrder: (payload) => ipcRenderer.invoke('exchange:order', { ...(payload || {}), exchange: 'BINANCE' }),
  getAutoAlertEnabled: () => ipcRenderer.invoke('autoalert:get'),
  setAutoAlertEnabled: (enabled) => ipcRenderer.invoke('autoalert:set', enabled),
  onUpdateFound: (fn) => ipcRenderer.on('update:found', (_evt, data) => fn(data))
  ,
  onAlertTriggered: (fn) => ipcRenderer.on('alert:triggered', (_evt, data) => fn(data))
});
