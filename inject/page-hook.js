// LeetPush: runs in the page's MAIN world so it can see LeetCode's own responses.
//
// On Submit, LeetCode calls POST /problems/<slug>/submit/ (returns submission_id) and then polls
// GET /submissions/detail/<id>/check/ until state = SUCCESS. This script only reads clones of those
// responses and tells the content script when a submission is Accepted. Nothing is sent anywhere.
// "Run" uses ids like runcode_..., which are not numeric, so test runs are ignored.

(() => {
  if (window.__leetpushHook) return;
  window.__leetpushHook = true;

  const SUBMIT = /\/problems\/([^/]+)\/submit\/?$/;
  const CHECK = /\/submissions\/detail\/(\d+)\/check\/?$/;
  const slugs = new Map(); // submission_id → slug
  const reported = new Set();

  function inspect(url, data) {
    if (!data || typeof data !== 'object') return;
    let path;
    try {
      path = new URL(url, location.href).pathname;
    } catch {
      return;
    }
    const submit = SUBMIT.exec(path);
    if (submit && data.submission_id) {
      slugs.set(String(data.submission_id), submit[1]);
      return;
    }
    const check = CHECK.exec(path);
    if (!check || data.state !== 'SUCCESS') return;
    const id = check[1];
    if (reported.has(id)) return;
    reported.add(id);
    if (data.status_code !== 10 && data.status_msg !== 'Accepted') return;
    window.postMessage(
      { source: 'leetpush', type: 'accepted', submissionId: id, slug: slugs.get(id) || null },
      location.origin,
    );
  }

  const interesting = (url) => /\/(submit|check)\/?(\?|$)/.test(url);

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (interesting(url)) res.clone().json().then((d) => inspect(url, d), () => {});
    } catch {
      // never break the page's own request
    }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (interesting(String(url))) {
        this.addEventListener('load', () => {
          try {
            const body = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
            inspect(String(url), body);
          } catch {
            // not a JSON response
          }
        });
      }
    } catch {
      // ignore
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
