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
  startTimers();
})();
