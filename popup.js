const $ = (id) => document.getElementById(id);
const KEYS = ['enabled', 'token', 'repo', 'branch', 'login', 'repoUrl', 'folder', 'solved', 'history', 'days', 'lastError', 'failed'];

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

  const solved = Object.values(state.solved || {});
  $('statTotal').textContent = solved.length;
  for (const d of ['Easy', 'Medium', 'Hard']) {
    $(`stat${d}`).textContent = solved.filter((s) => s.difficulty === d).length;
  }

  const streak = streakOf(state.days || []);
  $('streak').innerHTML = '';
  if (streak > 0) {
    const b = document.createElement('b');
    b.textContent = `${streak} ${streak === 1 ? 'day' : 'days'}`;
    $('streak').append('Current streak: ', b);
  }

  const list = $('history');
  list.textContent = '';
  const items = (state.history || []).slice(0, 4);
  $('historyEmpty').hidden = items.length > 0;
  for (const h of items) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = `dot ${h.difficulty}`;
    const title = document.createElement(h.commitUrl ? 'a' : 'span');
    title.className = 'title';
    title.textContent = `${h.num}. ${h.title}`;
    if (h.commitUrl) {
      title.href = h.commitUrl;
      title.target = '_blank';
      title.rel = 'noopener';
      title.title = 'View commit';
    }
    const time = document.createElement('time');
    time.textContent = ago(h.ts);
    li.append(dot, title, time);
    list.append(li);
  }
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function streakOf(days) {
  const set = new Set(days);
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1); // nothing today yet: count up to yesterday
  let n = 0;
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
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
