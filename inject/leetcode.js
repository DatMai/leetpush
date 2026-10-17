// LeetPush: content script on leetcode.com.
// The background worker tells this script when a submission starts being judged. The script waits
// for the result through LeetCode's GraphQL API and, if it is Accepted, hands the details (code,
// statement, difficulty, runtime...) to the background worker to push.
// The GitHub token lives only in the background worker; this script never sees it.

(() => {
  if (window.__leetpushContent) return;
  window.__leetpushContent = true;

  const DETAILS_QUERY = `query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    runtimeDisplay runtimePercentile memoryDisplay memoryPercentile
    code timestamp statusCode notes
    lang { name verboseName }
    question {
      questionId questionFrontendId title titleSlug content difficulty
      topicTags { name slug }
    }
  }
}`;

  const handled = new Set();

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'submission-started') return;
    const id = String(msg.submissionId);
    if (!/^\d+$/.test(id) || handled.has(id)) return;
    handled.add(id);
    handleSubmission(id);
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchDetails(id) {
    const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
    const res = await fetch('/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrftoken': csrf } : {}) },
      body: JSON.stringify({ operationName: 'submissionDetails', query: DETAILS_QUERY, variables: { submissionId: Number(id) } }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json && json.data && json.data.submissionDetails) || null;
  }

  const MAX_AGE_S = 15 * 60;

  async function handleSubmission(id) {
    // wait until the judge has finished: details only carry a status code once judged
    let sub = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(attempt < 5 ? 1500 : 3000);
      try {
        sub = await fetchDetails(id);
      } catch {
        sub = null;
      }
      if (sub && sub.code && typeof sub.statusCode === 'number' && sub.statusCode !== 0) break;
    }
    if (!sub || !sub.code || typeof sub.statusCode !== 'number') return;
    if (sub.statusCode !== 10) return; // not accepted
    if (sub.timestamp && Date.now() / 1000 - sub.timestamp > MAX_AGE_S) return; // an old submission
    toast('Pushing to GitHub…', 'info');
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'push', submissionId: id, submission: sub });
    } catch (e) {
      res = { ok: false, error: String(e && e.message || e) };
    }
    if (!res) return;
    if (res.ok && res.skipped) toast(res.reason || 'Already pushed', 'info');
    else if (res.ok) toast(res.unchanged ? 'No changes since the last push' : 'Pushed to GitHub', 'success', res.commitUrl);
    else toast(res.error || 'Push to GitHub failed', 'error');
  }

  // ---------------------------------------------------------------- corner toast

  let host = null;
  let hideTimer = 0;

  function toast(text, kind, link) {
    if (!document.body) return;
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>
        .t{display:flex;align-items:center;gap:10px;max-width:340px;padding:10px 14px;border-radius:10px;
          background:#17191c;color:#e6e4e0;border:1px solid #2e3238;box-shadow:0 8px 24px rgba(0,0,0,.35);
          font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;opacity:0;transform:translateY(8px);
          transition:opacity .18s,transform .18s}
        .t.show{opacity:1;transform:none}
        .dot{width:8px;height:8px;border-radius:50%;flex:none;background:#f0a85a}
        .success .dot{background:#5fc28a}.error .dot{background:#e5604f}
        a{color:#f0a85a;text-decoration:none;font-weight:600;margin-left:auto;white-space:nowrap}
        b{font-weight:650}
      </style><div class="t"><span class="dot"></span><span><b>LeetPush</b> · <span class="msg"></span></span><a target="_blank" rel="noopener">View commit</a></div>`;
      host.__root = root;
      document.body.appendChild(host);
    }
    if (!host.isConnected) document.body.appendChild(host);
    const t = host.__root.querySelector('.t');
    t.className = `t ${kind}`;
    t.querySelector('.msg').textContent = text;
    const a = t.querySelector('a');
    a.style.display = link ? '' : 'none';
    if (link) a.href = link;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(hideTimer);
    if (kind !== 'info') hideTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 8000 : 5000);
  }
})();
