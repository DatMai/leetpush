// Run: node --test 'tests/*.test.mjs'
// The GitHub API is faked with a stub fetch, so no real token is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFiles, commitMessage, problemFolder, cleanFolder } from '../lib/format.js';
import { pushFiles, parseRepo, verifyRepo } from '../lib/github.js';

const sub = {
  runtimeDisplay: '0 ms', runtimePercentile: 100, memoryDisplay: '17.8 MB', memoryPercentile: 55.31,
  code: 'class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n', timestamp: 1760000000, statusCode: 10, notes: '',
  lang: { name: 'python3', verboseName: 'Python3' },
  question: {
    questionId: '1', questionFrontendId: '1', title: 'Two Sum', titleSlug: 'two-sum',
    content: '<p>Given an array of integers…</p>', difficulty: 'Easy',
    topicTags: [{ name: 'Array', slug: 'array' }, { name: 'Hash Table', slug: 'hash-table' }],
  },
};

test('folder and file names', () => {
  assert.equal(problemFolder(sub, ''), '0001-two-sum');
  assert.equal(problemFolder(sub, '/leetcode/'), 'leetcode/0001-two-sum');
  assert.equal(cleanFolder('../a/./b//'), 'a/b');
  const files = buildFiles(sub, 'lc');
  assert.deepEqual(files.map((f) => f.path), ['lc/0001-two-sum/README.md', 'lc/0001-two-sum/two-sum.py']);
  assert.match(files[0].content, /^# \[1\. Two Sum\]\(https:\/\/leetcode\.com\/problems\/two-sum\/\)/);
  assert.match(files[0].content, /`Array` `Hash Table`/);
  assert.match(files[0].content, /beats 100\.0%/);
  assert.ok(files[1].content.endsWith('\n'));
});

test('adds NOTES.md when there are notes, .txt for unknown languages', () => {
  const files = buildFiles({ ...sub, notes: 'use a hash map', lang: { name: 'cobol', verboseName: 'COBOL' } }, '');
  assert.deepEqual(files.map((f) => f.path), ['0001-two-sum/README.md', '0001-two-sum/two-sum.txt', '0001-two-sum/NOTES.md']);
});

test('commit message', () => {
  assert.match(commitMessage(sub), /^1\. Two Sum \(Easy\)\n\nRuntime 0 ms/);
});

test('parseRepo accepts several formats', () => {
  assert.deepEqual(parseRepo('DatMai/leetcode'), { owner: 'DatMai', name: 'leetcode' });
  assert.deepEqual(parseRepo('https://github.com/DatMai/leetcode.git'), { owner: 'DatMai', name: 'leetcode' });
  assert.throws(() => parseRepo('leetcode'));
});

// ---- fake GitHub

function fakeGitHub({ empty = false, raceOnce = false, readOnly = false } = {}) {
  const calls = [];
  let head = empty ? null : 'c0';
  let raced = false;
  const commits = { c0: { sha: 'c0', tree: { sha: 't0' }, html_url: 'https://github.com/o/r/commit/c0' } };
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = url.replace('https://api.github.com', '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push(`${method} ${path}`);
    assert.equal(opts.headers.Authorization, 'Bearer TEST');
    const json = (status, data) => ({ ok: status < 300, status, text: async () => JSON.stringify(data) });

    if (path === '/user') return json(200, { login: 'DatMai' });
    if (path === '/repos/o/r' && method === 'GET') {
      return json(200, { full_name: 'o/r', default_branch: 'main', html_url: 'https://github.com/o/r', private: false, permissions: { push: !readOnly } });
    }
    if (path === '/repos/o/r/git/ref/heads/main') {
      return head ? json(200, { object: { sha: head } }) : json(409, { message: 'Git Repository is empty.' });
    }
    if (path === '/repos/o/r/contents/README.md' && method === 'PUT') {
      head = 'c0';
      return json(201, {});
    }
    if (path.startsWith('/repos/o/r/git/commits/')) return json(200, commits[path.split('/').pop()]);
    if (path === '/repos/o/r/git/trees') {
      assert.equal(body.base_tree, commits[head].tree.sha);
      return json(201, { sha: 't-' + body.tree.map((t) => t.path).join('+') });
    }
    if (path === '/repos/o/r/git/commits' && method === 'POST') {
      const sha = 'c' + (Object.keys(commits).length);
      commits[sha] = { sha, tree: { sha: body.tree }, html_url: `https://github.com/o/r/commit/${sha}` };
      assert.deepEqual(body.parents, [head]);
      return json(201, commits[sha]);
    }
    if (path === '/repos/o/r/git/refs/heads/main' && method === 'PATCH') {
      if (raceOnce && !raced) {
        raced = true;
        commits.cX = { sha: 'cX', tree: { sha: 'tX' }, html_url: '' };
        head = 'cX';
        return json(422, { message: 'Update is not a fast forward' });
      }
      head = body.sha;
      return json(200, {});
    }
    return json(404, { message: 'Not Found' });
  };
  return { calls, head: () => head };
}

test('all files land in a single commit', async () => {
  const gh = fakeGitHub();
  const res = await pushFiles({ token: 'TEST', repo: 'o/r', branch: 'main', files: buildFiles(sub, ''), message: commitMessage(sub) });
  assert.equal(res.unchanged, false);
  assert.equal(res.commitUrl, `https://github.com/o/r/commit/${gh.head()}`);
  assert.equal(gh.calls.filter((c) => c === 'POST /repos/o/r/git/commits').length, 1);
  assert.equal(gh.calls.filter((c) => c.startsWith('PATCH')).length, 1);
});

test('empty repository: first commit via the Contents API, then push', async () => {
  const gh = fakeGitHub({ empty: true });
  const res = await pushFiles({ token: 'TEST', repo: 'o/r', branch: 'main', files: buildFiles(sub, ''), message: 'm' });
  assert.equal(res.unchanged, false);
  assert.ok(gh.calls.includes('PUT /repos/o/r/contents/README.md'));
});

test('branch moved underneath: reload head and retry', async () => {
  const gh = fakeGitHub({ raceOnce: true });
  await pushFiles({ token: 'TEST', repo: 'o/r', branch: 'main', files: buildFiles(sub, ''), message: 'm' });
  assert.equal(gh.calls.filter((c) => c.startsWith('PATCH')).length, 2);
  assert.notEqual(gh.head(), 'cX');
});

test('verifyRepo rejects a read-only token', async () => {
  fakeGitHub({ readOnly: true });
  await assert.rejects(verifyRepo('TEST', 'o/r'), /read-only/);
  fakeGitHub();
  const info = await verifyRepo('TEST', 'https://github.com/o/r');
  assert.equal(info.login, 'DatMai');
  assert.equal(info.branch, 'main');
});

test('explains a token that lacks access to the repository', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ message: 'Resource not accessible by personal access token' }) });
  await assert.rejects(pushFiles({ token: 'TEST', repo: 'o/r', branch: 'main', files: [], message: 'm' }), /edit the token, add this repository/);
});
