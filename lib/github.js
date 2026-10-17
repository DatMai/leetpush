// GitHub REST API calls. All files of a submission go into a single commit through the Git Data API
// (create tree → create commit → move the branch) instead of one commit per file.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function gh(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new GitHubError(explain(res.status, data && data.message), res.status);
  return data;
}

function explain(status, message) {
  if (status === 401) return 'The GitHub token is invalid or expired';
  if (status === 403 && /not accessible by personal access token/i.test(message || '')) {
    return 'The token has no write access to this repository. On GitHub, edit the token, add this repository and give it Contents: Read and write';
  }
  if (status === 403) return `GitHub refused the request: ${message || 'missing permission'}`;
  if (status === 404) return 'Repository not found, or the token has no access to it';
  return message || `GitHub returned error ${status}`;
}

export function parseRepo(input) {
  const s = String(input || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (!m) throw new GitHubError('Repository must look like owner/name', 0);
  return { owner: m[1], name: m[2] };
}

export async function verifyRepo(token, repoInput) {
  const { owner, name } = parseRepo(repoInput);
  const user = await gh(token, '/user');
  const repo = await gh(token, `/repos/${owner}/${name}`);
  if (repo.permissions && !repo.permissions.push) {
    throw new GitHubError('The token is read-only for this repository; it needs Contents: Read and write', 403);
  }
  return {
    login: user.login,
    repo: repo.full_name,
    branch: repo.default_branch || 'main',
    htmlUrl: repo.html_url,
    private: repo.private,
  };
}

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function headSha(token, base, branch) {
  try {
    const ref = await gh(token, `${base}/git/ref/heads/${encodePath(branch)}`);
    return ref.object.sha;
  } catch (e) {
    if (e.status === 409 || e.status === 404) return null; // empty repository, no commits yet
    throw e;
  }
}

export async function pushFiles({ token, repo, branch, files, message }) {
  const { owner, name } = parseRepo(repo);
  const base = `/repos/${owner}/${name}`;

  let parent = await headSha(token, base, branch);
  if (!parent) {
    // the Git Data API does not work on an empty repository: create the first commit with the Contents API
    await gh(token, `${base}/contents/README.md`, {
      method: 'PUT',
      body: {
        message: 'Initialize LeetCode solutions\n\nPushed by LeetPush',
        content: base64('# LeetCode solutions\n\nEvery accepted submission is pushed here automatically by LeetPush.\n'),
      },
    });
    const info = await gh(token, base);
    branch = info.default_branch || branch;
    parent = await headSha(token, base, branch);
    if (!parent) throw new GitHubError('Could not initialize the empty repository', 0);
  }

  for (let attempt = 0; ; attempt++) {
    const head = await gh(token, `${base}/git/commits/${parent}`);
    const tree = await gh(token, `${base}/git/trees`, {
      method: 'POST',
      body: {
        base_tree: head.tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      },
    });
    if (tree.sha === head.tree.sha) return { unchanged: true, commitUrl: head.html_url, sha: parent, branch };
    const commit = await gh(token, `${base}/git/commits`, {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [parent] },
    });
    try {
      await gh(token, `${base}/git/refs/heads/${encodePath(branch)}`, { method: 'PATCH', body: { sha: commit.sha } });
      return { unchanged: false, commitUrl: commit.html_url, sha: commit.sha, branch };
    } catch (e) {
      // another commit landed on the branch (422 non-fast-forward): reload the head and retry once
      if (e.status !== 422 || attempt > 0) throw e;
      parent = await headSha(token, base, branch);
    }
  }
}
