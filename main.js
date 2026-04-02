const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');

let win;
let tray;
let detectScriptPath = '';
let updateCache = null;

const AHK_CANDIDATES = [
  'C:/Program Files/AutoHotkey/v2/AutoHotkey64.exe',
  'C:/Program Files/AutoHotkey/v2/AutoHotkey.exe',
  'C:/Program Files/AutoHotkey/AutoHotkey64.exe'
];

function findAhkExe() {
  for (const p of AHK_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function ensureDetectScriptPath() {
  try {
    const src = path.join(__dirname, 'tvq_detect.ahk');
    const runtimeDir = path.join(app.getPath('userData'), 'runtime');
    if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir, { recursive: true });
    const target = path.join(runtimeDir, 'tvq_detect.ahk');
    const content = fs.readFileSync(src, 'utf8');
    fs.writeFileSync(target, content, 'utf8');
    detectScriptPath = target;
  } catch {
    detectScriptPath = path.join(__dirname, 'tvq_detect.ahk');
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 300,
    minWidth: 380,
    minHeight: 220,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0f172a',
    title: 'TVQ',
    icon: path.join(__dirname, 'TVQ.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('blur', () => {
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  });
  win.loadFile('index.html');
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'TVQ.ico'));
  const menu = Menu.buildFromTemplate([
    { label: '显示 TVQ', click: () => { if (win) win.show(); } },
    { label: '隐藏 TVQ', click: () => { if (win) win.hide(); } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setToolTip('TVQ');
  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide(); else win.show();
  });
}

function getCenterPoint() {
  if (!win) return { x: 0, y: 0 };
  const b = win.getBounds();
  return { x: Math.floor(b.x + b.width / 2), y: Math.floor(b.y + b.height / 2) };
}

function detectStatus() {
  return new Promise((resolve) => {
    const ahkExe = findAhkExe();
    if (!ahkExe) {
      resolve({ ok: false, monitor: 1, symbol: '', message: '未找到 AutoHotkey v2' });
      return;
    }

    const center = getCenterPoint();
    const script = detectScriptPath || path.join(__dirname, 'tvq_detect.ahk');
    execFile(ahkExe, [script, String(center.x), String(center.y)], { timeout: 1500 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, monitor: 1, symbol: '', message: '检测失败' });
        return;
      }
      const line = String(stdout || '').trim();
      const parts = line.split('|');
      const monitor = Number(parts[0] || 1);
      const symbol = parts[1] || '';
      resolve({
        ok: symbol.length > 0,
        monitor,
        symbol,
        message: symbol ? `屏幕${monitor} 自动: ${symbol}` : `屏幕${monitor} 未识别到 TradingView 币种`
      });
    });
  });
}

function normalizeSymbol(raw) {
  const s0 = String(raw || '').trim().toUpperCase();
  if (!s0) return null;
  let exchange = 'BINANCE';
  let pairLike = s0;
  if (s0.includes(':')) {
    const arr = s0.split(':');
    exchange = arr[0] || 'BINANCE';
    pairLike = arr.slice(1).join('');
  }
  pairLike = pairLike.replace(/\s+/g, '').replace(/\.(P|PERP)$/i, '').replace(/PERP$/i, '').replace(/[^A-Z0-9]/g, '');
  if (!pairLike) return null;
  return { exchange, pair: pairLike };
}

function splitPair(pair) {
  const quotes = ['USDT', 'USDC', 'USD', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'EUR', 'TRY'];
  for (const q of quotes) {
    if (pair.length > q.length && pair.endsWith(q)) {
      return { base: pair.slice(0, pair.length - q.length), quote: q };
    }
  }
  return { base: pair, quote: 'USDT' };
}

function buildContractUrl(exchange, pair) {
  const p = splitPair(pair);
  switch (exchange) {
    case 'BINANCE':
      return `https://www.binance.com/zh-CN/futures/${pair}`;
    case 'BYBIT':
      return `https://www.bybit.com/trade/usdt/${pair}`;
    case 'OKX':
      return `https://www.okx.com/cn/trade-swap/${p.base.toLowerCase()}-${p.quote.toLowerCase()}-swap`;
    case 'BITGET':
      return `https://www.bitget.com/zh-CN/futures/usdt/${p.base}${p.quote}`;
    case 'GATE':
    case 'GATEIO':
      return `https://www.gate.io/zh/futures/USDT/${p.base}_${p.quote}`;
    case 'MEXC':
      return `https://www.mexc.com/zh-CN/futures/${pair}`;
    default:
      return `https://www.binance.com/zh-CN/futures/${pair}`;
  }
}

function parseVer(v) {
  return String(v || '0.0.0').split('.').map((n) => Number(n) || 0);
}

