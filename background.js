// LeetPush: service worker.
//
// Two modes:
//   manual (default): press Push in the popup or Alt+Shift+P.
//   auto: after you Submit, LeetCode moves to /problems/<slug>/submissions/<id>/. Chrome reports
//         that page change to this worker (webNavigation), which then pushes on its own and shows
//         the progress on the page, on the toolbar icon and in the popup.
// No script stays on LeetCode: code is injected only while a push is running.
//
// storage.local holds only settings and the latest push, nothing that grows over time:
//   { mode, token, repo, branch, login, repoUrl, folder, last: {num, title, difficulty, ts, commitUrl} }
// storage.session (memory only, gone when Chrome closes) holds the live status of a running push.
// Pushing the same submission twice is harmless: identical files produce no new commit.

import { buildFiles, commitMessage } from './lib/format.js';
import { pushFiles, verifyRepo } from './lib/github.js';
import { collectSubmission } from './lib/leetcode.js';
import { showToast } from './lib/toast.js';

const PROBLEM_URL = /^https:\/\/leetcode\.com\/problems\/[^/]+/;
const SUBMISSION_URL = /^https:\/\/leetcode\.com\/problems\/[^/]+\/submissions\/(\d+)\/?/;
const AUTO_MAX_AGE_S = 15 * 60; // auto mode ignores old submissions opened from the list

// Earlier versions registered a page script ('auto') that no longer exists; Chrome keeps such
// registrations across reloads, so drop it whenever the worker starts.
chrome.scripting.unregisterContentScripts({ ids: ['auto'] }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  // clean up keys left by earlier versions
  chrome.storage.local.remove(['enabled', 'solved', 'history', 'days', 'pushedIds', 'lastError', 'failed']);
});

// ---------------------------------------------------------------- auto mode

const autoHandled = new Set();
const navFilter = { url: [{ hostEquals: 'leetcode.com', pathContains: '/submissions/' }] };
chrome.webNavigation.onHistoryStateUpdated.addListener(onSubmissionPage, navFilter);
chrome.webNavigation.onCompleted.addListener(onSubmissionPage, navFilter);

async function onSubmissionPage(details) {
  if (details.frameId !== 0) return;
  const m = SUBMISSION_URL.exec(details.url);
  if (!m || autoHandled.has(m[1])) return;
  const { mode, token, repo } = await chrome.storage.local.get(['mode', 'token', 'repo']);
  if (mode !== 'auto' || !token || !repo) return;
  autoHandled.add(m[1]);
  if (autoHandled.size > 200) autoHandled.delete(autoHandled.values().next().value);
  await runPush(details.tabId, AUTO_MAX_AGE_S);
}

// One push with visible progress: page toast, toolbar badge and popup status.
async function runPush(tabId, maxAgeS = 0) {
  const toast = (...args) =>
    chrome.scripting.executeScript({ target: { tabId }, func: showToast, args }).catch(() => {});
  await setStatus({ state: 'pushing', ts: Date.now() });
  flashBadge('…', '#6b6f76', 0);
  toast('Pushing to GitHub…', 'info');
  let res;
  try {
    res = await pushTab(tabId, maxAgeS);
  } catch (e) {
    res = { ok: false, error: e.message || String(e) };
  }
  if (res.skipped) {
    chrome.action.setBadgeText({ text: '' });
    await setStatus(null);
    toast(res.reason || 'Skipped', 'muted');
    return res;
  }
  if (res.ok) {
    flashBadge('✓', '#2f9e6b');
    toast(res.unchanged ? 'Already up to date on GitHub' : 'Pushed to GitHub', 'success', res.commitUrl);
    await setStatus({ state: 'done', ts: Date.now(), unchanged: !!res.unchanged });
  } else {
    flashBadge('!', '#d9473a', 8000);
    toast(res.error || 'Push to GitHub failed', 'error');
    await setStatus({ state: 'error', ts: Date.now(), error: res.error });
  }
  return res;
}

function setStatus(status) {
  return status ? chrome.storage.session.set({ status }) : chrome.storage.session.remove('status');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || sender.tab || sender.id !== chrome.runtime.id) return false;
  let job = null;
  if (msg.type === 'connect') job = connect(msg.token, msg.repo, msg.folder);
  else if (msg.type === 'push-tab') job = runPush(msg.tabId);
  if (!job) return false;
  job.then(sendResponse, (e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'push') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await runPush(tab.id);
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
  if (found.error && /not accepted/i.test(found.error)) return { ok: true, skipped: true, reason: 'Not accepted, nothing pushed' };
  if (found.error) return { ok: false, error: found.error };
  if (!isValidSubmission(found.submission)) return { ok: false, error: 'Invalid submission data' };

  const sub = found.submission;
  if (maxAgeS && sub.timestamp && Date.now() / 1000 - sub.timestamp > maxAgeS) {
    return { ok: true, skipped: true, reason: 'Older submission, not pushed' };
  }
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
