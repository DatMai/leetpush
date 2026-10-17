const $ = (id) => document.getElementById(id);
const KEYS = ['mode', 'token', 'repo', 'branch', 'login', 'repoUrl', 'folder', 'last'];
const MODE_HINTS = {
  auto: 'Every accepted Submit is pushed automatically.',
  manual: 'Nothing runs until you press Push (or Alt+Shift+P).',
};
const SUBMISSION_PATH = /^\/problems\/([^/]+)\/submissions\/(\d+)/;
const PROBLEM_PATH = /^\/problems\/([^/]+)/;

let state = {};
let status = null; // live push status from storage.session
let tab = null;

async function load() {
  state = await chrome.storage.local.get(KEYS);
  ({ status } = await chrome.storage.session.get('status'));
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  render();
}

function tabTarget() {
  let url;
  try {
    url = new URL(tab && tab.url);
  } catch {
    return null;
  }
  if (url.origin !== 'https://leetcode.com') return null;
  const sub = SUBMISSION_PATH.exec(url.pathname);
  if (sub) return `Submission #${sub[2]}`;
  const problem = PROBLEM_PATH.exec(url.pathname);
  return problem ? `Latest accepted solution of ${problem[1]}` : null;
}

function render() {
  const connected = !!(state.token && state.repo);
  $('setup').hidden = connected;
  $('account').hidden = !connected;
  $('pushBox').hidden = !connected;

  if (connected) {
    $('repoLink').textContent = state.repo;
    $('repoLink').href = state.repoUrl || `https://github.com/${state.repo}`;
    const meta = [`@${state.login}`, state.branch, state.folder ? `${state.folder}/` : null].filter(Boolean);
    $('repoMeta').textContent = meta.join(' · ');
  }

  const mode = state.mode === 'auto' ? 'auto' : 'manual';
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  $('modeHint').textContent = MODE_HINTS[mode];

  const target = tabTarget();
  const busy = !!(status && status.state === 'pushing' && Date.now() - status.ts < 60000);
  $('manualBox').hidden = mode === 'auto';
  $('push').disabled = !target || busy;
  $('push').textContent = busy ? 'Pushing…' : 'Push';
  $('target').textContent = target || 'Open a problem on leetcode.com to push it';

  let kind = 'idle';
  let text = mode === 'auto' ? 'Waiting for your next accepted Submit' : 'Ready';
  if (busy) {
    kind = 'pushing';
    text = 'Pushing to GitHub…';
  } else if (status && status.state === 'error') {
    kind = 'error';
    text = status.error || 'Push failed';
  } else if (status && status.state === 'done') {
    kind = 'done';
    text = status.unchanged ? `Already up to date · ${ago(status.ts)}` : `Pushed · ${ago(status.ts)}`;
  }
  $('status').className = `status ${kind}`;
  $('statusText').textContent = text;

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
  await chrome.storage.local.remove(['token', 'repo', 'branch', 'login', 'repoUrl', 'folder', 'last']);
  await load();
});

$('push').addEventListener('click', async () => {
  // the background worker reports progress through storage.session, which re-renders the popup
  try {
    await chrome.runtime.sendMessage({ type: 'push-tab', tabId: tab.id });
  } catch {
    // shown through the status line
  }
  await load();
});

document.querySelectorAll('.seg button').forEach((b) => {
  b.addEventListener('click', () => chrome.storage.local.set({ mode: b.dataset.mode }));
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local' || area === 'session') load();
});

load();
