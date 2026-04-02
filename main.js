const { app, BrowserWindow, ipcMain, shell, Tray, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

let win;
let tray;
let detectScriptPath = '';
let updateCache = null;
let detectInFlight = null;
let detectLastResult = null;
let detectLastAt = 0;
let autoAlertEnabled = false;
let lastAlertSymbol = '';
let lastAlertAt = 0;

const BINANCE_API_BASES = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com'
];
const AHK_CANDIDATES = [
  'C:/Program Files/AutoHotkey/v2/AutoHotkey64.exe',
  'C:/Program Files/AutoHotkey/v2/AutoHotkey.exe',
  'C:/Program Files/AutoHotkey/AutoHotkey64.exe'
];

function normalizeFetchError(err) {
  if (!err) return '未知网络错误';
  const code = err.code || err.cause?.code || '';
  const msg = err.message || String(err);
  if (code === 'ETIMEDOUT' || msg.includes('timed out')) return '网络超时，请检查网络/代理';
  if (code === 'ENOTFOUND') return '域名解析失败，请检查 DNS 或网络环境';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return '连接被拒绝或重置，请检查网络/防火墙';
  if (msg === 'fetch failed') return '无法连接交易所接口（可能需要代理网络）';
  return `${msg}${code ? ` (${code})` : ''}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    throw new Error(normalizeFetchError(e));
  } finally {
    clearTimeout(timer);
  }
}

function stripBom(s) {
  return String(s || '').replace(/^\uFEFF/, '');
}

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
    fs.writeFileSync(target, fs.readFileSync(src, 'utf8'), 'utf8');
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
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver');
  });
  win.loadFile('index.html');
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'TVQ.ico'));
  const menu = Menu.buildFromTemplate([
    { label: 'Show TVQ', click: () => { if (win) win.show(); } },
    { label: 'Hide TVQ', click: () => { if (win) win.hide(); } },
    { type: 'separator' },
    { label: 'Exit', click: () => app.quit() }
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

function extractSymbolFromText(text) {
  const t = String(text || '');
  const m1 = t.match(/([A-Z0-9]+:[A-Z0-9._-]+)/i);
  if (m1 && m1[1]) return m1[1].toUpperCase();
  const m2 = t.match(/\b([A-Z0-9]{3,}(USDT|USDC|USD|BUSD|FDUSD|BTC|ETH)(\.P|\.PERP|PERP)?)\b/i);
  if (m2 && m2[1]) return `BINANCE:${m2[1].toUpperCase()}`;
  return '';
}

function detectStatusMac() {
  return new Promise((resolve) => {
    const script = `
set tvTitle to ""
try
  tell application "System Events"
    if exists process "TradingView" then
      tell process "TradingView"
        if (count of windows) > 0 then
          set tvTitle to name of front window
        end if
      end tell
    end if
  end tell
end try
return tvTitle
`;
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 1500 }, (err, stdout) => {
      if (err) return resolve({ ok: false, monitor: 1, symbol: '', message: 'Detect failed' });
      const title = String(stdout || '').trim();
      const symbol = extractSymbolFromText(title);
      resolve({ ok: symbol.length > 0, monitor: 1, symbol, message: symbol ? `Auto: ${symbol}` : 'TradingView symbol not found' });
    });
  });
}

function detectStatus(force = false) {
  const now = Date.now();
  if (!force && detectLastResult && (now - detectLastAt) < 1500) return Promise.resolve(detectLastResult);
  if (!force && detectInFlight) return detectInFlight;

  detectInFlight = new Promise((resolve) => {
    if (process.platform === 'darwin') {
      detectStatusMac().then((out) => {
        detectLastResult = out;
        detectLastAt = Date.now();
        detectInFlight = null;
        resolve(out);
      });
      return;
    }
    if (process.platform !== 'win32') {
      const out = { ok: false, monitor: 1, symbol: '', message: 'Unsupported OS' };
      detectLastResult = out;
      detectLastAt = Date.now();
      detectInFlight = null;
      return resolve(out);
    }

    const ahkExe = findAhkExe();
    if (!ahkExe) {
      const out = { ok: false, monitor: 1, symbol: '', message: 'AutoHotkey v2 not found' };
      detectLastResult = out;
      detectLastAt = Date.now();
      detectInFlight = null;
      return resolve(out);
    }

    const center = getCenterPoint();
    const script = detectScriptPath || path.join(__dirname, 'tvq_detect.ahk');
    execFile(ahkExe, [script, String(center.x), String(center.y)], { timeout: 1500 }, (err, stdout) => {
      if (err) {
        const out = { ok: false, monitor: 1, symbol: '', message: 'Detect failed' };
        detectLastResult = out;
        detectLastAt = Date.now();
        detectInFlight = null;
        return resolve(out);
      }
      const [m, sym] = String(stdout || '').trim().split('|');
      const monitor = Number(m || 1);
      const symbol = sym || '';
      const out = { ok: !!symbol, monitor, symbol, message: symbol ? `Screen ${monitor} auto: ${symbol}` : `Screen ${monitor} no symbol` };
      detectLastResult = out;
      detectLastAt = Date.now();
      detectInFlight = null;
      resolve(out);
    });
  });
  return detectInFlight;
}

function detectAlertSymbolWin() {
  return new Promise((resolve) => {
    const ahkExe = findAhkExe();
    if (!ahkExe) return resolve('');
    const script = detectScriptPath || path.join(__dirname, 'tvq_detect.ahk');
    execFile(ahkExe, [script, '0', '0', 'alert'], { timeout: 1200 }, (err, stdout) => {
      if (err) return resolve('');
      resolve(String(stdout || '').trim());
    });
  });
}

async function pollAlertAndJump() {
  if (!autoAlertEnabled || process.platform !== 'win32') return;
  const sym = await detectAlertSymbolWin();
  if (!sym) return;

  const now = Date.now();
  if (sym === lastAlertSymbol && (now - lastAlertAt) < 8000) return;

  const norm = normalizeSymbol(sym);
  if (!norm || !norm.pair) return;

  lastAlertSymbol = sym;
  lastAlertAt = now;
  const url = buildContractUrl(norm.exchange || 'BINANCE', norm.pair);
  await shell.openExternal(url);
  if (win && !win.isDestroyed()) win.webContents.send('alert:triggered', { symbol: sym, url });
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
    if (pair.length > q.length && pair.endsWith(q)) return { base: pair.slice(0, pair.length - q.length), quote: q };
  }
  return { base: pair, quote: 'USDT' };
}

function buildContractUrl(exchange, pair) {
  const p = splitPair(pair);
  switch (exchange) {
    case 'BINANCE': return `https://www.binance.com/zh-CN/futures/${pair}`;
    case 'BYBIT': return `https://www.bybit.com/trade/usdt/${pair}`;
    case 'OKX': return `https://www.okx.com/cn/trade-swap/${p.base.toLowerCase()}-${p.quote.toLowerCase()}-swap`;
    case 'BITGET': return `https://www.bitget.com/zh-CN/futures/usdt/${p.base}${p.quote}`;
    case 'GATE':
    case 'GATEIO': return `https://www.gate.io/zh/futures/USDT/${p.base}_${p.quote}`;
    case 'MEXC': return `https://www.mexc.com/zh-CN/futures/${pair}`;
    default: return `https://www.binance.com/zh-CN/futures/${pair}`;
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

function getUpdateConfig() {
  const defaults = { enabled: false, checkIntervalMinutes: 30, manifestUrl: '', channel: 'stable' };
  const userCfg = path.join(app.getPath('userData'), 'update-config.json');
  const bundledCfg = path.join(__dirname, 'update-config.json');
  try {
    const bundled = fs.existsSync(bundledCfg) ? JSON.parse(stripBom(fs.readFileSync(bundledCfg, 'utf8'))) : {};
    const user = fs.existsSync(userCfg) ? JSON.parse(stripBom(fs.readFileSync(userCfg, 'utf8'))) : {};
    const cfg = { ...defaults, ...bundled, ...user };
    if (!cfg.manifestUrl && bundled.manifestUrl) cfg.manifestUrl = bundled.manifestUrl;
    return cfg;
  } catch {
    return defaults;
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 6000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return fetchJson(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(stripBom(raw))); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function checkForUpdates() {
  const cfg = getUpdateConfig();
  if (!cfg.enabled || !cfg.manifestUrl) return { ok: false, enabled: false, hasUpdate: false, currentVersion: app.getVersion(), message: '未配置更新源' };
  const manifest = await fetchJson(cfg.manifestUrl);
  const latestVersion = String(manifest.version || '').trim();
  if (!latestVersion) return { ok: false, enabled: true, hasUpdate: false, currentVersion: app.getVersion(), message: '更新清单无效' };
  const hasUpdate = isNewer(latestVersion, app.getVersion());
  updateCache = { latestVersion, notes: manifest.notes || '', setupUrl: manifest.setupUrl || '', portableUrl: manifest.portableUrl || '', publishedAt: manifest.publishedAt || '' };
  return { ok: true, enabled: true, hasUpdate, currentVersion: app.getVersion(), ...updateCache, message: hasUpdate ? `发现新版本 ${latestVersion}` : '当前已是最新版' };
}

function downloadToFile(fileUrl, outPath) {
  return new Promise((resolve, reject) => {
    const client = fileUrl.startsWith('https') ? https : http;
    const req = client.get(fileUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return downloadToFile(res.headers.location, outPath).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const file = fs.createWriteStream(outPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(outPath)));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function downloadUpdate(kind = 'setup') {
  const info = updateCache || await checkForUpdates();
  if (!info || !info.hasUpdate) return { ok: false, message: '当前没有可更新版本' };
  const dlUrl = (kind === 'portable' ? info.portableUrl : info.setupUrl) || info.setupUrl || info.portableUrl;
  if (!dlUrl) return { ok: false, message: '更新链接缺失' };
  const downloadDir = path.join(app.getPath('downloads'), 'TVQ-Updates');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
  const outPath = path.join(downloadDir, dlUrl.split('/').pop() || `TVQ-${info.latestVersion}.exe`);
  await downloadToFile(dlUrl, outPath);
  return { ok: true, file: outPath, message: '下载完成' };
}

function getCredentialPath() {
  return path.join(app.getPath('userData'), 'binance-cred.json');
}

function getExchangeCredentialPath() {
  return path.join(app.getPath('userData'), 'exchange-credentials.json');
}

function normalizeExchangeId(exchange) {
  const e = String(exchange || 'BINANCE').trim().toUpperCase();
  if (e === 'OKX') return 'OKX';
  if (e === 'BITGET') return 'BITGET';
  return 'BINANCE';
}

function loadAllExchangeCredentials() {
  const p = getExchangeCredentialPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(stripBom(fs.readFileSync(p, 'utf8'))) || {};
  } catch {
    return {};
  }
}

function saveAllExchangeCredentials(all) {
  fs.writeFileSync(getExchangeCredentialPath(), JSON.stringify(all || {}, null, 2), 'utf8');
}

function saveExchangeCredentials(exchange, apiKey, apiSecret, passphrase = '') {
  const ex = normalizeExchangeId(exchange);
  const key = String(apiKey || '').trim();
  const secret = String(apiSecret || '').trim();
  const pp = String(passphrase || '').trim();
  if (!key || !secret) throw new Error('API Key 和 Secret 不能为空');
  if ((ex === 'OKX' || ex === 'BITGET') && !pp) throw new Error(`${ex} 需要 Passphrase`);

  const all = loadAllExchangeCredentials();
  all[ex] = {
    apiKey: encryptMaybe(key),
    apiSecret: encryptMaybe(secret),
    passphrase: encryptMaybe(pp),
    updatedAt: new Date().toISOString()
  };
  saveAllExchangeCredentials(all);
}

function loadExchangeCredentials(exchange) {
  const ex = normalizeExchangeId(exchange);
  const all = loadAllExchangeCredentials();
  const data = all[ex] || {};
  const apiKey = decryptMaybe(data.apiKey);
  const apiSecret = decryptMaybe(data.apiSecret);
  const passphrase = decryptMaybe(data.passphrase);
  if (!apiKey || !apiSecret) return { configured: false, apiKey: '', apiSecret: '', passphrase: '' };
  if ((ex === 'OKX' || ex === 'BITGET') && !passphrase) return { configured: false, apiKey: '', apiSecret: '', passphrase: '' };
  return { configured: true, apiKey, apiSecret, passphrase, keyHint: `${apiKey.slice(0, 4)}****${apiKey.slice(-2)}` };
}

function encryptMaybe(text) {
  if (!text) return '';
  if (safeStorage && safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(text).toString('base64')}`;
  return `plain:${text}`;
}

function decryptMaybe(stored) {
  const s = String(stored || '');
  if (!s) return '';
  if (s.startsWith('enc:')) {
    if (!(safeStorage && safeStorage.isEncryptionAvailable())) return '';
    return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
  }
  if (s.startsWith('plain:')) return s.slice(6);
  return '';
}

function saveBinanceCredentials(apiKey, apiSecret) {
  const key = String(apiKey || '').trim();
  const secret = String(apiSecret || '').trim();
  if (!key || !secret) throw new Error('API Key 和 Secret 不能为空');
  fs.writeFileSync(getCredentialPath(), JSON.stringify({ apiKey: encryptMaybe(key), apiSecret: encryptMaybe(secret), updatedAt: new Date().toISOString() }, null, 2), 'utf8');
}

function loadBinanceCredentials() {
  const p = getCredentialPath();
  if (!fs.existsSync(p)) return { configured: false, apiKey: '', apiSecret: '' };
  const data = JSON.parse(stripBom(fs.readFileSync(p, 'utf8')));
  const apiKey = decryptMaybe(data.apiKey);
  const apiSecret = decryptMaybe(data.apiSecret);
  if (!apiKey || !apiSecret) return { configured: false, apiKey: '', apiSecret: '' };
  return { configured: true, apiKey, apiSecret, keyHint: `${apiKey.slice(0, 4)}****${apiKey.slice(-2)}` };
}

function signQuery(query, secret) {
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

function signBase64(text, secret) {
  return crypto.createHmac('sha256', secret).update(text).digest('base64');
}

async function binanceSignedRequest(method, apiPath, params, apiKey, apiSecret) {
  const baseParams = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const query = new URLSearchParams(baseParams).toString();
  const fullQuery = `${query}&signature=${signQuery(query, apiSecret)}`;
  let lastErr = null;
  for (const base of BINANCE_API_BASES) {
    try {
      const url = `${base}${apiPath}`;
      const res = await fetchWithTimeout(method === 'GET' ? `${url}?${fullQuery}` : url, {
        method,
        headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: method === 'GET' ? undefined : fullQuery
      }, 12000);
      const text = await res.text();
      let json = {};
      try { json = JSON.parse(text); } catch { json = { msg: text }; }
      if (!res.ok) throw new Error(json.msg || `HTTP ${res.status}`);
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Binance 请求失败: ${normalizeFetchError(lastErr)}`);
}

function roundDownToStep(value, step) {
  if (!step || step <= 0) return value;
  return Math.floor(value / step) * step;
}

function formatNumber(n, maxDp = 12) {
  const s = Number(n).toFixed(maxDp);
  return s.replace(/\.?0+$/, '');
}

async function getBinanceSymbolMeta(symbol) {
  let info = null;
  let lastErr = null;
  for (const base of BINANCE_API_BASES) {
    try {
      const res = await fetchWithTimeout(`${base}/fapi/v1/exchangeInfo`, {}, 12000);
      info = await res.json();
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!info) throw new Error(`Binance 元数据获取失败: ${normalizeFetchError(lastErr)}`);
  const s = (info.symbols || []).find((x) => x.symbol === symbol);
  if (!s) {
    throw new Error(`交易对不存在: ${symbol}`);
  }
  const lot = (s.filters || []).find((f) => f.filterType === 'LOT_SIZE') || {};
  const priceFilter = (s.filters || []).find((f) => f.filterType === 'PRICE_FILTER') || {};
  return {
    stepSize: Number(lot.stepSize || 0.001),
    minQty: Number(lot.minQty || 0.001),
    tickSize: Number(priceFilter.tickSize || 0.0001)
  };
}

async function getBinanceLastPrice(symbol) {
  let lastErr = null;
  for (const base of BINANCE_API_BASES) {
    try {
      const res = await fetchWithTimeout(`${base}/fapi/v1/ticker/price?symbol=${symbol}`, {}, 12000);
      const p = await res.json();
      return Number(p.price || 0);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Binance 价格获取失败: ${normalizeFetchError(lastErr)}`);
}

async function binancePlaceOrder(payload) {
  const creds = payload._creds || loadBinanceCredentials();
  if (!creds.configured) throw new Error('请先配置交易所 API Key / Secret');
  const norm = normalizeSymbol(payload.symbolRaw || payload.symbol || '');
  if (!norm || !norm.pair) throw new Error('未识别到可下单币种');

  const symbol = norm.pair;
  const side = String(payload.side || '').toUpperCase();
  const type = String(payload.type || 'MARKET').toUpperCase();
  const quantityUsdt = Number(payload.quantityUsdt || payload.quantity || 0);
  const price = String(payload.price || '').trim();
  const takeProfit = Number(payload.takeProfit || 0);
  const stopLoss = Number(payload.stopLoss || 0);
  const reduceOnly = Boolean(payload.reduceOnly);
  const leverage = Number(payload.leverage || 0);

  if (!['BUY', 'SELL'].includes(side)) throw new Error('下单方向无效');
  if (!['MARKET', 'LIMIT'].includes(type)) throw new Error('订单类型仅支持市价/限价');
  if (!quantityUsdt || quantityUsdt <= 0) throw new Error('数量(USDT)必须大于0');

  const meta = await getBinanceSymbolMeta(symbol);
  const basePrice = type === 'LIMIT' ? Number(price) : await getBinanceLastPrice(symbol);
  if (!basePrice || basePrice <= 0) {
    throw new Error('无法获取有效价格用于换算数量');
  }

  if (leverage > 0) {
    await binanceSignedRequest('POST', '/fapi/v1/leverage', { symbol, leverage: Math.min(125, Math.max(1, Math.floor(leverage))) }, creds.apiKey, creds.apiSecret);
  }

  const lev = leverage > 0 ? leverage : 1;
  const rawQty = (quantityUsdt * lev) / basePrice;
  const qty = roundDownToStep(rawQty, meta.stepSize);
  if (qty < meta.minQty) {
    throw new Error(`数量过小，最小下单数量约为 ${meta.minQty}`);
  }

  const order = { symbol, side, type, quantity: formatNumber(qty), reduceOnly: reduceOnly ? 'true' : 'false' };
  if (type === 'LIMIT') {
    if (!price || Number(price) <= 0) throw new Error('限价单必须填写价格');
    order.price = formatNumber(Number(price), 8);
    order.timeInForce = 'GTC';
  }

  const mainOrder = await binanceSignedRequest('POST', '/fapi/v1/order', order, creds.apiKey, creds.apiSecret);
  const closeSide = side === 'BUY' ? 'SELL' : 'BUY';

  if (takeProfit > 0) {
    await binanceSignedRequest('POST', '/fapi/v1/order', {
      symbol,
      side: closeSide,
      type: 'TAKE_PROFIT_MARKET',
      stopPrice: formatNumber(takeProfit, 8),
      closePosition: 'true',
      workingType: 'MARK_PRICE'
    }, creds.apiKey, creds.apiSecret);
  }

  if (stopLoss > 0) {
    await binanceSignedRequest('POST', '/fapi/v1/order', {
      symbol,
      side: closeSide,
      type: 'STOP_MARKET',
      stopPrice: formatNumber(stopLoss, 8),
      closePosition: 'true',
      workingType: 'MARK_PRICE'
    }, creds.apiKey, creds.apiSecret);
  }

  return mainOrder;
}

async function binanceTestConnection() {
  const creds = arguments[0] || loadBinanceCredentials();
  if (!creds.configured) throw new Error('请先配置交易所 API Key / Secret');
  await binanceSignedRequest('GET', '/fapi/v2/balance', {}, creds.apiKey, creds.apiSecret);
  return { ok: true, keyHint: creds.keyHint || '' };
}

function pairToOkxInstId(pair) {
  const p = splitPair(pair);
  return `${p.base}-${p.quote}-SWAP`;
}

function pairToBitgetSymbol(pair) {
  return pair;
}

async function okxRequest(method, pathWithQuery, body, creds) {
  const ts = new Date().toISOString();
  const bodyText = body ? JSON.stringify(body) : '';
  const preHash = `${ts}${method.toUpperCase()}${pathWithQuery}${bodyText}`;
  const sign = signBase64(preHash, creds.apiSecret);
  try {
    const res = await fetchWithTimeout(`https://www.okx.com${pathWithQuery}`, {
      method,
      headers: {
        'OK-ACCESS-KEY': creds.apiKey,
        'OK-ACCESS-SIGN': sign,
        'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': creds.passphrase,
        'Content-Type': 'application/json'
      },
      body: body ? bodyText : undefined
    }, 12000);
    const json = await res.json();
    if (!res.ok || String(json.code || '0') !== '0') {
      throw new Error(json.msg || `OKX HTTP ${res.status}`);
    }
    return json.data || [];
  } catch (e) {
    throw new Error(`OKX 请求失败: ${normalizeFetchError(e)}`);
  }
}

async function bitgetRequest(method, pathWithQuery, body, creds) {
  const ts = String(Date.now());
  const bodyText = body ? JSON.stringify(body) : '';
  const preHash = `${ts}${method.toUpperCase()}${pathWithQuery}${bodyText}`;
  const sign = signBase64(preHash, creds.apiSecret);
  try {
    const res = await fetchWithTimeout(`https://api.bitget.com${pathWithQuery}`, {
      method,
      headers: {
        'ACCESS-KEY': creds.apiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': ts,
        'ACCESS-PASSPHRASE': creds.passphrase,
        'Content-Type': 'application/json',
        locale: 'zh-CN'
      },
      body: body ? bodyText : undefined
    }, 12000);
    const json = await res.json();
    if (!res.ok || String(json.code || '0') !== '00000') {
      throw new Error(json.msg || `Bitget HTTP ${res.status}`);
    }
    return json.data || {};
  } catch (e) {
    throw new Error(`Bitget 请求失败: ${normalizeFetchError(e)}`);
  }
}

async function okxPlaceOrder(payload, creds) {
  const norm = normalizeSymbol(payload.symbolRaw || payload.symbol || '');
  if (!norm || !norm.pair) throw new Error('未识别到可下单币种');
  const instId = pairToOkxInstId(norm.pair);
  const side = String(payload.side || '').toUpperCase() === 'BUY' ? 'buy' : 'sell';
  const type = String(payload.type || 'MARKET').toUpperCase();
  const quantityUsdt = Number(payload.quantityUsdt || 0);
  const leverage = Number(payload.leverage || 1);
  if (quantityUsdt <= 0) throw new Error('数量(USDT)必须大于0');

  const ticker = await fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`);
  const last = Number((((ticker || {}).data || [])[0] || {}).last || 0);
  if (!(last > 0)) throw new Error('OKX 价格获取失败');

  const ins = await fetchJson(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${instId}`);
  const meta = (((ins || {}).data || [])[0]) || {};
  const ctVal = Number(meta.ctVal || 1);
  const lotSz = Number(meta.lotSz || 1);
  const rawSz = (quantityUsdt * Math.max(1, leverage)) / (last * ctVal);
  const sz = Math.max(lotSz, roundDownToStep(rawSz, lotSz));

  await okxRequest('POST', '/api/v5/account/set-leverage', { instId, lever: String(Math.max(1, Math.floor(leverage))), mgnMode: 'cross' }, creds);

  const body = {
    instId,
    tdMode: 'cross',
    side,
    ordType: type === 'LIMIT' ? 'limit' : 'market',
    sz: formatNumber(sz, 8)
  };
  if (type === 'LIMIT') body.px = formatNumber(Number(payload.price || 0), 8);
  return okxRequest('POST', '/api/v5/trade/order', body, creds);
}

async function bitgetPlaceOrder(payload, creds) {
  const norm = normalizeSymbol(payload.symbolRaw || payload.symbol || '');
  if (!norm || !norm.pair) throw new Error('未识别到可下单币种');
  const symbol = pairToBitgetSymbol(norm.pair);
  const side = String(payload.side || '').toUpperCase() === 'BUY' ? 'buy' : 'sell';
  const type = String(payload.type || 'MARKET').toUpperCase();
  const quantityUsdt = Number(payload.quantityUsdt || 0);
  const leverage = Number(payload.leverage || 1);
  if (quantityUsdt <= 0) throw new Error('数量(USDT)必须大于0');

  const ticker = await fetchJson(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`);
  const last = Number((((ticker || {}).data || [])[0] || {}).lastPr || 0);
  if (!(last > 0)) throw new Error('Bitget 价格获取失败');

  const contracts = await fetchJson('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES');
  const meta = (((contracts || {}).data || []).find((x) => String(x.symbol || '').toUpperCase() === symbol) || {});
  const minTradeNum = Number(meta.minTradeNum || 0.001);
  const sizeMultiplier = Number(meta.sizeMultiplier || 0.001);
  const rawSz = (quantityUsdt * Math.max(1, leverage)) / last;
  const sz = Math.max(minTradeNum, roundDownToStep(rawSz, sizeMultiplier));

  await bitgetRequest('POST', '/api/v2/mix/account/set-leverage', {
    symbol,
    productType: 'USDT-FUTURES',
    marginCoin: 'USDT',
    leverage: String(Math.max(1, Math.floor(leverage)))
  }, creds);

  const body = {
    symbol,
    productType: 'USDT-FUTURES',
    marginMode: 'crossed',
    marginCoin: 'USDT',
    size: formatNumber(sz, 8),
    side,
    orderType: type === 'LIMIT' ? 'limit' : 'market',
    force: 'gtc'
  };
  if (type === 'LIMIT') body.price = formatNumber(Number(payload.price || 0), 8);
  return bitgetRequest('POST', '/api/v2/mix/order/place-order', body, creds);
}

async function placeOrderByExchange(payload) {
  const ex = normalizeExchangeId(payload.exchange);
  const creds = loadExchangeCredentials(ex);
  if (!creds.configured) throw new Error(`请先配置 ${ex} API`);
  if (ex === 'OKX') return okxPlaceOrder(payload, creds);
  if (ex === 'BITGET') return bitgetPlaceOrder(payload, creds);
  return binancePlaceOrder({ ...payload, _creds: creds });
}

async function testExchangeConnection(exchange) {
  const ex = normalizeExchangeId(exchange);
  const creds = loadExchangeCredentials(ex);
  if (!creds.configured) throw new Error(`请先配置 ${ex} API`);
  if (ex === 'OKX') {
    await okxRequest('GET', '/api/v5/account/balance?ccy=USDT', null, creds);
    return { ok: true, keyHint: creds.keyHint || '' };
  }
  if (ex === 'BITGET') {
    await bitgetRequest('GET', '/api/v2/mix/account/account?symbol=BTCUSDT&productType=USDT-FUTURES&marginCoin=USDT', null, creds);
    return { ok: true, keyHint: creds.keyHint || '' };
  }
  return binanceTestConnection(creds);
}

ipcMain.handle('status:get', async (_evt, force) => detectStatus(Boolean(force)));
ipcMain.handle('contract:open', async (_evt, symbol) => {
  const n = normalizeSymbol(symbol);
  if (!n) return { ok: false, message: '币种解析失败' };
  const url = buildContractUrl(n.exchange, n.pair);
  await shell.openExternal(url);
  return { ok: true, url };
});
ipcMain.handle('win:max', () => { if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.handle('win:hide', () => { if (win) win.hide(); });
ipcMain.handle('win:close', () => app.quit());
ipcMain.handle('link:open', (_evt, url) => shell.openExternal(url));
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', async () => {
  try { return await checkForUpdates(); } catch (e) { return { ok: false, enabled: true, hasUpdate: false, currentVersion: app.getVersion(), message: `更新检测失败: ${e.message}` }; }
});
ipcMain.handle('update:download', async (_evt, kind) => {
  try { return await downloadUpdate(kind); } catch (e) { return { ok: false, message: `下载失败: ${e.message}` }; }
});
ipcMain.handle('file:open', async (_evt, p) => {
  if (!p) return { ok: false };
  await shell.openPath(p);
  return { ok: true };
});

ipcMain.handle('exchange:credentials:status', async (_evt, exchange) => {
  try {
    const ex = normalizeExchangeId(exchange);
    const c = loadExchangeCredentials(ex);
    return { ok: true, exchange: ex, configured: c.configured, keyHint: c.keyHint || '' };
  } catch (e) {
    return { ok: false, configured: false, message: e.message };
  }
});
ipcMain.handle('exchange:credentials:set', async (_evt, exchange, apiKey, apiSecret, passphrase) => {
  try {
    const ex = normalizeExchangeId(exchange);
    saveExchangeCredentials(ex, apiKey, apiSecret, passphrase);
    const c = loadExchangeCredentials(ex);
    return { ok: true, exchange: ex, configured: c.configured, keyHint: c.keyHint || '' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle('exchange:test', async (_evt, exchange) => {
  try { return await testExchangeConnection(exchange); } catch (e) { return { ok: false, message: e.message }; }
});
ipcMain.handle('exchange:order', async (_evt, payload) => {
  try { return { ok: true, data: await placeOrderByExchange(payload || {}) }; } catch (e) { return { ok: false, message: e.message }; }
});

ipcMain.handle('autoalert:get', async () => ({ ok: true, enabled: autoAlertEnabled }));
ipcMain.handle('autoalert:set', async (_evt, enabled) => {
  autoAlertEnabled = Boolean(enabled);
  return { ok: true, enabled: autoAlertEnabled };
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
      if (r.hasUpdate && win && !win.isDestroyed()) win.webContents.send('update:found', r);
    } catch {}
  }, ms);

  setInterval(async () => {
    try { await pollAlertAndJump(); } catch {}
  }, 1200);
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
  if (win) win.hide();
});
