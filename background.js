// LeetPush: service worker. Holds the GitHub token, receives submissions and pushes them.

import { buildFiles, commitMessage } from './lib/format.js';
import { pushFiles, verifyRepo } from './lib/github.js';

const LEETCODE = 'https://leetcode.com';
const MAX_HISTORY = 20;
const MAX_IDS = 300;

// storage.local: { token, repo, branch, login, repoUrl, folder, enabled,
//                  solved: {slug: {...}}, history: [...], days: ['YYYY-MM-DD'], pushedIds: [...],
//                  lastError: {message, ts}, failed: {submissionId, submission} }

// LeetCode polls /submissions/detail/<id>/check/ (now .../v2/check/) while judging a submission.
// Watching it at the browser level works no matter how the page wraps fetch. Only the URL is
// read; the content script in that tab then loads the judged submission over GraphQL.
const seenSubmissions = new Set();
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const m = /^\/submissions\/detail\/(\d+)\/(?:v\d+\/)?check\/?$/.exec(new URL(details.url).pathname);
    if (!m || seenSubmissions.has(m[1])) return;
    seenSubmissions.add(m[1]);
    if (seenSubmissions.size > 500) seenSubmissions.delete(seenSubmissions.values().next().value);
    chrome.tabs.sendMessage(details.tabId, { type: 'submission-started', submissionId: m[1] }).catch(() => {});
  },
  { urls: ['https://leetcode.com/submissions/detail/*'] },
);

chrome.runtime.onInstalled.addListener(async () => {
  const { enabled } = await chrome.storage.local.get('enabled');
  if (enabled === undefined) await chrome.storage.local.set({ enabled: true });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  const fromLeetCode = sender.tab && sender.origin === LEETCODE;
  const fromPopup = !sender.tab && sender.id === chrome.runtime.id;

  let job = null;
  if (msg.type === 'push' && fromLeetCode) job = handlePush(msg.submissionId, msg.submission);
  else if (msg.type === 'connect' && fromPopup) job = connect(msg.token, msg.repo, msg.folder);
  else if (msg.type === 'retry' && fromPopup) job = retryFailed();
  if (!job) return false;
  job.then(sendResponse, (e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
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
    lastError: null,
  });
  return { ok: true, ...info };
}

function isValidSubmission(sub) {
  return sub && typeof sub.code === 'string' && sub.statusCode === 10 && sub.question &&
    typeof sub.question.titleSlug === 'string' && /^[a-z0-9-]+$/.test(sub.question.titleSlug);
}

async function handlePush(submissionId, sub) {
  const cfg = await chrome.storage.local.get(['token', 'repo', 'branch', 'folder', 'enabled', 'pushedIds']);
  if (!cfg.enabled) return { ok: true, skipped: true, reason: 'Auto-push is turned off' };
  if (!cfg.token || !cfg.repo) return { ok: false, error: 'GitHub is not connected. Open the LeetPush popup to connect' };
  if (!isValidSubmission(sub)) return { ok: false, error: 'Invalid submission data' };
  const ids = cfg.pushedIds || [];
  if (ids.includes(String(submissionId))) return { ok: true, skipped: true, reason: 'Already pushed' };

  try {
    const result = await pushFiles({
      token: cfg.token,
      repo: cfg.repo,
      branch: cfg.branch || 'main',
      files: buildFiles(sub, cfg.folder),
      message: commitMessage(sub),
    });
    await recordSuccess(submissionId, sub, result);
    flashBadge('✓', '#2f9e6b');
    return { ok: true, ...result };
  } catch (e) {
    await chrome.storage.local.set({
      lastError: { message: e.message || String(e), ts: Date.now() },
      failed: { submissionId: String(submissionId), submission: sub },
    });
    flashBadge('!', '#d9473a', 0);
    return { ok: false, error: e.message || String(e) };
  }
}

async function retryFailed() {
  const { failed } = await chrome.storage.local.get('failed');
  if (!failed) return { ok: false, error: 'Nothing to retry' };
  return handlePush(failed.submissionId, failed.submission);
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function recordSuccess(submissionId, sub, result) {
  const s = await chrome.storage.local.get(['solved', 'history', 'days', 'pushedIds']);
  const q = sub.question;
  const now = Date.now();
  const solved = s.solved || {};
  solved[q.titleSlug] = {
    num: q.questionFrontendId || q.questionId,
    title: q.title,
    difficulty: q.difficulty,
    lang: sub.lang && sub.lang.verboseName,
    ts: now,
  };
  const history = [
    { num: q.questionFrontendId || q.questionId, title: q.title, difficulty: q.difficulty, ts: now, commitUrl: result.commitUrl },
    ...(s.history || []),
  ].slice(0, MAX_HISTORY);
  const days = [...new Set([...(s.days || []), dayKey(now)])].slice(-400);
  const pushedIds = [...(s.pushedIds || []), String(submissionId)].slice(-MAX_IDS);
  await chrome.storage.local.set({ solved, history, days, pushedIds, lastError: null, failed: null });
}

let badgeTimer = 0;
function flashBadge(text, color, ms = 4000) {
  clearTimeout(badgeTimer);
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  if (ms) badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), ms);
}
