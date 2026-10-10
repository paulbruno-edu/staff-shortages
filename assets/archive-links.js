/* Adds a small "(archived)" link after every cited source that has a Wayback Machine copy
   in data/archive.json (made by scripts/archive_sources.py). Both pages build their source
   lists after loading data, so new links are picked up as they appear. DOI links are skipped:
   DOIs are designed to keep resolving. If archive.json is missing, nothing changes. */
(async function () {
  let map;
  try {
    const r = await fetch('data/archive.json');
    if (!r.ok) return;
    map = (await r.json()).links || {};
  } catch (e) {
    return;
  }
  const decorate = (a) => {
    if (a.dataset.arch || a.classList.contains('arch')) return;
    const e = map[a.getAttribute('href')];
    if (!e || !e.archive_url || /(^|\.)doi\.org$/.test(a.hostname)) return;
    a.dataset.arch = '1';
    const link = document.createElement('a');
    link.href = e.archive_url;
    link.className = 'arch';
    link.rel = 'noopener';
    link.textContent = 'archived';
    link.title = `Internet Archive copy${e.archived ? `, ${e.archived}` : ''}`;
    a.after(document.createTextNode(' ('), link, document.createTextNode(')'));
  };
  const scan = (root) => root.querySelectorAll('a[href^="http"]').forEach(decorate);
  scan(document);
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    if (n.matches('a[href^="http"]')) decorate(n);
    scan(n);
  }))).observe(document.body, { childList: true, subtree: true });
})();
