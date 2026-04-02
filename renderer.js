let currentSymbol = '';
let latestUpdate = null;
let statusTimer = null;
let updateTimer = null;

const statusText = document.getElementById('statusText');
const openBtn = document.getElementById('openBtn');

const minBtn = document.getElementById('minBtn');
const maxBtn = document.getElementById('maxBtn');
const closeBtn = document.getElementById('closeBtn');

const wxTop = document.getElementById('wxTop');

const adBtn = document.getElementById('adBtn');
const adModal = document.getElementById('adModal');
const adMask = document.getElementById('adMask');
const closeAdBtn = document.getElementById('closeAdBtn');

const okxLink = document.getElementById('okxLink');
const bnLink = document.getElementById('bnLink');
const bgLink = document.getElementById('bgLink');

const verText = document.getElementById('verText');
const updText = document.getElementById('updText');
const checkUpdBtn = document.getElementById('checkUpdBtn');
const dlUpdBtn = document.getElementById('dlUpdBtn');

const toggleTradeBtn = document.getElementById('toggleTradeBtn');
const tradePanel = document.getElementById('tradePanel');
const autoAlertChk = document.getElementById('autoAlertChk');
const apiStatusText = document.getElementById('apiStatusText');
const cfgApiBtn = document.getElementById('cfgApiBtn');
const testApiBtn = document.getElementById('testApiBtn');
const orderTypeSel = document.getElementById('orderTypeSel');
const leverageInput = document.getElementById('leverageInput');
const qtyInput = document.getElementById('qtyInput');
const priceWrap = document.getElementById('priceWrap');
const priceInput = document.getElementById('priceInput');
const tpInput = document.getElementById('tpInput');
const slInput = document.getElementById('slInput');
const reduceOnlyChk = document.getElementById('reduceOnlyChk');
const longBtn = document.getElementById('longBtn');
const shortBtn = document.getElementById('shortBtn');

