/* Data provenance page: renders source tables from the same data files the
   dashboard reads, so the documentation cannot drift from the data. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mlab = (m) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

  // Series retrieved by scripts/fetch_national.py, and where each appears.
  const NATIONAL = [
    ['JTSJOR', 'BLS API', 'All-sector job openings rate (%): JTS000000000000000JOR', 'Tiles, summary, main chart, ratio chart'],
    ['JTSJOL', 'BLS API', 'All-sector job openings level (thousands): JTS000000000000000JOL', 'Openings per unemployed'],
    ['JTSHIR', 'BLS API', 'All-sector hires rate (%): JTS000000000000000HIR', 'Main chart (hires)'],
    ['JTSQUR', 'BLS API', 'All-sector quits rate (%): JTS000000000000000QUR', 'Tiles, main chart (quits)'],
    ['JTSLDR', 'BLS API', 'All-sector layoffs & discharges rate (%): JTS000000000000000LDR', 'Main chart (layoffs)'],
    ['UNEMPLOY', 'BLS API', 'Unemployed persons (thousands), Current Population Survey: LNS13000000', 'Openings per unemployed'],
    ['UNRATE', 'BLS API', 'Unemployment rate (%): LNS14000000', 'Downloadable data only'],
    ['PAYEMS', 'BLS API', 'Total nonfarm employment (thousands), CES: CES0000000001', 'Employment index'],
    ['CES9093161101', 'BLS API', 'Local government education employment (thousands), CES: CES9093161101', 'Employment index'],
    ['CES9092161101', 'BLS API', 'State government education employment (thousands), CES: CES9092161101', 'Employment index'],
    ['SLED_JOR', 'BLS API', 'State & local education openings rate (%): JTS923000000000000JOR', 'Tiles, summary, main chart'],
    ['SLED_JOL', 'BLS API', 'State & local education openings level: JTS923000000000000JOL', 'Downloadable data only'],
    ['SLED_HIR', 'BLS API', 'State & local education hires rate: JTS923000000000000HIR', 'Main chart (hires)'],
    ['SLED_QUR', 'BLS API', 'State & local education quits rate: JTS923000000000000QUR', 'Tiles, main chart (quits)'],
    ['SLED_LDR', 'BLS API', 'State & local education layoffs & discharges rate: JTS923000000000000LDR', 'Main chart (layoffs)'],
    ['SLXED_JOR', 'BLS API', 'State & local government excluding education, openings rate: JTS929000000000000JOR (also HIR, QUR, LDR, JOL)', 'Main chart'],
  ];

  async function boot() {
    let N, S, P, I;
    try {
      [N, S, P, I] = await Promise.all([get('data/national.json'), get('data/states.json'), get('data/spp.json').catch(() => null), get('data/state_inventory.json').catch(() => null)]);
    } catch (e) {
      $('#stamp').textContent = `Could not load data (${e.message}).`;
      return;
    }
    $('#stamp').textContent = `National data generated ${N.generated_utc} (latest month ${mlab(N.latest_month)}). State data updated ${S.updated}. Inventory as of ${I ? I.as_of : 'n/a'}.`;

    // National table, with the latest value actually in the file.
    const nt = $('#national-table');
    const lastOf = (k) => { const v = N.series[k] || []; for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return [N.months[i], v[i]]; return null; };
    nt.append(
      el('thead', {}, el('tr', {}, ['Series', 'Via', 'What it is', 'Used in', 'Latest in file'].map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {},
        NATIONAL.map(([k, via, what, used]) => { const l = lastOf(k); return el('tr', {}, el('th', { scope: 'row' }, el('code', { text: k })), el('td', { text: via }), el('td', { text: what }), el('td', { text: used }), el('td', { class: 'num', text: l ? `${l[1]} (${mlab(l[0])})` : '–' })); }),
        el('tr', {}, el('th', { scope: 'row' }, el('code', { text: 'JTU…JOR (Oct)' })), el('td', { text: 'BLS API' }), el('td', { text: 'October openings rates, not seasonally adjusted: JTU923000000000000JOR (state & local education), JTU000000000000000JOR (all sectors)' }), el('td', { text: 'State panels (gray lines), state table' }),
          el('td', { class: 'num', text: N.october_nsa.length ? `${N.october_nsa[N.october_nsa.length - 1].sled_nsa} / ${N.october_nsa[N.october_nsa.length - 1].total_nsa} (Oct ${N.october_nsa[N.october_nsa.length - 1].year})` : '–' })),
        el('tr', {}, el('th', { scope: 'row' }, el('code', { text: 'JTS<industry>…' })), el('td', { text: 'BLS API' }), el('td', { text: `Openings level and openings, hires, quits, layoffs rates for ${N.industries.length} industries` }), el('td', { text: 'Industry chart' }), el('td', { class: 'num', text: mlab(N.industry_month) })),
      ));

    // SPP status line.
    if (P) {
      const t = P.roles.find((r) => r.var === 'PCTVAC1TOT_oct');
      $('#spp-status').textContent = `In the current file (retrieved ${P.generated_utc}): waves ${P.waves.join(', ')}; teaching vacancy rate ${Object.entries(t.values).sort().map(([k, v]) => `${v.pct}% (${mlab(k)}, SE ${v.se})`).join(', ')}.`;
    }

    // State-by-state provenance.
    const fields = [['counted', 'What counts'], ['includes_substitute_covered', 'Substitute or not-fully-qualified coverage'], ['positions', 'Positions'], ['timing', 'When'], ['denominator', 'Denominator'], ['unit', 'Unit'], ['coverage', 'Coverage']];
    const rateText = (p) => {
      if (p.rate_published != null) return [`${p.rate_published}%`, p.basis || 'Published'];
      if (p.unfilled != null && p.filled != null) return [`${(p.unfilled / (p.unfilled + p.filled) * 100).toFixed(2)}%`, 'Computed: unfilled ÷ (filled + unfilled)'];
      if (p.unfilled != null && p.total != null) return [`${(p.unfilled / p.total * 100).toFixed(2)}%`, 'Computed: unfilled ÷ total'];
      return ['–', 'No rate'];
    };
    const fmt = (v) => (v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 3 }));
    const blocks = S.states.map((st) => el('article', { class: 'prov-state', id: `state-${st.id}` },
      el('h3', { text: st.name }),
      el('p', { class: 'small', text: `${st.agency}. Comparability group: ${S.tiers[st.tier].label}.` }),
      el('p', { class: 'verify' }, el('strong', { text: 'Verification. ' }), st.verification || ''),
      el('dl', { class: 'prov-dl' }, fields.flatMap(([k, h]) => [el('dt', { text: h }), el('dd', { text: st.measure[k] || '–' })])),
      el('p', { text: st.definition }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, ['School year (plotted)', "Agency's label", 'Unfilled', 'Filled', 'Total', 'Rate', 'Basis', 'Note'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, st.points.map((p) => { const [r, b] = rateText(p); return el('tr', {}, el('th', { scope: 'row', text: p.sy }), el('td', { text: p.agency_label || p.sy }), el('td', { class: 'num', text: fmt(p.unfilled) }), el('td', { class: 'num', text: fmt(p.filled) }), el('td', { class: 'num', text: fmt(p.total) }), el('td', { class: 'num', text: r }), el('td', { text: b }), el('td', { class: 'small', text: p.note || '' })); })))),
      el('p', { class: 'small' }, 'Sources: ', ...st.sources.flatMap((s, i) => [i ? ' · ' : '', el('a', { href: s.url, rel: 'noopener', text: s.label })])),
    ));
    const ne = S.nebraska;
    blocks.push(el('article', { class: 'prov-state', id: 'state-NE' },
      el('h3', { text: 'Nebraska' }),
      el('p', { class: 'small', text: `${ne.agency}. Counts only.` }),
      el('p', { class: 'verify' }, el('strong', { text: 'Verification. ' }), ne.verification || ''),
      el('dl', { class: 'prov-dl' }, fields.flatMap(([k, h]) => [el('dt', { text: h }), el('dd', { text: ne.measure[k] || '–' })])),
      el('p', { text: ne.definition }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, ['School year', 'Vacant', '"Unfilled" (broader)', 'Note'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, ne.years.map((y) => el('tr', {}, el('th', { scope: 'row', text: y.sy }), el('td', { class: 'num', text: fmt(y.vacant) }), el('td', { class: 'num', text: fmt(y.unfilled) }), el('td', { class: 'small', text: y.note || '' })))))),
      el('p', { class: 'small' }, 'Sources: ', ...ne.sources.flatMap((s, i) => [i ? ' · ' : '', el('a', { href: s.url, rel: 'noopener', text: s.label })])),
    ));
    const il = S.illinois_categories;
    blocks.push(el('article', { class: 'prov-state' },
      el('h3', { text: 'Illinois, by position category' }),
      el('p', { text: il.note }),
      el('p', { class: 'verify' }, el('strong', { text: 'Verification. ' }), il.verification || ''),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, ['Category', ...il.years.map((y) => `${y} unfilled / filled`)].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, il.categories.map((c) => el('tr', {}, el('th', { scope: 'row', text: c.name }), c.unfilled.map((u, i) => el('td', { class: 'num', text: `${fmt(u)} / ${fmt(c.filled[i])}` })))))))));
    $('#state-prov').replaceChildren(...blocks);

    // Inventory.
    if (I) {
      const order = Object.keys(I.categories);
      const SHORT = { included: 'on the dashboard', candidate: 'candidates not yet added', counts: 'counts only', different: 'a different measure', collects: 'collect but do not publish', none: 'no statewide data' };
      const counts = order.map((c) => `${I.states.filter((s) => s.category === c).length} ${SHORT[c] || c}`);
      const disagree = I.states.filter((s) => (s.lpi === 'no vacancy data') !== ['none', 'collects'].includes(s.category)).map((s) => s.state);
      $('#inv-lede').replaceChildren(
        document.createTextNode(`Every state and DC, reviewed starting from its own agency's publications (full review completed ${I.full_review}; inventory last updated ${I.as_of}; later checks are recorded in individual entries and the changes log): ${counts.join('; ')}. "Checked" is "direct" when the primary source was read, and "secondary" when some or all of the classification rests on news coverage or a summary, because the primary source could not be read or does not define its terms. "No statewide vacancy data found" means none was found in this review, not that none exists. The `),
        el('a', { href: I.cross_check.url, text: I.cross_check.label }), document.createTextNode(` is used only as a cross-check; this inventory disagrees with its "publishes vacancy data" call for ${disagree.join(', ')}, and splits its other categories more finely.`));
      $('#inv-protocol').replaceChildren(...I.protocol.map((p) => el('li', { text: p.replace(/^\d+\.\s*/, '') })));
      const rows = [...I.states].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.state.localeCompare(b.state));
      const links = (s) => (s.evidence || []).flatMap((e, i) => [i ? ' · ' : '', el('a', { href: e.url, rel: 'noopener', text: e.label })]);
      $('#inv-table').append(
        el('thead', {}, el('tr', {}, ['State', 'Status', 'What is published', 'Why it is or is not on the dashboard', 'Evidence', 'Checked', 'LPI 2026'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, rows.map((s) => el('tr', { id: `inv-${s.state.toLowerCase().replace(/[^a-z]+/g, '-')}` }, el('th', { scope: 'row', text: s.state }), el('td', { text: I.categories[s.category] }), el('td', { text: s.what || 'No statewide vacancy data' }), el('td', { text: s.reason || '' }), el('td', { class: 'small' }, ...links(s)), el('td', { text: s.checked }), el('td', { class: 'small', text: s.lpi || '' })))));
      // Rows are added after the page loads, so a link to one state's row needs scrolling here.
      if (location.hash.startsWith('#inv-')) { const row = document.getElementById(location.hash.slice(1)); if (row) { row.classList.add('is-target'); row.scrollIntoView(); } }
    }
  }
  // Changes log: count correction entries and offer a corrections-only view.
  function changesLog() {
    const box = $('#log-filter');
    if (!box) return;
    const rows = [...document.querySelectorAll('#changes tbody tr')];
    const nFix = rows.filter((r) => r.dataset.type === 'correction').length;
    const btn = el('button', { type: 'button', class: 'link-btn', 'aria-pressed': 'false', text: 'Show corrections only' });
    const set = (only) => {
      rows.forEach((r) => { r.hidden = only && r.dataset.type !== 'correction'; });
      btn.setAttribute('aria-pressed', String(only)); btn.textContent = only ? 'Show all entries' : 'Show corrections only';
    };
    btn.addEventListener('click', () => set(btn.getAttribute('aria-pressed') !== 'true'));
    // A link to an update entry shows it even when the filter is on.
    window.addEventListener('hashchange', () => { const t = document.getElementById(location.hash.slice(1)); if (t && t.hidden) set(false); });
    box.replaceChildren(`${nFix} correction entries and ${rows.length - nFix} update entries · `, btn);
    box.hidden = false;
  }
  changesLog();
  boot();
})();
