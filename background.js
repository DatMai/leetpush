// LeetPush: service worker. Holds the GitHub token, receives submissions and pushes them.

import { buildFiles, commitMessage } from './lib/format.js';
import { pushFiles, verifyRepo } from './lib/github.js';

const LEETCODE = 'https://leetcode.com';

// storage.local holds only settings plus two small records, nothing that grows over time:
//   { token, repo, branch, login, repoUrl, folder, enabled,
//     last: {num, title, difficulty, ts, commitUrl},   // the latest successful push
//     lastError: {message, ts}, failed: {...} }         // only while a push needs a retry
// Pushing the same submission twice is harmless: identical files produce no new commit.

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
  const cfg = await chrome.storage.local.get(['token', 'repo', 'branch', 'folder', 'enabled']);
  if (!cfg.enabled) return { ok: true, skipped: true, reason: 'Auto-push is turned off' };
  if (!cfg.token || !cfg.repo) return { ok: false, error: 'GitHub is not connected. Open the LeetPush popup to connect' };
  if (!isValidSubmission(sub)) return { ok: false, error: 'Invalid submission data' };

  try {
    const result = await pushFiles({
      token: cfg.token,
      repo: cfg.repo,
      branch: cfg.branch || 'main',
      files: buildFiles(sub, cfg.folder),
      message: commitMessage(sub),
    });
    await recordSuccess(sub, result);
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

async function recordSuccess(sub, result) {
  const q = sub.question;
  await chrome.storage.local.set({
    last: { num: q.questionFrontendId || q.questionId, title: q.title, difficulty: q.difficulty, ts: Date.now(), commitUrl: result.commitUrl },
    lastError: null,
    failed: null,
  });
  // clean up keys written by earlier versions
  await chrome.storage.local.remove(['solved', 'history', 'days', 'pushedIds']);
}

let badgeTimer = 0;
function flashBadge(text, color, ms = 4000) {
  clearTimeout(badgeTimer);
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  if (ms) badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), ms);
}