const apiModal = document.getElementById('apiModal');
const apiMask = document.getElementById('apiMask');
const closeApiBtn = document.getElementById('closeApiBtn');
const saveApiBtn = document.getElementById('saveApiBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const apiSecretInput = document.getElementById('apiSecretInput');

async function refreshStatus() {
  try {
    const s = await window.tvq.getStatus(false);
    statusText.textContent = s.message || '检测中...';
    currentSymbol = s.symbol || '';
    openBtn.disabled = !currentSymbol;
  } catch {
    statusText.textContent = '检测异常';
    currentSymbol = '';
    openBtn.disabled = true;
  }
}

async function refreshUpdateStatus(silent = false) {
  const r = await window.tvq.checkUpdate();
  if (!r.enabled) {
    updText.textContent = '更新状态: 未配置更新源';
    dlUpdBtn.disabled = true;
    latestUpdate = null;
    return;
  }
  if (!r.ok) {
    updText.textContent = `更新状态: ${r.message || '检测失败'}`;
    if (!silent) alert(r.message || '更新检测失败');
    dlUpdBtn.disabled = true;
    latestUpdate = null;
    return;
  }
  if (r.hasUpdate) {
    updText.textContent = `更新状态: 发现 ${r.latestVersion}`;
    dlUpdBtn.disabled = false;
    latestUpdate = r;
  } else {
    updText.textContent = `更新状态: ${r.message}`;
    dlUpdBtn.disabled = true;
    latestUpdate = null;
  }
}

async function refreshCredentialStatus() {
  const r = await window.tvq.getBinanceCredentialStatus();
  if (!r.ok || !r.configured) {
    apiStatusText.textContent = 'API: 未配置';
    return;
  }
  apiStatusText.textContent = `API: 已配置 (${r.keyHint || '****'})`;
}

function toggleTradePanel() {
  tradePanel.classList.toggle('hidden');
  toggleTradeBtn.textContent = tradePanel.classList.contains('hidden') ? '开仓面板' : '收起开仓';
}

function syncOrderTypeUI() {
  const isLimit = orderTypeSel.value === 'LIMIT';
  priceWrap.classList.toggle('hidden', !isLimit);
}

async function placeOrder(side) {
  if (!currentSymbol) {
    alert('未识别到币种，暂时无法下单');
    return;
  }
  const payload = {
    symbolRaw: currentSymbol,
    side,
    type: orderTypeSel.value,
    leverage: Number(leverageInput.value || 0),
    quantityUsdt: qtyInput.value,
    price: priceInput.value,
    takeProfit: tpInput.value,
    stopLoss: slInput.value,
    reduceOnly: reduceOnlyChk.checked
  };
  const r = await window.tvq.placeBinanceOrder(payload);
  if (r.ok) {
    alert('下单成功');
  } else {
    alert(`下单失败: ${r.message || '未知错误'}`);
  }
}

openBtn.addEventListener('click', async () => {
  if (!currentSymbol) return;
  await window.tvq.openContract(currentSymbol);
});

minBtn.addEventListener('click', () => window.tvq.hide());
maxBtn.addEventListener('click', () => window.tvq.max());
closeBtn.addEventListener('click', () => window.tvq.close());

wxTop.addEventListener('click', () => {
  window.tvq.copyWechat();
  wxTop.textContent = '开发者微信：whitestar0224（已复制）';
  setTimeout(() => { wxTop.textContent = '开发者微信：whitestar0224'; }, 1200);
});

adBtn.addEventListener('click', () => adModal.classList.remove('hidden'));
adMask.addEventListener('click', () => adModal.classList.add('hidden'));
closeAdBtn.addEventListener('click', () => adModal.classList.add('hidden'));

okxLink.addEventListener('click', (e) => { e.preventDefault(); window.tvq.openLink('https://www.bjwebptyiou.com/join/51629076'); });
bnLink.addEventListener('click', (e) => { e.preventDefault(); window.tvq.openLink('https://www.binance.com/join?ref=WF7KWSF5'); });
bgLink.addEventListener('click', (e) => { e.preventDefault(); window.tvq.openLink('https://partner.bitgetapps.com/bg/xy8888'); });

checkUpdBtn.addEventListener('click', async () => {
  checkUpdBtn.disabled = true;
  await refreshUpdateStatus(false);
  checkUpdBtn.disabled = false;
});

dlUpdBtn.addEventListener('click', async () => {
  dlUpdBtn.disabled = true;
  updText.textContent = '更新状态: 下载中...';
  const r = await window.tvq.downloadUpdate('setup');
  if (r.ok) {
    updText.textContent = `更新状态: 已下载 ${r.file}`;
    await window.tvq.openFile(r.file);
  } else {
    updText.textContent = `更新状态: ${r.message || '下载失败'}`;
  }
  if (latestUpdate) dlUpdBtn.disabled = false;
});

window.tvq.onUpdateFound((r) => {
  latestUpdate = r;
  updText.textContent = `更新状态: 发现 ${r.latestVersion}`;
  dlUpdBtn.disabled = false;
});

if (window.tvq.onAlertTriggered) {
  window.tvq.onAlertTriggered((d) => {
    statusText.textContent = `警报触发跳转: ${d.symbol}`;
  });
}

toggleTradeBtn.addEventListener('click', toggleTradePanel);
orderTypeSel.addEventListener('change', syncOrderTypeUI);
cfgApiBtn.addEventListener('click', () => apiModal.classList.remove('hidden'));
apiMask.addEventListener('click', () => apiModal.classList.add('hidden'));
closeApiBtn.addEventListener('click', () => apiModal.classList.add('hidden'));

saveApiBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  const secret = apiSecretInput.value.trim();
  const r = await window.tvq.setBinanceCredentials(key, secret);
  if (!r.ok) {
    alert(`保存失败: ${r.message || '未知错误'}`);
    return;
  }
  apiModal.classList.add('hidden');
  apiSecretInput.value = '';
  await refreshCredentialStatus();
});

testApiBtn.addEventListener('click', async () => {
  const r = await window.tvq.testBinanceConnection();
  alert(r.ok ? 'API 测试成功' : `API 测试失败: ${r.message || '未知错误'}`);
  await refreshCredentialStatus();
});

longBtn.addEventListener('click', () => placeOrder('BUY'));
shortBtn.addEventListener('click', () => placeOrder('SELL'));

autoAlertChk.addEventListener('change', async () => {
  await window.tvq.setAutoAlertEnabled(autoAlertChk.checked);
});

function startTimers() {
  stopTimers();
  statusTimer = setInterval(refreshStatus, 2500);
  updateTimer = setInterval(() => refreshUpdateStatus(true), 300000);
}

function stopTimers() {
  if (statusTimer) clearInterval(statusTimer);
  if (updateTimer) clearInterval(updateTimer);
  statusTimer = null;
  updateTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopTimers();
  } else {
    refreshStatus();
    startTimers();
  }
});

(async () => {
  const v = await window.tvq.getVersion();
  verText.textContent = `当前版本: ${v}`;
  await window.tvq.getStatus(true);
  await refreshStatus();
  await refreshUpdateStatus(true);
  await refreshCredentialStatus();
  const a = await window.tvq.getAutoAlertEnabled();
  autoAlertChk.checked = Boolean(a && a.enabled);
  syncOrderTypeUI();
  startTimers();
})();
