// Shows a small corner toast on the LeetCode page. Injected with chrome.scripting only while a push
// is running, so nothing stays on the page otherwise. Must stay self-contained: Chrome serializes it.

export function showToast(text, kind, link) {
  let host = window.__leetpushToast;
  if (!host) {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .t{display:flex;align-items:center;gap:10px;max-width:360px;padding:10px 14px;border-radius:10px;
        background:#17191c;color:#e6e4e0;border:1px solid #2e3238;box-shadow:0 8px 24px rgba(0,0,0,.35);
        font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;opacity:0;transform:translateY(8px);
        transition:opacity .18s,transform .18s}
      .t.show{opacity:1;transform:none}
      .dot{width:8px;height:8px;border-radius:50%;flex:none;background:#f0a85a}
      .info .dot{animation:p 1s ease-in-out infinite}
      .success .dot{background:#5fc28a}.error .dot{background:#e5604f}.muted .dot{background:#8d939b}
      @keyframes p{50%{opacity:.3}}
      a{color:#f0a85a;text-decoration:none;font-weight:600;margin-left:auto;white-space:nowrap}
      b{font-weight:650}
    </style><div class="t"><span class="dot"></span><span><b>LeetPush</b> · <span class="msg"></span></span><a target="_blank" rel="noopener">View commit</a></div>`;
    window.__leetpushToast = host;
  }
  if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
  const t = host.shadowRoot.querySelector('.t');
  t.className = `t ${kind}`;
  t.querySelector('.msg').textContent = text;
  const a = t.querySelector('a');
  a.style.display = link ? '' : 'none';
  if (link) a.href = link;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(host.__hide);
  if (kind !== 'info') {
    host.__hide = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => host.remove(), 300);
    }, kind === 'error' ? 8000 : 5000);
  }
}
