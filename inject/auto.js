// LeetPush auto mode. Registered on leetcode.com only while Auto mode is on.
// After Submit, LeetCode moves to /problems/<slug>/submissions/<id>/. This script notices that URL
// change through browser events (no timers) and asks the background worker to push. It never sees
// the GitHub token, and shows the result in a small corner toast.

(() => {
  if (window.__leetpushAuto) return;
  window.__leetpushAuto = true;

  const SUBMISSION = /^\/problems\/[^/]+\/submissions\/(\d+)\/?$/;
  const handled = new Set();
  let lastPath = '';

  async function checkUrl() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    const m = SUBMISSION.exec(lastPath);
    if (!m || handled.has(m[1])) return;
    handled.add(m[1]);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'auto-push', submissionId: m[1] });
    } catch {
      return; // extension reloaded or Auto mode turned off
    }
    if (!res || res.skipped) return;
    console.info('[LeetPush]', res.ok ? res.commitUrl : res.error);
    if (res.ok) toast(res.unchanged ? 'No changes since the last push' : 'Pushed to GitHub', 'success', res.commitUrl);
    else toast(res.error || 'Push to GitHub failed', 'error');
  }

  if (window.navigation) {
    window.navigation.addEventListener('currententrychange', checkUrl); // pushState / replaceState
    window.navigation.addEventListener('navigatesuccess', checkUrl);
  }
  addEventListener('popstate', checkUrl);
  checkUrl();

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
        .dot{width:8px;height:8px;border-radius:50%;flex:none;background:#5fc28a}
        .error .dot{background:#e5604f}
        a{color:#f0a85a;text-decoration:none;font-weight:600;margin-left:auto;white-space:nowrap}
        b{font-weight:650}
      </style><div class="t"><span class="dot"></span><span><b>LeetPush</b> · <span class="msg"></span></span><a target="_blank" rel="noopener">View commit</a></div>`;
      host.__root = root;
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
    hideTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 8000 : 5000);
  }
})();
