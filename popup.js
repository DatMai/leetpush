const $ = (id) => document.getElementById(id);
const KEYS = ['enabled', 'token', 'repo', 'branch', 'login', 'repoUrl', 'folder', 'last', 'lastError', 'failed'];

let state = {};

async function load() {
  state = await chrome.storage.local.get(KEYS);
  render();
}

function render() {
  const connected = !!(state.token && state.repo);
  $('enabled').checked = state.enabled !== false;
  $('setup').hidden = connected;
  $('account').hidden = !connected;

  if (connected) {
    $('repoLink').textContent = state.repo;
    $('repoLink').href = state.repoUrl || `https://github.com/${state.repo}`;
    const meta = [`@${state.login}`, state.branch, state.folder ? `${state.folder}/` : null].filter(Boolean);
    $('repoMeta').textContent = meta.join(' · ');
  }

  const err = state.lastError;
  $('errorBox').hidden = !err;
  if (err) {
    $('errorText').textContent = err.message;
    $('retry').hidden = !state.failed;
  }

  const last = state.last;
  $('last').hidden = !last;
  $('lastEmpty').hidden = !!last;
  if (last) {
    $('lastDot').className = `dot ${last.difficulty}`;
    $('lastLink').textContent = `${last.num}. ${last.title}`;
    $('lastLink').href = last.commitUrl || state.repoUrl || '#';
    $('lastTime').textContent = ago(last.ts);
  }
}

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

$('connectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('connectBtn');
  const errEl = $('connectError');
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Checking…';
  const res = await chrome.runtime.sendMessage({
    type: 'connect',
    token: $('token').value,
    repo: $('repo').value,
    folder: $('folder').value,
  });
  btn.disabled = false;
  btn.textContent = 'Connect';
  if (!res || !res.ok) {
    errEl.textContent = (res && res.error) || 'Could not connect';
    errEl.hidden = false;
    return;
  }
  $('token').value = '';
  await load();
});

$('disconnect').addEventListener('click', async () => {
  await chrome.storage.local.remove(['token', 'repo', 'branch', 'login', 'repoUrl', 'folder', 'lastError', 'failed']);
  await load();
});

$('retry').addEventListener('click', async () => {
  const btn = $('retry');
  btn.disabled = true;
  btn.textContent = 'Pushing…';
  await chrome.runtime.sendMessage({ type: 'retry' });
  btn.disabled = false;
  btn.textContent = 'Retry';
  await load();
});

$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') load();
});

load();
