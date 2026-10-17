// LeetPush: service worker.
//
// Two modes:
//   manual (default): nothing runs on LeetCode. Press Push in the popup or Alt+Shift+P.
//   auto: a tiny script (inject/auto.js) is registered on leetcode.com and asks to push each new
//         accepted submission. It is unregistered again when you switch back to manual.
//
// storage.local holds only settings and the latest push, nothing that grows over time:
//   { mode, token, repo, branch, login, repoUrl, folder, last: {num, title, difficulty, ts, commitUrl} }
// Pushing the same submission twice is harmless: identical files produce no new commit.

import { buildFiles, commitMessage } from './lib/format.js';
import { pushFiles, verifyRepo } from './lib/github.js';
import { collectSubmission } from './lib/leetcode.js';

const PROBLEM_URL = /^https:\/\/leetcode\.com\/problems\/[^/]+/;
const AUTO_SCRIPT = { id: 'auto', matches: ['https://leetcode.com/*'], js: ['inject/auto.js'], runAt: 'document_idle' };
const AUTO_MAX_AGE_S = 15 * 60; // auto mode ignores old submissions opened from the list

chrome.runtime.onInstalled.addListener(async () => {
  // clean up keys written by earlier versions
  await chrome.storage.local.remove(['enabled', 'solved', 'history', 'days', 'pushedIds', 'lastError', 'failed']);
  await syncMode();
});
chrome.runtime.onStartup.addListener(syncMode);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.mode) syncMode(true);
});

async function syncMode(injectOpenTabs = false) {
  const { mode } = await chrome.storage.local.get('mode');
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT.id] });
  if (mode === 'auto' && !registered.length) {
    await chrome.scripting.registerContentScripts([AUTO_SCRIPT]);
    if (injectOpenTabs) {
      const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
      await Promise.all(tabs.map((t) =>
        chrome.scripting.executeScript({ target: { tabId: t.id }, files: AUTO_SCRIPT.js }).catch(() => {})));
    }
  } else if (mode !== 'auto' && registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT.id] });
  }
}

const autoHandled = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || sender.id !== chrome.runtime.id) return false;
  let job = null;
  if (sender.tab) {
    if (msg.type === 'auto-push' && sender.origin === 'https://leetcode.com') job = autoPush(sender.tab.id, String(msg.submissionId));
  } else if (msg.type === 'connect') {
    job = connect(msg.token, msg.repo, msg.folder);
  } else if (msg.type === 'push-tab') {
    job = pushTab(msg.tabId);
  }
  if (!job) return false;
  job.then(sendResponse, (e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});

async function autoPush(tabId, submissionId) {
  const { mode } = await chrome.storage.local.get('mode');
  if (mode !== 'auto' || !/^\d+$/.test(submissionId) || autoHandled.has(submissionId)) return { skipped: true };
  autoHandled.add(submissionId);
  if (autoHandled.size > 200) autoHandled.delete(autoHandled.values().next().value);
  const res = await pushTab(tabId, AUTO_MAX_AGE_S);
  if (res.skipped || res.ok) return res;
  // auto mode stays quiet about pages that are not your fresh accepted submissions
  if (/not accepted|No accepted submission/.test(res.error || '')) return { skipped: true };
  return res;
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'push') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  flashBadge('…', '#6b6f76', 0);
  const res = await pushTab(tab.id).catch((e) => ({ ok: false, error: e.message }));
  if (res.ok) flashBadge('✓', '#2f9e6b');
  else flashBadge('!', '#d9473a', 6000);
});

async function connect(token, repo, folder) {
  token = String(token || '').trim();
  if (!token) throw new Error('Enter a token first');
  const info = await verifyRepo(token, repo);
  await chrome.storage.local.set({
    token,
    repo: info.repo,
    branch: info.branch,
    login: info.login,
    repoUrl: info.htmlUrl,
    folder: String(folder || '').trim(),
  });
  return { ok: true, ...info };
}

function isValidSubmission(sub) {
  return sub && typeof sub.code === 'string' && sub.statusCode === 10 && sub.question &&
    typeof sub.question.titleSlug === 'string' && /^[a-z0-9-]+$/.test(sub.question.titleSlug);
}

async function pushTab(tabId, maxAgeS = 0) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !PROBLEM_URL.test(tab.url)) return { ok: false, error: 'Open a LeetCode problem first' };
  const cfg = await chrome.storage.local.get(['token', 'repo', 'branch', 'folder']);
  if (!cfg.token || !cfg.repo) return { ok: false, error: 'Connect GitHub in the LeetPush popup first' };

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectSubmission,
    args: [new URL(tab.url).pathname],
  });
  const found = injection && injection.result;
  if (!found) return { ok: false, error: 'Could not read the LeetCode page' };
  if (found.error) return { ok: false, error: found.error };
  if (!isValidSubmission(found.submission)) return { ok: false, error: 'Invalid submission data' };

  const sub = found.submission;
  if (maxAgeS && sub.timestamp && Date.now() / 1000 - sub.timestamp > maxAgeS) return { ok: true, skipped: true };
  const result = await pushFiles({
    token: cfg.token,
    repo: cfg.repo,
    branch: cfg.branch || 'main',
    files: buildFiles(sub, cfg.folder),
    message: commitMessage(sub),
  });
  const q = sub.question;
  const last = { num: q.questionFrontendId || q.questionId, title: q.title, difficulty: q.difficulty, ts: Date.now(), commitUrl: result.commitUrl };
  await chrome.storage.local.set({ last });
  return { ok: true, ...result, last };
}

let badgeTimer = 0;
function flashBadge(text, color, ms = 4000) {
  clearTimeout(badgeTimer);
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  if (ms) badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), ms);
}
