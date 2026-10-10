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
    ['JTSJOR', 'FRED', 'All-sector job openings rate (%)', 'Tiles, summary, main chart, ratio chart'],
    ['JTSJOL', 'FRED', 'All-sector job openings level (thousands)', 'Openings per unemployed'],
    ['JTSHIR', 'FRED', 'All-sector hires rate (%)', 'Main chart (hires)'],
    ['JTSQUR', 'FRED', 'All-sector quits rate (%)', 'Tiles, main chart (quits)'],
    ['JTSLDR', 'FRED', 'All-sector layoffs & discharges rate (%)', 'Main chart (layoffs)'],
    ['UNEMPLOY', 'FRED', 'Unemployed persons (thousands), from the Current Population Survey', 'Openings per unemployed'],
    ['UNRATE', 'FRED', 'Unemployment rate (%)', 'Downloadable data only'],
    ['PAYEMS', 'FRED', 'Total nonfarm employment (thousands), CES', 'Employment index'],
    ['CES9093161101', 'FRED', 'Local government education employment (thousands), CES', 'Employment index; composition model'],
    ['CES9092161101', 'FRED', 'State government education employment (thousands), CES', 'Employment index; composition model'],
    ['SLED_JOR', 'BLS API', 'State & local education openings rate (%): JTS923000000000000JOR', 'Tiles, summary, main chart'],
    ['SLED_JOL', 'BLS API', 'State & local education openings level: JTS923000000000000JOL', 'Composition model'],
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
    $('#stamp').textContent = `National data generated ${N.generated_utc} (latest month ${mlab(N.latest_month)}). State data verified ${S.verified || S.updated}. Inventory as of ${I ? I.as_of : 'n/a'}.`;

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
      const SHORT = { included: 'on the dashboard', candidate: 'candidates not yet added', counts: 'counts only', different: 'a different measure', none: 'no statewide data' };
      const counts = order.map((c) => `${I.states.filter((s) => s.category === c).length} ${SHORT[c] || c}`);
      $('#inv-lede').replaceChildren(document.createTextNode(`Every state and DC, classified by what vacancy data it publishes (as of ${I.as_of}): ${counts.join('; ')}. "Checked" says whether this project read the primary source ("direct"), relied on the `), el('a', { href: I.base_source.url, text: I.base_source.label }), document.createTextNode(' ("lpi"), or could only reach news or third-party coverage ("secondary").'));
      const rows = [...I.states].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.state.localeCompare(b.state));
      $('#inv-table').append(
        el('thead', {}, el('tr', {}, ['State', 'Status', 'What is published', 'Why it is or is not on the dashboard', 'Checked'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, rows.map((s) => el('tr', {}, el('th', { scope: 'row', text: s.state }), el('td', { text: I.categories[s.category] }), el('td', { text: s.what || 'No statewide vacancy data' }), el('td', { text: s.reason || '' }), el('td', { text: s.checked })))));
    }
  }
  boot();
})();
