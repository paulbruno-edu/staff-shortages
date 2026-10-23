/* Visitor counts with GoatCounter (https://www.goatcounter.com): no cookies and
   no personal data. Counts page views, plus two kinds of events: chart CSV
   downloads and clicks on links to other sites (mostly cited sources).
   GoatCounter does not count visits from localhost. */
(() => {
  'use strict';
  const CODE = 'shortages';
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
  document.head.append(s);

  const count = (path, title) => {
    if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path, title, event: true });
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.hasAttribute('download')) count(`download/${a.getAttribute('download')}`, 'Chart data download');
    else if (/^https?:$/.test(a.protocol) && a.host !== location.host) count(a.href, a.textContent.trim().slice(0, 100) || a.host);
  });
})();
