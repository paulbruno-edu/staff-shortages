/* School Staff Shortages dashboard
   Reads data/national.json (refreshed automatically) and data/states.json
   (curated by hand) and renders every figure and every sentence that quotes
   a number, so the page stays consistent with the data after each refresh. */
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const $ = (sel) => document.querySelector(sel);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const RECESSIONS = [['2001-03', '2001-11'], ['2007-12', '2009-06'], ['2020-02', '2020-04']]; // NBER
  const METRICS = {
    JOR: { name: 'Job openings rate', total: 'JTSJOR', def: 'openings rate is job openings on the last business day of the month ÷ (employment + openings).' },
    HIR: { name: 'Hires rate', total: 'JTSHIR', def: 'hires rate is all hires during the month ÷ employment.' },
    QUR: { name: 'Quits rate', total: 'JTSQUR', def: 'quits rate is voluntary separations during the month ÷ employment.' },
    LDR: { name: 'Layoffs & discharges rate', total: 'JTSLDR', def: 'layoffs & discharges rate is involuntary separations during the month ÷ employment.' },
  };

  // ---------------------------------------------------------------- helpers
  const monthLabel = (m, long) => {
    const [y, mo] = m.split('-');
    return `${(long ? MONTHS_LONG : MONTHS)[+mo - 1]} ${y}`;
  };
  const pct = (v, d = 1) => (v == null || isNaN(v) ? '–' : `${v.toFixed(d)}%`);
  const num = (v, d = 0) => (v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const mean = (arr) => { const a = arr.filter((v) => v != null); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; };
  const lastIdx = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; };

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.setAttribute('style', v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  function svg(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  // Paragraph from parts: strings are text, {b:'..'} is bold. Keeps data out of innerHTML.
  function para(parts, cls) {
    const p = el('p', { class: cls });
    for (const part of parts) p.append(typeof part === 'string' ? document.createTextNode(part) : el('strong', { text: part.b }));
    return p;
  }
  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
    return 10 * mag;
  }
  function csvDownload(name, head, rows) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [head, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
    document.body.append(a); a.click(); a.remove();
  }

  // ---------------------------------------------------------------- tooltip
  const tip = $('#tooltip');
  function showTip(title, rows, note, cx, cy) {
    tip.replaceChildren(el('div', { class: 'tt-title', text: title }));
    for (const r of rows) {
      const key = svg('svg', { width: 14, height: 10, class: 'tt-key' });
      if (r.color) svg('line', { x1: 0, x2: 14, y1: 5, y2: 5, style: `stroke:${r.color};stroke-width:${r.bar ? 8 : 2.5};stroke-linecap:${r.bar ? 'butt' : 'round'}${r.dash ? `;stroke-dasharray:${r.dash}` : ''}` }, key);
      tip.append(el('div', { class: 'tt-row' }, key, el('span', { class: 'tt-val', text: r.value }), el('span', { class: 'tt-name', text: r.name })));
    }
    if (note) tip.append(el('div', { class: 'tt-note', text: note }));
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight, pad = 14;
    let x = cx + pad, y = cy - h - pad;
    if (x + w > window.innerWidth - 8) x = cx - w - pad;
    if (x < 8) x = 8;
    if (y < 8) y = cy + pad;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------------------------------------------------------------- markers
  function marker(parent, shape, x, y, color, opts = {}) {
    const r = opts.r || 4.5;
    const style = opts.hollow
      ? `fill:var(--surface);stroke:${color};stroke-width:2`
      : `fill:${color};stroke:var(--surface);stroke-width:2`;
    let e;
    switch (shape) {
      case 'square': e = svg('rect', { x: x - r + 0.5, y: y - r + 0.5, width: 2 * r - 1, height: 2 * r - 1, rx: 1 }, parent); break;
      case 'triangle': e = svg('path', { d: `M${x},${y - r - 1}L${x + r + 0.5},${y + r - 0.5}L${x - r - 0.5},${y + r - 0.5}Z` }, parent); break;
      case 'tri-down': e = svg('path', { d: `M${x},${y + r + 1}L${x + r + 0.5},${y - r + 0.5}L${x - r - 0.5},${y - r + 0.5}Z` }, parent); break;
      case 'diamond': e = svg('path', { d: `M${x},${y - r - 1}L${x + r + 1},${y}L${x},${y + r + 1}L${x - r - 1},${y}Z` }, parent); break;
      default: e = svg('circle', { cx: x, cy: y, r }, parent);
    }
    e.setAttribute('style', style);
    return e;
  }
  function legendKey(s) {
    const k = svg('svg', { width: 22, height: 12, 'aria-hidden': 'true' });
    if (s.line !== false) svg('line', { x1: 1, x2: 21, y1: 6, y2: 6, style: `stroke:${s.color};stroke-width:${s.width || 2};stroke-linecap:round${s.dash ? `;stroke-dasharray:${s.dash}` : ''}` }, k);
    if (s.marker) marker(k, s.marker, 11, 6, s.color, { r: 3.6, hollow: s.hollow });
    return k;
  }

  // ---------------------------------------------------------------- line chart
  /* cfg: { x:[labels], cat:bool, xTitle:(i)=>str, series:[{id,label,color,values,dash,width,marker,hollow,line,hidden,fmt}],
           yFmt, yTick, yMin:number|'auto', height, bands:[[i0,i1]], refs:[{value,label}], endLabels, legend, toggle,
           tipNote:(i)=>str, rowNote:(s,i)=>str, csv:name, tableNotes:(s,i)=>str } */
  function lineChart(host, cfg) {
    const state = { cfg };
    host.replaceChildren();
    const tools = el('div', { class: 'fig-tools' });
    const legend = cfg.legend !== false && cfg.series.length > 1 ? el('ul', { class: 'legend' }) : null;
    const plot = el('div', { class: 'plot' });
    const tableBox = el('div', { class: 'chart-table', hidden: true });
    if (cfg.tools === false && !legend) host.append(plot, tableBox);
    else host.append(el('div', { class: 'chart-head' }, legend || el('span'), cfg.tools === false ? el('span') : tools), plot, tableBox);

    const btnTable = el('button', { type: 'button', 'aria-pressed': 'false', text: 'Table' });
    btnTable.addEventListener('click', () => {
      const on = tableBox.hidden;
      tableBox.hidden = !on; plot.hidden = on; if (legend) legend.style.visibility = on ? 'hidden' : '';
      btnTable.setAttribute('aria-pressed', String(on));
      btnTable.textContent = on ? 'Chart' : 'Table';
      if (on) buildTable();
    });
    const btnCsv = el('button', { type: 'button', text: 'CSV' });
    btnCsv.addEventListener('click', () => { const t = tableData(); csvDownload(cfg.csv || 'data.csv', t.head, t.rows); });
    tools.append(btnTable, btnCsv);

    function tableData() {
      const c = state.cfg;
      const ser = c.series;
      const head = [c.xHead || 'Period', ...ser.map((s) => s.label)];
      if (c.tableNotes) head.push('Notes');
      const rows = c.x.map((x, i) => {
        const r = [c.xTitle ? c.xTitle(i) : x, ...ser.map((s) => (s.values[i] == null ? '' : +s.values[i].toFixed(c.csvDigits ?? 3)))];
        if (c.tableNotes) r.push(c.tableNotes(i));
        return r;
      });
      return { head, rows };
    }
    function buildTable() {
      const t = tableData();
      const tbl = el('table', { class: 'data' });
      tbl.append(el('thead', {}, el('tr', {}, t.head.map((h, j) => el('th', { class: j > 0 && j <= state.cfg.series.length ? 'num' : null, scope: 'col', text: h })))));
      const tb = el('tbody');
      for (const r of [...t.rows].reverse()) tb.append(el('tr', {}, r.map((v, j) => el(j === 0 ? 'th' : 'td', { class: j > 0 && j <= state.cfg.series.length ? 'num' : null, scope: j === 0 ? 'row' : null, text: v === '' ? '–' : v }))));
      tbl.append(tb);
      tableBox.replaceChildren(tbl);
    }

    function buildLegend() {
      if (!legend) return;
      legend.replaceChildren();
      for (const s of state.cfg.series) {
        const content = [legendKey(s), s.label];
        if (state.cfg.toggle) {
          const b = el('button', { type: 'button', 'aria-pressed': String(!s.hidden) }, ...content);
          b.addEventListener('click', () => { s.hidden = !s.hidden; buildLegend(); draw(); });
          legend.append(el('li', {}, b));
        } else legend.append(el('li', {}, ...content));
      }
    }

    function draw() {
      const c = state.cfg;
      const W = Math.max(280, plot.clientWidth || host.clientWidth);
      const narrow = W < 600;
      const H = Math.round(Math.min(c.height || 320, Math.max(220, W * 0.62)));
      const vis = c.series.filter((s) => !s.hidden);
      const n = c.x.length;

      // y domain
      const vals = vis.flatMap((s) => s.values.filter((v) => v != null));
      (c.refs || []).forEach((r) => vals.push(r.value));
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (c.yMin !== 'auto') lo = Math.min(c.yMin ?? 0, lo);
      const step = niceStep(hi - lo || 1, narrow ? 4 : 5);
      const y0 = c.yMin === 'auto' ? Math.floor(lo / step) * step : Math.min(c.yMin ?? 0, Math.floor(lo / step) * step);
      const y1 = c.yMax != null ? Math.max(c.yMax, Math.ceil(hi / step) * step) : Math.ceil((hi + step * 0.15) / step) * step;
      const yTick = c.yTick || ((v) => `${+v.toFixed(2)}`);

      // end labels (wide screens only)
      const ends = c.endLabels && !narrow
        ? vis.filter((s) => s.line !== false).map((s) => ({ s, i: lastIdx(s.values) })).filter((e) => e.i >= 0)
        : [];
      const endText = (e) => [e.s.short || e.s.label, (e.s.fmt || c.yFmt)(e.s.values[e.i])];
      const charW = 6.9;
      const rightPad = ends.length ? Math.min(210, 18 + Math.max(...ends.map((e) => endText(e).join(' ').length * charW))) : 14;
      const m = { t: 14, r: rightPad, b: 28, l: 12 + Math.max(...[y0, y1].map((v) => yTick(v).length)) * 7 };
      const pw = W - m.l - m.r, ph = H - m.t - m.b;
      const X = (i) => (c.cat ? m.l + ((i + 0.5) * pw) / n : m.l + (n === 1 ? pw / 2 : (i * pw) / (n - 1)));
      const Y = (v) => m.t + ph - ((v - y0) / (y1 - y0)) * ph;

      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': c.aria || '' });

      // recession bands
      for (const [i0, i1] of c.bands || []) {
        const xa = X(i0), xb = X(i1);
        svg('rect', { class: 'band', x: xa, y: m.t, width: Math.max(2, xb - xa), height: ph }, root);
      }
      // grid + y ticks
      const g = svg('g', { class: 'grid' }, root);
      for (let v = y0; v <= y1 + 1e-9; v += step) {
        const yy = Math.round(Y(v)) + 0.5;
        if (Math.abs(v - y0) > 1e-9) svg('line', { x1: m.l, x2: W - m.r + (ends.length ? 0 : 0), y1: yy, y2: yy }, g);
        svg('text', { class: 'tick', x: m.l - 8, y: yy + 4, 'text-anchor': 'end' }, root).textContent = yTick(v);
      }
      svg('line', { class: 'base', x1: m.l, x2: W - m.r, y1: Math.round(Y(y0)) + 0.5, y2: Math.round(Y(y0)) + 0.5 }, root);

      // x ticks
      if (c.cat) {
        const every = Math.ceil((58 * n) / pw);
        c.x.forEach((lab, i) => {
          if (i % every && i !== n - 1) return;
          svg('text', { class: 'tick', x: X(i), y: H - 8, 'text-anchor': 'middle' }, root).textContent = c.xTick ? c.xTick(i) : lab;
        });
      } else {
        const years = [...new Set(c.x.map((d) => +d.slice(0, 4)))];
        const perYear = pw / Math.max(1, n / 12);
        const every = [1, 2, 4, 5, 10].find((k) => k * perYear >= 52) || 10;
        for (const yr of years) {
          if (yr % every) continue;
          const i = c.x.indexOf(`${yr}-01`);
          if (i < 0) continue;
          const xx = Math.round(X(i)) + 0.5;
          svg('line', { class: 'base', x1: xx, x2: xx, y1: Y(y0), y2: Y(y0) + 4 }, root);
          svg('text', { class: 'tick', x: xx, y: H - 8, 'text-anchor': 'middle' }, root).textContent = String(yr);
        }
      }

      // reference lines
      for (const r of c.refs || []) {
        const yy = Math.round(Y(r.value)) + 0.5;
        svg('line', { class: 'ref-line', x1: m.l, x2: W - m.r, y1: yy, y2: yy }, root);
        if (r.label) svg('text', { class: 'ref-label', x: m.l + 6, y: yy - 5 }, root).textContent = r.label;
      }

      // series
      for (const s of vis) {
        const v = s.values;
        if (s.line !== false) {
          let d = '';
          let pen = false;
          v.forEach((val, i) => {
            if (val == null) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(val).toFixed(1)}`;
            pen = true;
          });
          svg('path', { d, fill: 'none', style: `stroke:${s.color};stroke-width:${s.width || 2};stroke-linejoin:round;stroke-linecap:round${s.dash ? `;stroke-dasharray:${s.dash}` : ''}` }, root);
        }
        // markers: always for categorical charts; isolated points for monthly
        v.forEach((val, i) => {
          if (val == null) return;
          const isolated = (i === 0 || v[i - 1] == null) && (i === n - 1 || v[i + 1] == null);
          if (s.marker && c.cat) marker(root, s.marker, X(i), Y(val), s.color, { hollow: s.hollow, r: s.r });
          else if (isolated || (!c.cat && s.line === false)) marker(root, s.marker || 'circle', X(i), Y(val), s.color, { r: 3.5, hollow: s.hollow });
        });
      }

      // end labels with collision handling + leaders
      if (ends.length) {
        const items = ends.map((e) => ({ ...e, y: Y(e.s.values[e.i]), ly: Y(e.s.values[e.i]) })).sort((a, b) => a.y - b.y);
        const gap = 15;
        for (let k = 1; k < items.length; k++) if (items[k].ly - items[k - 1].ly < gap) items[k].ly = items[k - 1].ly + gap;
        const over = items.length ? items[items.length - 1].ly - (m.t + ph) : 0;
        if (over > 0) items.forEach((it) => { it.ly -= over; });
        for (let k = items.length - 2; k >= 0; k--) if (items[k + 1].ly - items[k].ly < gap) items[k].ly = items[k + 1].ly - gap;
        for (const it of items) {
          const x0 = X(it.i);
          const lx = W - m.r + 10;
          if (Math.abs(it.ly - it.y) > 2 || lx - x0 > 14) svg('path', { class: 'leader', d: `M${x0 + 5},${it.y}L${lx - 10},${it.y}L${lx - 3},${it.ly}`, fill: 'none' }, root);
          const t = svg('text', { class: 'end-label', x: lx, y: it.ly + 4 }, root);
          const [name, val] = endText(it);
          svg('tspan', { class: 'v' }, t).textContent = val;
          svg('tspan', {}, t).textContent = ` ${name}`;
        }
      }

      // interaction layer
      const xhair = svg('line', { class: 'xhair', y1: m.t, y2: m.t + ph, visibility: 'hidden' }, root);
      const dots = svg('g', { 'pointer-events': 'none' }, root);
      const hit = svg('rect', { class: 'hit', x: m.l, y: m.t, width: pw, height: ph, tabindex: 0, role: 'slider', 'aria-label': `${c.aria || 'Chart'}: use left and right arrow keys to read values`, 'aria-valuemin': 0, 'aria-valuemax': n - 1 }, root);
      let cur = -1;
      const showAt = (i, cx, cy) => {
        cur = i;
        const xx = X(i);
        xhair.setAttribute('x1', xx); xhair.setAttribute('x2', xx); xhair.setAttribute('visibility', 'visible');
        dots.replaceChildren();
        const rows = [];
        for (const s of vis) {
          const val = s.values[i];
          if (val != null) marker(dots, c.cat ? s.marker || 'circle' : 'circle', xx, Y(val), s.color, { r: c.cat ? 5.5 : 4.5, hollow: s.hollow });
          if (val == null && !(c.rowNote && c.rowNote(s, i))) continue;
          rows.push({ color: s.color, dash: s.dash, value: val == null ? c.rowNote(s, i) : (s.fmt || c.yFmt)(val) + (c.rowTag ? c.rowTag(s, i) : ''), name: s.label, sort: val ?? -Infinity });
        }
        rows.sort((a, b) => b.sort - a.sort);
        hit.setAttribute('aria-valuenow', i);
        hit.setAttribute('aria-valuetext', `${c.xTitle ? c.xTitle(i) : c.x[i]}: ${rows.map((r) => `${r.name} ${r.value}`).join(', ')}`);
        showTip(c.xTitle ? c.xTitle(i) : c.x[i], rows, c.tipNote ? c.tipNote(i) : '', cx, cy);
      };
      const nearest = (px) => {
        let best = 0, bd = Infinity;
        for (let i = 0; i < n; i++) { const d = Math.abs(X(i) - px); if (d < bd) { bd = d; best = i; } }
        return best;
      };
      hit.addEventListener('pointermove', (e) => {
        const r = root.getBoundingClientRect();
        showAt(nearest(((e.clientX - r.left) * W) / r.width), e.clientX, e.clientY);
      });
      const clear = () => { xhair.setAttribute('visibility', 'hidden'); dots.replaceChildren(); hideTip(); };
      hit.addEventListener('pointerleave', clear);
      hit.addEventListener('blur', clear);
      hit.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        let i = cur < 0 ? n - 1 : cur;
        const big = e.shiftKey ? 12 : 1;
        if (e.key === 'ArrowLeft') i = Math.max(0, i - big);
        if (e.key === 'ArrowRight') i = Math.min(n - 1, i + big);
        if (e.key === 'Home') i = 0;
        if (e.key === 'End') i = n - 1;
        const r = root.getBoundingClientRect();
        showAt(i, r.left + (X(i) * r.width) / W, r.top + m.t + 20);
      });
      hit.addEventListener('focus', () => { const r = root.getBoundingClientRect(); const i = cur < 0 ? n - 1 : cur; showAt(i, r.left + (X(i) * r.width) / W, r.top + m.t + 20); });

      plot.replaceChildren(root);
      if (!tableBox.hidden) buildTable();
    }

    buildLegend();
    draw();
    let raf = 0, lastW = 0;
    new ResizeObserver(() => {
      const w = plot.clientWidth;
      if (Math.abs(w - lastW) < 2) return;
      lastW = w;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
    }).observe(plot);

    return {
      update(next) {
        // Keep series visibility across updates (color and visibility follow the entity).
        const hidden = new Set(state.cfg.series.filter((s) => s.hidden).map((s) => s.id));
        next.series.forEach((s) => { if (hidden.has(s.id)) s.hidden = true; });
        state.cfg = next;
        buildLegend(); draw();
      },
    };
  }

  // ---------------------------------------------------------------- horizontal bars (HTML)
  function hbarChart(host, rows, opts) {
    host.replaceChildren();
    const max = opts.max || Math.max(...rows.map((r) => r.value ?? 0)) * 1.12 || 1;
    const grid = el('div', { class: 'hbar' });
    for (const r of rows) {
      const cls = r.highlight ? 'hl' : r.ref ? 'ref' : '';
      grid.append(el('div', { class: `lab ${cls}`, style: r.indent ? `padding-left:${r.indent * 14}px;text-align:left` : null, text: r.label }));
      const track = el('div', { class: 'track' });
      if (opts.refValue != null) track.append(el('div', { class: 'refline', style: `left:${(opts.refValue / max) * 100}%` }));
      const bar = el('div', { class: `bar ${cls}`, tabindex: 0, role: 'img', 'aria-label': `${r.label}: ${opts.fmt(r.value)}`, style: `width:${((r.value ?? 0) / max) * 100}%` });
      const show = (cx, cy) => showTip(r.label, opts.tipRows(r), r.note, cx, cy);
      bar.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      bar.addEventListener('pointerleave', hideTip);
      bar.addEventListener('focus', () => { const b = bar.getBoundingClientRect(); show(b.right, b.top); });
      bar.addEventListener('blur', hideTip);
      track.append(bar, el('span', { class: `val ${cls}`, text: opts.fmt(r.value) }));
      grid.append(track);
    }
    host.append(grid);
  }

  // ---------------------------------------------------------------- page
  let N, S, P, I; // national, state, School Pulse Panel, state inventory

  async function load() {
    const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
    // The SPP and inventory files are optional: the page renders without them.
    const opt = (u) => get(u).catch((e) => { console.warn(e); return null; });
    [N, S, P, I] = await Promise.all([get('data/national.json'), get('data/states.json'), opt('data/spp.json'), opt('data/state_inventory.json')]);
  }

  const ser = (k) => N.series[k];
  const idxOf = (m) => N.months.indexOf(m);
  const avgBetween = (k, a, b) => mean(ser(k).slice(idxOf(a), idxOf(b) + 1));
  function peakOf(k, fromMonth) {
    const v = ser(k); let bi = -1;
    for (let i = Math.max(0, idxOf(fromMonth)); i < v.length; i++) if (v[i] != null && (bi < 0 || v[i] > v[bi])) bi = i;
    return { value: v[bi], month: N.months[bi] };
  }
  const cmpWord = (a, b, tol) => (a - b > tol ? 'above' : b - a > tol ? 'below' : 'close to');

  function renderHeader() {
    const lm = N.latest_month;
    const gen = new Date(N.generated_utc.replace('Z', ':00Z'));
    const genTxt = gen.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const stUpd = new Date(`${S.updated}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    $('#stamp').textContent = `National data through ${monthLabel(lm, true)}${N.latest_preliminary ? ' (preliminary)' : ''}, refreshed ${genTxt}. State data as of ${stUpd}.`;
    $('#build-info').textContent = `National data file generated ${N.generated_utc} (UTC); ${N.months.length} months, ${monthLabel(N.months[0])} to ${monthLabel(lm)}. Industry table: ${monthLabel(N.industry_month)}. State file updated ${S.updated}.`;
    $('#cite-date').textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function renderNow() {
    const L = N.months.length - 1;
    const lm = monthLabel(N.latest_month);
    const tot = ser('JTSJOR')[L];
    const totAvg = avgBetween('JTSJOR', '2015-01', '2019-12');
    const totPeak = peakOf('JTSJOR', '2000-12');
    const vuI = lastIdx(ser('VU'));
    const vu = ser('VU')[vuI];
    const vuAvg = avgBetween('VU', '2015-01', '2019-12');
    const vuPeak = peakOf('VU', '2000-12');
    const ed = ser('SLED_JOR')[L];
    const edAvg = avgBetween('SLED_JOR', '2015-01', '2019-12');
    const edPeak = peakOf('SLED_JOR', '2000-12');
    const edQ = ser('SLED_QUR')[L], totQ = ser('JTSQUR')[L];
    const ratio = Math.round((ed / tot) * 100);

    const tile = (label, value, unit, context) => el('div', { class: 'tile' },
      el('p', { class: 'label', text: label }),
      el('p', { class: 'value' }, value, unit ? el('small', { text: unit }) : null),
      el('p', { class: 'context', text: context }));
    $('#tiles').replaceChildren(
      tile('All-sector job openings rate', pct(tot), lm, `2015–19 average ${pct(totAvg)} · peak ${pct(totPeak.value)} (${monthLabel(totPeak.month)})`),
      tile('Openings per unemployed person', vu.toFixed(2), monthLabel(N.months[vuI]), `2015–19 average ${vuAvg.toFixed(2)} · peak ${vuPeak.value.toFixed(2)} (${monthLabel(vuPeak.month)})`),
      tile('State & local education openings rate', pct(ed), lm, `${ratio}% of the all-sector rate · 2015–19 average ${pct(edAvg)}`),
      tile('State & local education quits rate', pct(edQ), lm, `All sectors: ${pct(totQ)}. Education workers quit at ${Math.round((edQ / totQ) * 100)}% of the all-sector rate`),
    );

    // Verdict: every clause is chosen by comparing numbers, so it stays true after a refresh.
    const mkt = cmpWord(tot, totAvg, 0.3);
    const mktChar = mkt === 'close to' ? 'a labor market near its pre-pandemic norm, not the exceptional tightness of 2021–22 that shaped many shortage narratives'
      : mkt === 'above' ? 'a labor market tighter than its pre-pandemic norm, which raises every employer\'s difficulty filling jobs, schools included'
        : 'a labor market looser than its pre-pandemic norm, which should make jobs easier to fill for every employer, schools included';
    const peakPhr = totPeak.value - tot > 1 ? `well below its ${pct(totPeak.value)} peak in ${monthLabel(totPeak.month)}` : `near its ${pct(totPeak.value)} peak in ${monthLabel(totPeak.month)}`;
    const edCmp = cmpWord(ed, edAvg, 0.2);
    let edTail;
    if (edCmp === 'above' && mkt !== 'above') edTail = 'Education\'s openings rate is elevated relative to its own history while the wider market\'s is not, so the economy alone does not explain it. That remainder is where education-specific explanations come in: pay, preparation pipelines, working conditions, licensure, or simply more positions to fill (see staffing levels below).';
    else if (edCmp === 'above') edTail = 'Both are elevated relative to their pre-pandemic norms, so much of education\'s difficulty may reflect the wider market.';
    else if (edCmp === 'below') edTail = 'By its own pre-pandemic standard, education\'s openings rate is low.';
    else edTail = 'By its own pre-pandemic standard, education\'s openings rate is unremarkable.';

    $('#verdict').replaceChildren(
      el('p', { class: 'kicker', text: `Context as of ${monthLabel(N.latest_month, true)}` }),
      para([`The all-sector job openings rate was `, { b: pct(tot) }, `, ${peakPhr} and ${mkt} its 2015–19 average of ${pct(totAvg)}. There ${vu >= 1 ? 'were' : 'were only'} `, { b: vu.toFixed(2) }, ` openings per unemployed person. That is ${mktChar}.`]),
      para([`State & local education's openings rate was `, { b: pct(ed) }, `, ${ratio}% of the all-sector rate and ${edCmp} its own 2015–19 average of ${pct(edAvg)} (its series peak: ${pct(edPeak.value)}, ${monthLabel(edPeak.month)}). ${edTail}`]),
      para([`Single months of JOLTS industry data are noisy and the latest month is preliminary. The charts below show the trend.`], 'small'),
    );
  }

  // --- section 2: over time
  let marketCharts = null;
  function marketCfg() {
    const metric = $('#metric').value, range = $('#range').value, smooth = $('#smooth').checked;
    const all = N.months;
    let start = 0;
    if (range === '2015') start = idxOf('2015-01');
    if (range === '5y') start = Math.max(0, all.length - 60);
    const months = all.slice(start);
    const sm = (arr) => (smooth ? arr.map((_, i) => (i < 2 || arr[i] == null || arr[i - 1] == null || arr[i - 2] == null ? null : (arr[i] + arr[i - 1] + arr[i - 2]) / 3)) : arr);
    const cut = (arr) => sm(arr).slice(start);
    const ed = cut(ser(`SLED_${metric}`)), tot = cut(ser(METRICS[metric].total)), xed = cut(ser(`SLXED_${metric}`));
    const bands = RECESSIONS.map(([a, b]) => [months.indexOf(a), months.indexOf(b)]).filter(([a, b]) => a >= 0 && b >= 0);
    const xTitle = (i) => monthLabel(months[i]) + (smooth ? ' (3-month avg.)' : '');
    const fmt = (v) => (smooth ? `${v.toFixed(2)}%` : pct(v));
    const nm = METRICS[metric].name;
    $('#market-title').textContent = `${nm}${smooth ? ', 3-month average' : ''}`;
    $('#market-sub').textContent = `Percent, ${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`;
    $('#metric-def').textContent = METRICS[metric].def;
    const base = { x: months, xTitle, bands, yFmt: fmt, yTick: (v) => `${v}%`, height: 360, endLabels: true };
    return {
      market: {
        ...base, aria: `${nm} over time`, csv: `jolts_${metric.toLowerCase()}_education_vs_all.csv`, xHead: 'Month',
        series: [
          { id: 'tot', label: 'All sectors', short: 'All sectors', color: 'var(--s2)', values: tot },
          { id: 'xed', label: 'State & local government, excluding education', short: 'State & local excl. education', color: 'var(--s3)', values: xed },
          { id: 'ed', label: 'State & local education', short: 'State & local education', color: 'var(--s1)', width: 2.5, values: ed },
        ],
      },
      ratio: {
        ...base, height: 260, aria: 'Education rate as percent of all-sector rate', csv: `education_relative_${metric.toLowerCase()}.csv`, xHead: 'Month',
        series: [{ id: 'ratio', label: 'Education ÷ all sectors', short: '', color: 'var(--s1)', values: ed.map((v, i) => (v == null || !tot[i] ? null : (v / tot[i]) * 100)), fmt: (v) => `${Math.round(v)}%` }],
        yFmt: (v) => `${Math.round(v)}%`, yTick: (v) => `${v}%`, refs: [{ value: 100, label: 'Same as all sectors' }], csvDigits: 1,
      },
      vu: {
        ...base, height: 260, aria: 'Openings per unemployed person', csv: 'openings_per_unemployed.csv', xHead: 'Month', xTitle: (i) => monthLabel(months[i]),
        series: [{ id: 'vu', label: 'Openings per unemployed', short: '', color: 'var(--s1)', values: ser('VU').slice(start), fmt: (v) => v.toFixed(2) }],
        yFmt: (v) => v.toFixed(2), yTick: (v) => `${+v.toFixed(2)}`, refs: [{ value: 1, label: '1 opening per unemployed person' }],
      },
      staff: (() => {
        const bi = idxOf('2020-02');
        const idx = (k) => ser(k).map((v) => (v == null ? null : (v / ser(k)[bi]) * 100)).slice(start);
        return {
          ...base, height: 320, aria: 'Employment indexed to February 2020', csv: 'education_employment_index.csv', xHead: 'Month', xTitle: (i) => monthLabel(months[i]),
          yMin: 'auto', yFmt: (v) => v.toFixed(1), yTick: (v) => `${+v.toFixed(1)}`, refs: [{ value: 100, label: 'February 2020' }], csvDigits: 2,
          series: [
            { id: 'tot', label: 'All nonfarm jobs', short: 'All nonfarm', color: 'var(--s2)', values: idx('PAYEMS') },
            { id: 'st', label: 'State government education', short: 'State gov. education', color: 'var(--s3)', values: idx('CES9092161101') },
            { id: 'loc', label: 'Local government education', short: 'Local gov. education', color: 'var(--s1)', width: 2.5, values: idx('CES9093161101') },
          ],
        };
      })(),
    };
  }
  function renderMarket() {
    const cfg = marketCfg();
    if (!marketCharts) {
      marketCharts = {
        market: lineChart($('#chart-market'), cfg.market),
        ratio: lineChart($('#chart-ratio'), cfg.ratio),
        vu: lineChart($('#chart-vu'), cfg.vu),
        staff: lineChart($('#chart-staff'), cfg.staff),
      };
    } else for (const k of Object.keys(marketCharts)) marketCharts[k].update(cfg[k]);
  }

  function renderStaffingLede() {
    const L = N.months.length - 1, bi = idxOf('2020-02');
    const ch = (k) => ((ser(k)[L] / ser(k)[bi]) - 1) * 100;
    const sgn = (v) => `${v >= 0 ? 'up' : 'down'} ${Math.abs(v).toFixed(1)}%`;
    const loc = ser('CES9093161101')[L];
    $('#staff-lede').append(' ', document.createTextNode(`As of ${monthLabel(N.latest_month)}, local government education employed ${num(loc / 1000, 2)} million people, ${sgn(ch('CES9093161101'))} from February 2020. All nonfarm employment was ${sgn(ch('PAYEMS'))}.`));
  }

  // --- section 3: industries
  function renderIndustries() {
    const metric = $('#ind-metric').value, sort = $('#ind-sort').value;
    const rows0 = N.industries.filter((r) => r[metric] != null);
    const all = N.industries.find((r) => r.code === '000000');
    const rows = rows0.map((r) => ({
      label: r.name, value: r[metric], code: r.code, note: r.note,
      highlight: r.code === '923000', ref: r.code === '000000', indent: sort === 'tree' ? r.indent : 0, raw: r,
    }));
    if (sort === 'value') rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    $('#ind-title').textContent = `${METRICS[metric].name} by industry, ${monthLabel(N.industry_month, true)}`;
    $('#ind-sub').textContent = `Percent. State & local education highlighted; vertical line marks all sectors (${pct(all[metric])})`;
    hbarChart($('#chart-ind'), rows, {
      fmt: (v) => pct(v), refValue: all[metric],
      tipRows: (r) => [
        { value: `${num(r.raw.JOL)}k`, name: 'job openings' },
        ...['JOR', 'HIR', 'QUR', 'LDR'].map((k) => ({ value: pct(r.raw[k]), name: METRICS[k].name.toLowerCase() + (k === metric ? ' (shown)' : '') })),
      ],
    });
    const ed = N.industries.find((r) => r.code === '923000');
    const xed = N.industries.find((r) => r.code === '929000');
    const rank = [...rows0].sort((a, b) => a.JOR - b.JOR).findIndex((r) => r.code === '923000') + 1;
    $('#ind-lede').replaceChildren(document.createTextNode(
      `In ${monthLabel(N.industry_month, true)}, state & local education had about ${num(ed.JOL)},000 job openings, an openings rate of ${pct(ed.JOR)}, against ${pct(all.JOR)} for all sectors and ${pct(xed.JOR)} for the rest of state and local government. ` +
      `${rank <= 3 ? `That is among the lowest of the ${rows0.length} industry series shown. ` : ''}` +
      `Turnover is also low: education's quits rate was ${pct(ed.QUR)}, against ${pct(all.QUR)} for all sectors. Low openings and low quits together describe a sector that loses relatively few workers and has relatively few unfilled jobs, by labor-market standards.`));
  }

  // --- section 5: states
  // Small multiples: one panel per state on a shared scale, each with the same
  // national October benchmarks, so the reading is "this state over time, against
  // the market", not a cross-state ranking.
  function rateOf(p) {
    if (!p) return { v: null, basis: null };
    if (p.rate_published != null) return { v: p.rate_published, basis: p.basis || 'Published', text: `${p.rate_published}%` };
    if (p.unfilled != null && p.filled != null) { const v = (p.unfilled / (p.unfilled + p.filled)) * 100; return { v, basis: p.basis || 'Computed', text: `${v.toFixed(2)}%` }; }
    if (p.unfilled != null && p.total != null) { const v = (p.unfilled / p.total) * 100; return { v, basis: p.basis || 'Computed', text: `${v.toFixed(2)}%` }; }
    return { v: null, basis: 'No rate', text: 'no rate' };
  }
  const syOf = (y) => `${y}-${String(y + 1).slice(2)}`;
  // National references drawn on every state panel. The School Pulse Panel is the
  // only national, teacher-specific, start-of-year vacancy rate, so it leads.
  const BENCH = [
    { id: 'spp', key: 'spp', label: 'NCES School Pulse Panel: national teaching vacancy rate, October', color: 'var(--s2)', marker: 'diamond', width: 2 },
    { id: 'b-ed', key: 'sled_nsa', label: 'JOLTS state & local education openings rate, October (NSA)', color: 'var(--ref)', marker: 'circle', width: 1.5 },
    { id: 'b-tot', key: 'total_nsa', label: 'JOLTS all-sector openings rate, October (NSA)', color: 'var(--ref)', marker: 'circle', width: 1.5, dash: '5 4' },
  ];
  const sppTeach = () => (P ? P.roles.find((r) => r.var === 'PCTVAC1TOT_oct') : null);
  function sppBySchoolYear() {
    const t = sppTeach();
    const out = {};
    if (t) for (const [k, v] of Object.entries(t.values)) if (k.endsWith('-10')) out[syOf(+k.slice(0, 4))] = v;
    return out;
  }

  function statesFrame() {
    const long = $('#bench-long').checked;
    const oct = N.october_nsa;
    const spp = sppBySchoolYear();
    const stateYears = S.states.flatMap((s) => s.points.filter((p) => rateOf(p).v != null).map((p) => +p.sy.slice(0, 4)));
    const first = long ? Math.min(...oct.map((o) => o.year)) : Math.min(...stateYears);
    const last = Math.max(...stateYears, ...oct.map((o) => o.year));
    const years = []; for (let y = first; y <= last; y++) years.push(syOf(y));
    const bench = BENCH.map((b) => ({
      ...b,
      values: years.map((sy) => (b.key === 'spp' ? (spp[sy] ? spp[sy].pct : null) : ((oct.find((r) => r.school_year === sy) || {})[b.key] ?? null))),
      se: b.key === 'spp' ? years.map((sy) => (spp[sy] ? spp[sy].se : null)) : null,
    }));
    const all = [...S.states.flatMap((s) => s.points.map((p) => rateOf(p).v)), ...bench.flatMap((b) => b.values)].filter((v) => v != null);
    return { years, bench, yMax: Math.ceil(Math.max(...all)) };
  }
  function panelCfg(st, f) {
    const pts = f.years.map((sy) => st.points.find((p) => p.sy === sy));
    const tag = (s, i) => {
      if (s.se && s.se[i] != null) return ` (±${(1.96 * s.se[i]).toFixed(1)})`;
      const p = s.pts && s.pts[i];
      if (!p) return '';
      const b = rateOf(p).basis;
      const bits = [];
      if (b === 'Computed') bits.push('computed');
      if (b === 'Third-party calculation') bits.push('third-party calc.');
      if (p.agency_label && p.agency_label !== p.sy) bits.push(`state labels it ${p.agency_label}`);
      return bits.length ? ` (${bits.join('; ')})` : '';
    };
    return {
      x: f.years, cat: true, legend: false, tools: false, endLabels: false, height: 230, yMax: f.yMax,
      aria: `${st.name}: vacancy rate by school year`, xTitle: (i) => f.years[i],
      xTick: (i) => `${f.years[i].slice(2, 4)}-${f.years[i].slice(5)}`,
      yFmt: (v) => `${+v.toFixed(2)}%`, yTick: (v) => `${v}%`,
      series: [
        ...f.bench.map((b) => ({ id: b.id, label: b.label, color: b.color, dash: b.dash, width: b.width, marker: b.marker, r: b.key === 'spp' ? 3.6 : 2.8, values: b.values, se: b.se, fmt: (v) => (b.key === 'spp' ? `${v}%` : `${v.toFixed(1)}%`) })),
        { id: st.id, label: st.series_label, color: 'var(--s1)', width: 2.25, marker: 'circle', values: pts.map((p) => rateOf(p).v), pts, fmt: (v) => `${+v.toFixed(2)}%` },
      ],
      rowNote: (s, i) => (s.pts && s.pts[i] && rateOf(s.pts[i]).v == null ? 'no rate' : null),
      rowTag: tag,
      tipNote: (i) => (pts[i] && pts[i].note) || '',
    };
  }

  let statePanels = null;
  function renderStates() {
    const f = statesFrame();
    if (statePanels) { S.states.forEach((st) => statePanels[st.id].update(panelCfg(st, f))); return; }
    const host = $('#chart-states');
    host.replaceChildren();
    const legend = el('ul', { class: 'legend' }, [
      { label: "The state's reported rate", color: 'var(--s1)', marker: 'circle', width: 2.25 },
      ...BENCH,
    ].map((s) => el('li', {}, legendKey(s), s.label)));
    const tableBox = el('div', { class: 'chart-table', hidden: true });
    const groups = el('div');
    const btnTable = el('button', { type: 'button', 'aria-pressed': 'false', text: 'Table' });
    const btnCsv = el('button', { type: 'button', text: 'CSV' });
    host.append(el('div', { class: 'chart-head' }, legend, el('div', { class: 'fig-tools' }, btnTable, btnCsv)), groups, tableBox);

    const tableData = () => {
      const fr = statesFrame();
      const head = ['School year', ...S.states.map((s) => `${s.series_label} (%)`), ...BENCH.map((b) => `${b.label} (%)`), 'Notes'];
      const rows = fr.years.map((sy, i) => [sy,
        ...S.states.map((s) => { const r = rateOf(s.points.find((q) => q.sy === sy)); return r.v == null ? '' : +r.v.toFixed(2); }),
        ...fr.bench.map((b) => b.values[i] ?? ''),
        S.states.map((s) => { const p = s.points.find((q) => q.sy === sy); return p && p.note ? `${s.name}: ${p.note}` : null; }).filter(Boolean).join(' | ')]);
      return { head, rows };
    };
    btnTable.addEventListener('click', () => {
      const on = tableBox.hidden;
      tableBox.hidden = !on; groups.hidden = on;
      btnTable.setAttribute('aria-pressed', String(on)); btnTable.textContent = on ? 'Chart' : 'Table';
      if (!on) return;
      const t = tableData();
      const nNum = t.head.length - 2;
      tableBox.replaceChildren(el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, t.head.map((h, j) => el('th', { scope: 'col', class: j > 0 && j <= nNum ? 'num' : null, text: h })))),
        el('tbody', {}, [...t.rows].reverse().map((r) => el('tr', {}, r.map((v, j) => el(j ? 'td' : 'th', { scope: j ? null : 'row', class: j > 0 && j <= nNum ? 'num' : null, text: v === '' ? '–' : v })))))));
    });
    btnCsv.addEventListener('click', () => { const t = tableData(); csvDownload('state_vacancy_rates.csv', t.head, t.rows); });

    statePanels = {};
    for (const [tierId, tier] of Object.entries(S.tiers)) {
      const members = S.states.filter((st) => st.tier === tierId);
      if (!members.length) continue;
      const grid = el('div', { class: 'multiples' });
      groups.append(el('div', { class: 'tier' }, el('h4', { class: 'tier-h', text: tier.label }), el('p', { class: 'tier-text', text: tier.text }), grid));
      for (const st of members) {
        const chart = el('div', { class: 'chart' });
        grid.append(el('div', { class: 'panel' }, el('h4', { text: st.name }), el('p', { class: 'cov', text: `${st.coverage}. ${st.timing}.` }), chart));
        statePanels[st.id] = lineChart(chart, panelCfg(st, f));
      }
    }
  }

  // "What counts as a vacancy": every measure on the page, side by side.
  function renderDefinitions() {
    const host = $('#vacancy-defs');
    if (!host) return;
    const cols = [
      ['counted', 'What counts'],
      ['includes_substitute_covered', 'Positions covered by substitutes or not-fully-qualified staff'],
      ['positions', 'Which positions'],
      ['timing', 'When'],
      ['denominator', 'Rate denominator'],
      ['coverage', 'Coverage'],
    ];
    const rows = [
      ...S.national_measures.map((m) => ({ name: m.name, group: 'National', m })),
      ...S.states.map((st) => ({ name: st.name, group: S.tiers[st.tier].label, m: st.measure })),
      { name: 'Nebraska', group: 'Counts only', m: S.nebraska.measure },
    ];
    // One card per measure: a seven-column table is unreadable at these text lengths.
    host.replaceChildren(...rows.map((r) => el('article', { class: 'measure' },
      el('h4', { text: r.name }), el('p', { class: 'measure-group', text: r.group }),
      el('dl', {}, cols.flatMap(([k, h]) => [el('dt', { text: h }), el('dd', { text: r.m[k] || '–' })])))));
  }

  // School Pulse Panel: vacancy rates by role, latest October wave.
  function renderSppRoles() {
    const host = $('#chart-spp');
    if (!host || !P) { const fig = $('#fig-spp'); if (fig) fig.hidden = true; return; }
    const latest = P.waves.filter((w) => w.endsWith('-10')).pop();
    const yr = latest.slice(0, 4);
    const ci = (v) => (v.se != null ? ` (95% CI ±${(1.96 * v.se).toFixed(1)})` : '');
    const toRow = (r) => ({
      label: r.total ? (r.group === 'teaching' ? 'All teaching positions' : 'All non-teaching positions') : r.name,
      value: r.values[latest] ? r.values[latest].pct : null,
      highlight: r.var === 'PCTVAC1TOT_oct', ref: r.var === 'PCTVAC2TOT_oct', raw: r,
      note: 'NCES School Pulse Panel. Percent of positions (filled + vacant) reported vacant; rounded to whole percents by NCES.',
    });
    const group = (g) => P.roles.filter((r) => r.group === g && r.values[latest]).map(toRow).sort((a, b) => (b.highlight || b.ref) - (a.highlight || a.ref) || b.value - a.value || a.label.localeCompare(b.label));
    const teachTotal = sppTeach().values[latest].pct;
    const opts = {
      fmt: (v) => `${v}%`, refValue: teachTotal,
      max: Math.max(...P.roles.map((r) => (r.values[latest] ? r.values[latest].pct : 0))) * 1.12, // one scale for both groups
      tipRows: (row) => Object.keys(row.raw.values).sort().map((k) => ({ value: `${row.raw.values[k].pct}%`, name: `October ${k.slice(0, 4)}${ci(row.raw.values[k])}` })),
    };
    const a = el('div'), b = el('div');
    host.replaceChildren(el('h4', { class: 'tier-h', text: 'Teaching positions' }), a, el('h4', { class: 'tier-h', text: 'Non-teaching positions' }), b);
    hbarChart(a, group('teaching'), opts);
    hbarChart(b, group('non-teaching'), opts);
    const sch = P.schools_with_teaching_vacancy;
    const nonTeach = P.roles.filter((r) => r.group === 'non-teaching' && !r.total && r.values[latest]);
    const higher = nonTeach.filter((r) => r.values[latest].pct > teachTotal).sort((x, y) => y.values[latest].pct - x.values[latest].pct);
    $('#spp-sub').textContent = `Percent of positions vacant, October ${yr}. Vertical line marks all teaching positions (${teachTotal}%)`;
    $('#spp-lede').textContent = `NCES's School Pulse Panel asked a national sample of public school principals how many positions they had in each role ("filled + vacant") and how many were vacant. ` +
      `It is the only national, start-of-year, teacher-specific vacancy rate: ${Object.entries(sppTeach().values).sort().map(([k, v]) => `${v.pct}% in October ${k.slice(0, 4)}`).join(', ')}. ` +
      `The share of schools with at least one vacant teaching position was ${Object.entries(sch).map(([k, v]) => `${v}% in ${k.slice(0, 4)}`).join(', ')}. ` +
      `In October ${yr}, ${higher.length} of ${nonTeach.length} non-teaching roles had higher vacancy rates than teaching positions overall, led by ${higher.filter((r) => !/^other/i.test(r.name)).slice(0, 3).map((r) => `${r.name.toLowerCase()} (${r.values[latest].pct}%)`).join(', ')}. ` +
      `The survey's last staffing wave was October ${yr}; NCES has not announced another.`;
  }

  // Why only these states? Summarize the 50-state inventory.
  function renderInventory() {
    const host = $('#inventory-summary');
    if (!host || !I) return;
    const by = (c) => I.states.filter((s) => s.category === c);
    const names = (arr) => arr.map((s) => s.state).join(', ');
    host.replaceChildren(
      el('p', {}, `Of the 50 states and DC, ${by('none').length} publish no statewide vacancy data. ${by('counts').length} publish counts without a denominator from the same source (${names(by('counts'))}), and ${by('different').length} publish figures that measure something else (${names(by('different'))}). `,
        `The closest candidates not yet on this page are ${names(by('candidate'))}:`),
      el('ul', {}, by('candidate').map((s) => el('li', {}, el('strong', { text: `${s.state}. ` }), s.reason))),
      el('p', {}, 'The full state-by-state inventory, with sources, is on the ', el('a', { href: 'provenance.html#inventory', text: 'data provenance page' }), '.'),
    );
  }

  function renderStatesTable() {
    const t = $('#states-table');
    t.querySelectorAll('thead,tbody').forEach((n) => n.remove());
    const change = (d) => (Math.abs(d) < 0.005 ? 'at peak' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} pts`);
    t.append(el('thead', {}, el('tr', {}, ['', 'What is counted', 'Latest rate', 'School year', 'Basis', 'Peak in this series', 'Latest vs. peak'].map((h, j) => el('th', { scope: 'col', class: [2, 5, 6].includes(j) ? 'num' : null, text: h })))));
    const tb = el('tbody');
    // Alphabetical on purpose: the measures differ, so ordering by rate would imply a ranking.
    for (const st of [...S.states].sort((a, b) => a.name.localeCompare(b.name))) {
      const rated = st.points.map((p) => ({ p, r: rateOf(p) })).filter((x) => x.r.v != null);
      const latest = rated[rated.length - 1];
      const hi = rated.reduce((a, b) => (b.r.v > a.r.v ? b : a));
      tb.append(el('tr', {},
        el('th', { scope: 'row' }, st.name, el('br'), el('span', { class: 'dim small', text: S.tiers[st.tier].label })),
        el('td', { text: st.coverage }),
        el('td', { class: 'num', text: latest.r.text }),
        el('td', { text: latest.p.sy + (latest.p.agency_label && latest.p.agency_label !== latest.p.sy ? ` (state's label: ${latest.p.agency_label})` : '') }),
        el('td', { class: 'dim', text: latest.r.basis }),
        el('td', { class: 'num', text: `${hi.r.text} (${hi.p.sy})` }),
        el('td', { class: 'num', text: change(latest.r.v - hi.r.v) }),
      ));
    }
    const ne = S.nebraska.years[S.nebraska.years.length - 1];
    tb.append(el('tr', {}, el('th', { scope: 'row', text: 'Nebraska' }), el('td', { text: S.nebraska.coverage }), el('td', { class: 'num dim', text: 'no rate' }), el('td', { text: ne.sy }), el('td', { class: 'dim', text: 'Counts only; no denominator published' }), el('td', {}), el('td', {})));
    // National references: one row each, as [school year, value] pairs.
    const oct = N.october_nsa.filter((o) => o.year >= 2019);
    const spp = Object.entries(sppBySchoolYear()).sort();
    const refs = [
      ...(spp.length ? [{ name: 'NCES School Pulse Panel, teaching (national)', what: 'Share of public school teaching positions vacant in October (survey estimate)', basis: 'Published (NCES), rounded', pts: spp.map(([sy, v]) => [sy, v.pct]), d: 0 }] : []),
      { name: 'JOLTS state & local education (national)', what: 'Job openings rate, public schools and colleges, all staff; October, not seasonally adjusted', basis: 'Published (BLS)', pts: oct.map((o) => [o.school_year, o.sled_nsa]), d: 1 },
      { name: 'JOLTS all sectors (national)', what: 'Job openings rate, all employers; October, not seasonally adjusted', basis: 'Published (BLS)', pts: oct.map((o) => [o.school_year, o.total_nsa]), d: 1 },
    ];
    for (const r of refs) {
      const lo = r.pts[r.pts.length - 1];
      const hi = r.pts.reduce((a, c) => (c[1] > a[1] ? c : a));
      tb.append(el('tr', {},
        el('th', { scope: 'row', class: 'dim', text: `${r.name}, benchmark` }),
        el('td', { class: 'dim', text: r.what }),
        el('td', { class: 'num', text: `${lo[1].toFixed(r.d)}%` }), el('td', { text: lo[0] }), el('td', { class: 'dim', text: r.basis }),
        el('td', { class: 'num', text: `${hi[1].toFixed(r.d)}% (${hi[0]})` }), el('td', { class: 'num', text: change(lo[1] - hi[1]) })));
    }
    t.append(tb);
  }
  function renderStateDefs() {
    const box = $('#state-defs');
    const all = [...S.states, { name: 'Nebraska', agency: S.nebraska.agency, timing: S.nebraska.timing, definition: S.nebraska.definition, sources: S.nebraska.sources, points: S.nebraska.years.map((y) => ({ sy: y.sy, note: `${y.vacant} vacant; ${y.unfilled} "unfilled" (broader measure).${y.note ? ' ' + y.note : ''}` })) }];
    box.replaceChildren(...all.map((st) => el('details', {},
      el('summary', {}, `${st.name} `, el('span', { text: `· ${st.agency} · ${st.timing}` })),
      el('div', { class: 'body' },
        el('p', { text: st.definition }),
        el('ul', {}, st.points.map((p) => el('li', {}, el('strong', { text: `${p.sy}${p.agency_label && p.agency_label !== p.sy ? ` (state's label: ${p.agency_label})` : ''}: ` }), (rateOf(p).v != null ? `${rateOf(p).text}. ` : ''), p.note || ''))),
        el('p', { style: 'margin-top:8px' }, 'Sources: ', ...st.sources.flatMap((s, i) => [i ? ' · ' : '', el('a', { href: s.url, rel: 'noopener', text: s.label })])),
      ))));
  }

  // --- section 6: teachers
  function renderIllinois() {
    const ic = S.illinois_categories;
    const colors = { Teaching: ['var(--s1)', 'circle'], Paraprofessionals: ['var(--s2)', 'square'], 'School support personnel': ['var(--s3)', 'triangle'], Administrators: ['var(--s4)', 'diamond'] };
    const series = ic.categories.map((c) => ({
      id: c.name, label: c.name, short: c.name.replace(' personnel', ''),
      color: colors[c.name]?.[0] || 'var(--ref)', marker: colors[c.name]?.[1] || 'circle', dash: colors[c.name] ? null : '5 4', width: colors[c.name] ? 2 : 1.75,
      values: c.unfilled.map((u, i) => (u / (u + c.filled[i])) * 100), fmt: (v) => `${v.toFixed(2)}%`,
    }));
    lineChart($('#chart-il'), {
      x: ic.years, cat: true, xHead: 'School year', series, height: 320, endLabels: true, aria: 'Illinois vacancy rates by position category',
      xTitle: (i) => `${ic.years[i]} (SY${ic.years[i].slice(-2)})`, yFmt: (v) => `${v.toFixed(2)}%`, yTick: (v) => `${v}%`, csv: 'illinois_by_category.csv', csvDigits: 2,
    });
    const li = ic.years.length - 1;
    const latest = series.map((s) => ({ name: s.label, v: s.values[li] })).filter((s) => !s.name.startsWith('All')).sort((a, b) => b.v - a.v);
    const allStaff = series.find((s) => s.label.startsWith('All')).values[li];
    const teachRank = latest.findIndex((s) => s.name === 'Teaching') + 1;
    $('#il-lede').replaceChildren(document.createTextNode(
      `Pooled figures hide which jobs are hard to fill. Illinois publishes filled and unfilled positions by job category. In ${ic.years[li]}, the computed rates were: ${latest.map((s) => `${s.name.toLowerCase()} ${s.v.toFixed(2)}%`).join(', ')}, and ${allStaff.toFixed(2)}% for all staff combined. ` +
      `Teaching ranked ${['', 'first', 'second', 'third', 'fourth'][teachRank]} of four. In rate terms, the state's sharpest shortages were among ${latest[0].name.toLowerCase()}, which an all-staff or teacher-only figure would not show.`));
  }

  function stackBlock(host, parts, total) {
    const bar = el('div', { class: 'stack', role: 'img', 'aria-label': parts.map((p) => `${p.label}: ${p.text}`).join('; ') });
    for (const p of parts) {
      const seg = el('div', { style: `width:${(p.value / total) * 100}%;background:${p.color}`, tabindex: 0 });
      const show = (cx, cy) => showTip(p.label, [{ value: p.text, name: p.sub || '', color: p.color, bar: true }], p.note, cx, cy);
      seg.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      seg.addEventListener('pointerleave', hideTip);
      seg.addEventListener('focus', () => { const b = seg.getBoundingClientRect(); show(b.left + b.width / 2, b.top); });
      seg.addEventListener('blur', hideTip);
      bar.append(seg);
    }
    host.append(bar);
  }
  function stackLegend(parts) {
    return el('ul', { class: 'stack-legend' }, parts.map((p) => el('li', {}, el('span', { class: 'sw', style: `background:${p.color}` }), el('span', { text: p.label }), el('span', { class: 'n', text: p.text }))));
  }

  function renderComposition() {
    const L = N.months.length - 1;
    const jol = ser('SLED_JOL')[L];
    const loc = ser('CES9093161101')[L], st = ser('CES9092161101')[L];
    const c = S.composition;
    const kShare = loc / (loc + st);
    const tShare = c.nces_teacher_fte / c.nces_total_k12_staff_fte;
    const k12 = jol * kShare;
    const parts = [
      { label: 'K-12 teachers', value: k12 * tShare, color: 'var(--s1)' },
      { label: 'Other K-12 staff (aides, support, administrators…)', value: k12 * (1 - tShare), color: 'var(--s3)' },
      { label: 'Higher education, all roles', value: jol * (1 - kShare), color: 'var(--s2)' },
    ];
    parts.forEach((p) => { p.text = `≈${num(Math.round(p.value))}k · ${Math.round((p.value / jol) * 100)}%`; p.note = 'Modeled pro-rata, not counted.'; });
    $('#comp-sub').textContent = `Modeled, pro-rata split of ${monthLabel(N.latest_month, true)}'s ≈${num(jol)},000 state & local education openings`;
    const host = $('#chart-comp');
    host.replaceChildren();
    stackBlock(host, parts, jol);
    host.append(stackLegend(parts));
    $('#comp-note').textContent = `A model, not a count. Local government is ${Math.round(kShare * 100)}% of state & local education employment (CES, ${monthLabel(N.latest_month)}); teachers are ${(tShare * 100).toFixed(1)}% of public K-12 staff FTE (NCES CCD, ${c.nces_year}). Assumes all groups have the same vacancy rate, which is not true: aides and support staff turn over faster.`;
  }

  function renderNebraska() {
    const ne = S.nebraska.years;
    const max = Math.max(...ne.map((y) => y.unfilled));
    const host = $('#chart-ne');
    host.replaceChildren();
    for (const y of ne) {
      const parts = [
        { label: 'Vacant (not filled at all)', value: y.vacant, color: 'var(--s1)', text: `${num(y.vacant, 2)}` },
        { label: 'Filled by someone not fully qualified', value: y.unfilled - y.vacant, color: 'var(--bar-muted)', text: `${num(y.unfilled - y.vacant, 2)}` },
      ];
      const row = el('div', { class: 'ne-row' }, el('p', { class: 'yr', text: `${y.sy}: ${num(y.unfilled, 2)} positions "unfilled"` }));
      const wrap = el('div', { style: `width:${(y.unfilled / max) * 100}%` });
      stackBlock(wrap, parts, y.unfilled);
      row.append(wrap);
      host.append(row);
    }
    host.append(stackLegend([
      { label: 'Vacant (not filled at all)', color: 'var(--s1)', text: '' },
      { label: 'Filled by someone not fully qualified', color: 'var(--bar-muted)', text: '' },
    ]));
    const l = ne[ne.length - 1];
    $('#ne-rule').textContent = `Nebraska shows the stakes: of the ${num(l.unfilled, 2)} positions it counted as "unfilled" in ${l.sy}, only ${num(l.vacant, 2)} were vacant. The other ${num(l.unfilled - l.vacant, 2)} were filled by staff who were not fully qualified. Iowa's count, by contrast, includes positions filled by temporary or substitute staff, so even "vacancy" means different things in different states.`;
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    const params = new URLSearchParams(location.search);
    if (params.has('embed')) {
      document.body.classList.add('embed');
      const post = () => window.parent.postMessage({ type: 'ssd-height', height: document.documentElement.scrollHeight }, '*');
      new ResizeObserver(post).observe(document.body);
    }
    try {
      await load();
    } catch (e) {
      $('#stamp').replaceChildren(el('span', { class: 'error', text: `Could not load data (${e.message}).` }));
      return;
    }
    const run = (name, fn) => { try { fn(); } catch (e) { console.error(name, e); } };
    run('header', renderHeader);
    run('now', renderNow);
    run('market', renderMarket);
    run('staffing', renderStaffingLede);
    run('industries', renderIndustries);
    run('states', renderStates);
    run('states-table', renderStatesTable);
    run('state-defs', renderStateDefs);
    run('definitions', renderDefinitions);
    run('inventory', renderInventory);
    run('spp', renderSppRoles);
    run('illinois', renderIllinois);
    run('composition', renderComposition);
    run('nebraska', renderNebraska);
    for (const id of ['#metric', '#range', '#smooth']) $(id).addEventListener('change', () => run('market', renderMarket));
    for (const id of ['#ind-metric', '#ind-sort']) $(id).addEventListener('change', () => run('industries', renderIndustries));
    $('#bench-long').addEventListener('change', () => run('states', renderStates));
    window.addEventListener('scroll', hideTip, { passive: true });
  }
  boot();
})();