function isNewer(latest, current) {
  const a = parseVer(latest);
  const b = parseVer(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function stripBom(s) {
  return String(s || '').replace(/^\uFEFF/, '');
}

function getUpdateConfig() {
  const bundledDefaults = {
    enabled: false,
    checkIntervalMinutes: 30,
    manifestUrl: '',
    channel: 'stable'
  };

  const userCfg = path.join(app.getPath('userData'), 'update-config.json');
  const bundledCfg = path.join(__dirname, 'update-config.json');

  try {
    let bundled = {};
    let user = {};
    if (fs.existsSync(bundledCfg)) {
      bundled = JSON.parse(stripBom(fs.readFileSync(bundledCfg, 'utf8')));
    }
    if (fs.existsSync(userCfg)) {
      user = JSON.parse(stripBom(fs.readFileSync(userCfg, 'utf8')));
    }

    const cfg = { ...bundledDefaults, ...bundled, ...user };
    if (!cfg.manifestUrl && bundled.manifestUrl) {
      cfg.manifestUrl = bundled.manifestUrl;
    }
    if (typeof cfg.enabled !== 'boolean') {
      cfg.enabled = Boolean(cfg.enabled);
    }
    return cfg;
  } catch {
    return bundledDefaults;
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 6000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(stripBom(raw)));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function checkForUpdates() {
  const cfg = getUpdateConfig();
  if (!cfg.enabled || !cfg.manifestUrl) {
    return {
      ok: false,
      enabled: false,
      hasUpdate: false,
      currentVersion: app.getVersion(),
      message: '未配置更新源'
    };
  }

  const manifest = await fetchJson(cfg.manifestUrl);
  const latestVersion = String(manifest.version || '').trim();
  if (!latestVersion) {
    return { ok: false, enabled: true, hasUpdate: false, currentVersion: app.getVersion(), message: '更新清单无效' };
  }

  const hasUpdate = isNewer(latestVersion, app.getVersion());
  updateCache = {
    latestVersion,
    notes: manifest.notes || '',
    setupUrl: manifest.setupUrl || '',
    portableUrl: manifest.portableUrl || '',
    publishedAt: manifest.publishedAt || ''
  };

  return {
    ok: true,
    enabled: true,
    hasUpdate,
    currentVersion: app.getVersion(),
    ...updateCache,
    message: hasUpdate ? `发现新版本 ${latestVersion}` : '当前已是最新版'
  };
}

function downloadToFile(fileUrl, outPath) {
  return new Promise((resolve, reject) => {
    const client = fileUrl.startsWith('https') ? https : http;
    const req = client.get(fileUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadToFile(res.headers.location, outPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(outPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(outPath));
      });
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function downloadUpdate(kind = 'setup') {
  const info = updateCache || await checkForUpdates();
  if (!info || !info.hasUpdate) {
    return { ok: false, message: '当前没有可更新版本' };
  }

  const dlUrl = (kind === 'portable' ? info.portableUrl : info.setupUrl) || info.setupUrl || info.portableUrl;
  if (!dlUrl) {
    return { ok: false, message: '更新链接缺失' };
  }

  const downloadDir = path.join(app.getPath('downloads'), 'TVQ-Updates');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const guessedName = dlUrl.split('/').pop() || `TVQ-${info.latestVersion}.exe`;
  const outPath = path.join(downloadDir, guessedName);
  await downloadToFile(dlUrl, outPath);
  return { ok: true, file: outPath, message: '下载完成' };
}

ipcMain.handle('status:get', async () => detectStatus());
ipcMain.handle('contract:open', async (_evt, symbol) => {
  const n = normalizeSymbol(symbol);
  if (!n) return { ok: false, message: '币种解析失败' };
  const url = buildContractUrl(n.exchange, n.pair);
  await shell.openExternal(url);
  return { ok: true, url };
});
ipcMain.handle('win:min', () => { if (win) win.minimize(); });
ipcMain.handle('win:max', () => { if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.handle('win:hide', () => { if (win) win.hide(); });
ipcMain.handle('win:close', () => app.quit());
ipcMain.handle('link:open', (_evt, url) => shell.openExternal(url));
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', async () => {
  try {
    return await checkForUpdates();
  } catch (e) {
    return { ok: false, enabled: true, hasUpdate: false, currentVersion: app.getVersion(), message: `更新检测失败: ${e.message}` };
  }
});
ipcMain.handle('update:download', async (_evt, kind) => {
  try {
    return await downloadUpdate(kind);
  } catch (e) {
    return { ok: false, message: `下载失败: ${e.message}` };
  }
});
ipcMain.handle('file:open', async (_evt, p) => {
  if (!p) return { ok: false };
  await shell.openPath(p);
  return { ok: true };
});

app.whenReady().then(() => {
  ensureDetectScriptPath();
  createWindow();
  createTray();

  const cfg = getUpdateConfig();
  const ms = Math.max(1, Number(cfg.checkIntervalMinutes || 30)) * 60 * 1000;
  setInterval(async () => {
    try {
      const r = await checkForUpdates();
      if (r.hasUpdate && win && !win.isDestroyed()) {
        win.webContents.send('update:found', r);
      }
    } catch {}
  }, ms);
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
  if (win) win.hide();
});
