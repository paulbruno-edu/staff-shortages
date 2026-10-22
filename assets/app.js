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
    QUR: { name: 'Quits rate', total: 'JTSQUR', def: 'quits rate is voluntary separations during the month ÷ employment. Retirements and transfers to other locations are not quits; BLS counts them as "other separations."' },
    LDR: { name: 'Layoffs & discharges rate', total: 'JTSLDR', def: 'layoffs & discharges rate is involuntary separations during the month ÷ employment.' },
  };

  // ---------------------------------------------------------------- helpers
  const monthLabel = (m, long) => {
    const [y, mo] = m.split('-');
    return `${(long ? MONTHS_LONG : MONTHS)[+mo - 1]} ${y}`;
  };
  const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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
    // Read the current config (not the one the chart was created with), so the file name and
    // headings follow the measure and options selected when the button is pressed.
    btnCsv.addEventListener('click', () => {
      const c = state.cfg, t = tableData();
      const head = c.valueLabel ? t.head.map((h, j) => (j === 0 || h === 'Notes' ? h : `${h}: ${c.valueLabel}`)) : t.head;
      csvDownload(c.csv || 'data.csv', head, t.rows);
    });
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
        // Always label the last category; drop the regular label just before it if the two would crowd.
        const lastGap = (n - 1) % every;
        c.x.forEach((lab, i) => {
          if (i % every && i !== n - 1) return;
          if (lastGap && lastGap < every / 2 && i === n - 1 - lastGap) return;
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
  let N, S, P, I, T; // national, state, School Pulse Panel, state inventory, NCES staffing

  async function load() {
    const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
    // The SPP and inventory files are optional: the page renders without them.
    const opt = (u) => get(u).catch((e) => { console.warn(e); return null; });
    [N, S, P, I, T] = await Promise.all([get('data/national.json'), get('data/states.json'), opt('data/spp.json'), opt('data/state_inventory.json'), opt('data/staffing.json')]);
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
    $('#stamp').textContent = `National data through ${monthLabel(lm, true)}${N.latest_preliminary ? ' (preliminary)' : ''}, updated ${genTxt}. State data as of ${stUpd}.`;
    $('#build-info').textContent = `National data file generated ${N.generated_utc} (UTC); ${N.months.length} months, ${monthLabel(N.months[0])} to ${monthLabel(lm)}. Industry table: ${monthLabel(N.industry_month)}. State file updated ${S.updated}.`;
    $('#cite-date').textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // The pandemic shock and recovery, computed from the data: layoff peaks, the size of the job
  // drop, and when payroll jobs regained their February 2020 level.
  function pandemicFacts() {
    const bi = idxOf('2020-02'), w0 = idxOf('2020-03'), w1 = idxOf('2020-12');
    if (bi < 0 || w0 < 0 || w1 < 0) return null;
    const peak = (k) => { let j = w0; for (let i = w0; i <= w1; i++) if (ser(k)[i] != null && ser(k)[i] > ser(k)[j]) j = i; return { v: ser(k)[j], m: N.months[j] }; };
    const drop = (k) => {
      const v = ser(k), base = v[bi]; let j = w0;
      for (let i = w0; i <= w1; i++) if (v[i] != null && v[i] < v[j]) j = i;
      let back = null;
      for (let i = j + 1; i < v.length; i++) if (v[i] != null && v[i] >= base) { back = N.months[i]; break; }
      return { pct: ((v[j] / base) - 1) * 100, low: N.months[j], back };
    };
    return {
      ldrAll: peak('JTSLDR'), ldrEd: peak('SLED_LDR'),
      ldrAllAvg: avgBetween('JTSLDR', '2015-01', '2019-12'), ldrEdAvg: avgBetween('SLED_LDR', '2015-01', '2019-12'),
      jobsEd: drop('CES9093161101'), jobsAll: drop('PAYEMS'),
    };
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
    // Openings alone do not measure hiring difficulty, so the verdict describes openings
    // relative to their history and names the other things that move them.
    const mktChar = mkt === 'close to' ? 'By that measure, openings across the economy are roughly where they were before the pandemic, not at the levels of 2021–22, when many of the most alarming stories about "teacher shortages" were written.'
      : mkt === 'above' ? 'By that measure, employers across the economy have unusually many openings relative to their workforces. That can reflect difficulty hiring, but also rising demand for workers or positions staying open longer, and schools hire in the same labor market.'
        : 'By that measure, employers across the economy have fewer openings than usual relative to their workforces. That often goes with an easier hiring environment, though openings also reflect how many workers employers want and how long positions stay open.';
    const peakPhr = totPeak.value - tot > 1 ? `well below its ${pct(totPeak.value)} peak in ${monthLabel(totPeak.month)}` : `near its ${pct(totPeak.value)} peak in ${monthLabel(totPeak.month)}`;
    const edCmp = cmpWord(ed, edAvg, 0.2);
    // Education's openings rate is normally well below the economy's, so the comparison with
    // the economy is stated against the usual gap rather than on its own.
    const r = ed / tot, rAvg = edAvg / totAvg;
    const share = r < 0.5 ? `less than half the economy-wide rate of ${pct(tot)}`
      : r < 1 ? `about ${ratio}% of the economy-wide rate of ${pct(tot)}`
        : `at or above the economy-wide rate of ${pct(tot)}`;
    const gap = r > rAvg * 1.1 ? ', so the gap is narrower than usual' : r < rAvg * 0.9 ? ', so the gap is wider than usual' : ', about the usual gap';
    const vsEconomy = `That is ${share}, but education's rate is usually much lower than the economy's: in 2015–19 it averaged about ${Math.round(rAvg * 100)}% of the economy-wide rate${gap}.`;
    let edTail;
    if (edCmp === 'above' && mkt !== 'above') edTail = 'So openings in public education are somewhat elevated relative to their own history even though openings in the economy as a whole are not, which suggests something particular to education may be at work. That could reflect greater recruitment needs relative to the existing workforce, slower filling of positions, or both (see staffing levels, below)' + '.';
    else if (edCmp === 'above') edTail = 'Openings are elevated both in education and in the wider economy, so at least some of what is driving education\'s openings plausibly reflects the labor market as a whole.';
    else if (edCmp === 'below') edTail = 'By its own historical standard, education\'s openings rate is low.';
    else edTail = 'By its own historical standard, education\'s openings rate is unremarkable.';

    $('#verdict').replaceChildren(
      el('p', { class: 'kicker', text: `Context as of ${monthLabel(N.latest_month, true)}` }),
      para([`Across the whole economy, the job openings rate was `, { b: pct(tot) }, `, ${peakPhr} and ${mkt} its 2015–19 average of ${pct(totAvg)}. There ${vu >= 1 ? 'were' : 'were only'} `, { b: vu.toFixed(2) }, ` job openings per unemployed person. ${mktChar}`]),
      para([`In state & local education, the openings rate was `, { b: pct(ed) }, `. ${vsEconomy} Measured against its own history, the rate was ${edCmp} the sector's 2015–19 average of ${pct(edAvg)}. ${edTail}`]),
      para([`This education series combines public schools and colleges and all of their employees, so it says little about teachers specifically. Single months are also noisy, and the latest month is preliminary; the charts below show the trends.`], 'small'),
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
    $('#idx-title').textContent = `${nm}, each series relative to its own 2015–19 average`;
    $('#market-sub').textContent = `Percent, ${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`;
    $('#metric-def').textContent = METRICS[metric].def;
    const base = { x: months, xTitle, bands, yFmt: fmt, yTick: (v) => `${v}%`, height: 360, endLabels: true };
    const avg = smooth ? ', 3-month average' : '', sfx = smooth ? '_3mo' : '';
    return {
      market: {
        ...base, aria: `${nm} over time`, csv: `jolts_${metric.toLowerCase()}_education_vs_all${sfx}.csv`, xHead: 'Month', valueLabel: `${nm}, percent, seasonally adjusted${avg}`,
        series: [
          { id: 'tot', label: 'All sectors', short: 'All sectors', color: 'var(--s2)', values: tot },
          { id: 'xed', label: 'State & local government, excluding education', short: 'State & local excl. education', color: 'var(--s3)', values: xed },
          { id: 'ed', label: 'State & local education', short: 'State & local education', color: 'var(--s1)', width: 2.5, values: ed },
        ],
      },
      ratio: {
        ...base, height: 260, aria: 'Education rate as percent of all-sector rate', csv: `education_relative_${metric.toLowerCase()}${sfx}.csv`, xHead: 'Month', valueLabel: `${nm}, education rate as percent of all-sector rate${avg}`,
        series: [{ id: 'ratio', label: 'Education ÷ all sectors', short: '', color: 'var(--s1)', values: ed.map((v, i) => (v == null || !tot[i] ? null : (v / tot[i]) * 100)), fmt: (v) => `${Math.round(v)}%` }],
        yFmt: (v) => `${Math.round(v)}%`, yTick: (v) => `${v}%`, refs: [{ value: 100, label: 'Same as all sectors' }], csvDigits: 1,
      },
      idx: (() => {
        // Each series against its own 2015-19 average (unsmoothed), the same baseline the summary uses.
        const rel = (k) => { const b = avgBetween(k, '2015-01', '2019-12'); return cut(ser(k).map((v) => (v == null || !b ? null : (v / b) * 100))); };
        return {
          ...base, height: 320, aria: `${nm}, each series relative to its own 2015-19 average`, csv: `jolts_${metric.toLowerCase()}_vs_own_2015_19_average${sfx}.csv`, xHead: 'Month', valueLabel: `${nm}, percent of the series' own 2015-19 average${avg}`,
          yMin: 'auto', yFmt: (v) => `${Math.round(v)}`, yTick: (v) => `${v}`, refs: [{ value: 100, label: 'Own 2015–19 average' }], csvDigits: 1,
          series: [
            { id: 'tot', label: 'All sectors', short: 'All sectors', color: 'var(--s2)', values: rel(METRICS[metric].total) },
            { id: 'xed', label: 'State & local government, excluding education', short: 'State & local excl. education', color: 'var(--s3)', values: rel(`SLXED_${metric}`) },
            { id: 'ed', label: 'State & local education', short: 'State & local education', color: 'var(--s1)', width: 2.5, values: rel(`SLED_${metric}`) },
          ],
        };
      })(),
      vu: {
        ...base, height: 260, aria: 'Openings per unemployed person', csv: 'openings_per_unemployed.csv', xHead: 'Month', valueLabel: 'job openings per unemployed person', xTitle: (i) => monthLabel(months[i]),
        series: [{ id: 'vu', label: 'Openings per unemployed', short: '', color: 'var(--s1)', values: ser('VU').slice(start), fmt: (v) => v.toFixed(2) }],
        yFmt: (v) => v.toFixed(2), yTick: (v) => `${+v.toFixed(2)}`, refs: [{ value: 1, label: '1 opening per unemployed person' }],
      },
      staff: (() => {
        const bi = idxOf('2020-02');
        const idx = (k) => ser(k).map((v) => (v == null ? null : (v / ser(k)[bi]) * 100)).slice(start);
        return {
          ...base, height: 320, aria: 'Employment indexed to February 2020', csv: 'education_employment_index.csv', xHead: 'Month', valueLabel: 'payroll jobs, index February 2020 = 100, seasonally adjusted', xTitle: (i) => monthLabel(months[i]),
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
        idx: lineChart($('#chart-idx'), cfg.idx),
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
    $('#staff-lede').append(' ', document.createTextNode(`As of ${monthLabel(N.latest_month)}, local government education had ${num(loc / 1000, 2)} million payroll jobs, ${sgn(ch('CES9093161101'))} from February 2020. All nonfarm employment was ${sgn(ch('PAYEMS'))}.`));
    const pf = pandemicFacts();
    if (!pf) return;
    const mo = (m) => monthLabel(m, true);
    const pct = (v) => `${Math.abs(v).toFixed(0)}%`;
    const back = (d) => (d.back ? `regained its February 2020 level in ${mo(d.back)}` : 'had not yet regained its February 2020 level');
    $('#staff-pandemic').textContent =
      `Payroll jobs in local government education fell by about ${pct(pf.jobsEd.pct)} from February 2020 to their low in ${mo(pf.jobsEd.low)}, compared with ${pct(pf.jobsAll.pct)} for all nonfarm jobs from February to their low in ${mo(pf.jobsAll.low)}. ` +
      `Yet the smaller decline took longer to reverse: all nonfarm employment ${back(pf.jobsAll)}, while local government education ${back(pf.jobsEd)}. ` +
      `That long rebuilding, followed by continued growth, may be one contributor to education's openings rate staying above its own pre-pandemic norm, but these data cannot establish that. (How the initial layoff shock differed is described with the charts in the first section.)`;
  }

  // NCES staff and enrollment, fall 2000 on (Digest Table 213.10): both Common Core of Data,
  // FTE staff and fall membership, consistently defined.
  function renderStaffingNces() {
    const fig = $('#fig-ratio-staff');
    if (!T || !fig) { if (fig) fig.hidden = true; return; }
    const y0 = T.years[0], y1 = T.years[T.years.length - 1];
    const years = []; for (let y = y0; y <= y1; y++) years.push(y);
    const at = (arr, y) => { const i = T.years.indexOf(y); return i < 0 ? null : arr[i]; };
    const idx = (arr) => years.map((y) => (at(arr, y) == null ? null : (at(arr, y) / at(arr, y0)) * 100));
    lineChart($('#chart-ratio-staff'), {
      x: years.map(String), cat: true, xTitle: (i) => `Fall ${years[i]}`, height: 340, endLabels: true, xHead: 'Fall', aria: `Public school enrollment and staff, indexed to fall ${y0}`,
      csv: 'public_school_staff_and_enrollment_index.csv', csvDigits: 1, valueLabel: `index, fall ${y0} = 100`,
      yMin: 'auto', yFmt: (v) => v.toFixed(1), yTick: (v) => `${+v.toFixed(1)}`, refs: [{ value: 100, label: '' }],
      series: [
        { id: 'aides', label: 'Instructional aides (FTE)', short: 'Instructional aides', color: 'var(--s3)', marker: 'circle', values: idx(T.aides) },
        { id: 'staff', label: 'All staff (FTE)', short: 'All staff', color: 'var(--s2)', marker: 'circle', values: idx(T.staff_total) },
        { id: 'teach', label: 'Teachers (FTE)', short: 'Teachers', color: 'var(--s1)', width: 2.5, marker: 'circle', values: idx(T.teachers) },
        { id: 'enr', label: 'Students (fall enrollment)', short: 'Students', color: 'var(--ink-2)', dash: '5 3', marker: 'circle', values: idx(T.enrollment) },
      ],
    });
    const chg = (arr, a, b) => ((at(arr, b) / at(arr, a)) - 1) * 100;
    const pc = (v) => `${v >= 0 ? 'up' : 'down'} ${Math.abs(v).toFixed(1)}%`;
    const pre = T.years.includes(2019) ? 2019 : null;
    const ppt = (y) => at(T.pupils_per_teacher, y).toFixed(1), pps = (y) => at(T.pupils_per_staff, y).toFixed(1);
    const fasterStaff = chg(T.staff_total, y0, y1) > chg(T.enrollment, y0, y1);
    $('#ratio-staff-lede').textContent =
      `For a longer-run comparison of public K-12 staffing and enrollment, NCES provides consistently defined figures through fall ${y1}. They show ${fasterStaff ? 'public schools adding staff faster than students' : 'staffing and enrollment moving roughly together'}. ` +
      `Between fall ${y0} and fall ${y1}, enrollment was ${pc(chg(T.enrollment, y0, y1))}, while full-time-equivalent teachers were ${pc(chg(T.teachers, y0, y1))}, all staff ${pc(chg(T.staff_total, y0, y1))}, and instructional aides ${pc(chg(T.aides, y0, y1))}. ` +
      (pre ? `Since fall ${pre}, just before the pandemic, enrollment was ${pc(chg(T.enrollment, pre, y1))} and all staff ${pc(chg(T.staff_total, pre, y1))} through fall ${y1}. ` : '') +
      `There were ${ppt(y1)} students per teacher in fall ${y1}, compared with ${ppt(y0)} in fall ${y0}, and ${pps(y1)} students per staff member, compared with ${pps(y0)}. ` +
      `More staff per student is not by itself a judgment about whether schools are over- or under-staffed: it can reflect services schools are required or choose to provide, such as special education and smaller classes, and the revenue available to pay for them. But it matters for reading vacancy data. Adding positions increases recruitment needs and spending commitments; whether that creates competition with existing positions depends on the roles, local candidate availability, and funding. These figures show how employment has changed. They do not identify whether today's vacancies arise from expansion, replacement hiring, or difficulty filling positions, and they end in fall ${y1}, well before the latest labor-market data above.`;
    $('#ratio-staff-title').textContent = `Public school staff and students, fall ${y0}–${y1}`;
    $('#ratio-staff-sub').textContent = `Full-time-equivalent staff and fall enrollment, public elementary and secondary schools, fall ${y0} = 100`;
  }

  // How the pandemic shock and later quits differed between education and the whole economy.
  // Facts are computed from the data; explanations are offered as competing hypotheses.
  function renderShock() {
    const host = $('#shock-note');
    const bi = idxOf('2020-02'), mi = idxOf('2020-03');
    if (!host || bi < 0 || mi < 0) return;
    const v = (k, i) => ser(k)[i];
    const ppAll = v('JTSLDR', mi) - v('JTSLDR', bi), ppEd = v('SLED_LDR', mi) - v('SLED_LDR', bi);
    // Yearly average quits as a percent of each series' own 2015-19 average, for complete years from 2020.
    const years = [];
    for (let y = 2020; ; y++) { const n = N.months.filter((m) => m.startsWith(`${y}-`)).length; if (n < 12) break; years.push(y); }
    const yrAvg = (k, y) => mean(N.months.map((m, i) => (m.startsWith(`${y}-`) ? ser(k)[i] : null)).filter((x) => x != null));
    const rel = (k) => { const b = avgBetween(k, '2015-01', '2019-12'); return years.map((y) => (yrAvg(k, y) / b) * 100); };
    const qa = rel('JTSQUR'), qe = rel('SLED_QUR');
    const at = (arr, y) => arr[years.indexOf(y)];
    const earlier = years.includes(2020) && at(qe, 2020) - at(qa, 2020) >= 10;
    const later = years.filter((y) => y >= 2023);
    const higherSince = later.length && later.every((y) => at(qe, y) > at(qa, y));
    const laterSpan = later.length ? (later.length > 1 ? `In each year from ${later[0]} through ${later[later.length - 1]}` : `In ${later[0]}`) : '';
    const show = (metric, label) => {
      const a = el('a', { href: '#fig-market', text: label });
      a.addEventListener('click', () => { $('#metric').value = metric; $('#metric').dispatchEvent(new Event('change')); });
      return a;
    };
    const yrs = `${years[0]}–${years[years.length - 1]}`;
    const above = (x) => { const d = Math.round(x - 100); return d === 0 ? 'about even with' : `${Math.abs(d)}% ${d > 0 ? 'above' : 'below'}`; };
    host.replaceChildren(
      el('p', {}, el('strong', { text: 'The pandemic shock was different in education. ' }),
        `When the pandemic began, the economy-wide layoffs and discharges rate rose from ${v('JTSLDR', bi).toFixed(1)}% in February 2020 to ${v('JTSLDR', mi).toFixed(1)}% in March, an increase of ${ppAll.toFixed(1)} percentage points. ` +
        `In state and local education (public schools and colleges, all staff) it rose from ${v('SLED_LDR', bi).toFixed(1)}% to ${v('SLED_LDR', mi).toFixed(1)}%, an increase of ${ppEd.toFixed(1)} points: a large rise from a low base, but a much smaller absolute disruption. ` +
        `That describes the initial spike, not the whole year. Total separations also include quits and other departures such as retirements, and BLS's 2021 analysis of annual separation counts found that separations in public education rose more in percentage terms from 2019 to 2020 than in the economy as a whole: 32.8% versus 19.9% (`,
        el('a', { href: 'https://www.bls.gov/opub/mlr/2021/article/as-the-covid-19-pandemic-affects-the-nation-hires-and-turnover-reach-record-highs-in-2020.htm', rel: 'noopener', text: 'BLS, 2021' }),
        `). Those are annual counts from that analysis, not the revised monthly rates shown in the charts.`),
      el('p', {},
        `Quits followed a different path as well. Averaged over ${yrs}, quits in state and local education ran ${above(mean(qe))} their own 2015–19 average, compared with ${above(mean(qa))} for all sectors. ` +
        (earlier ? `Education's quits rose earlier.` : `Education's quits moved on a different schedule.`) +
        (higherSince ? ` ${laterSpan}, education's annual average quit rate remained higher relative to its pre-pandemic norm than the economy-wide rate did.` : '') +
        ` So education's lower quit rates do not mean a smaller proportional increase.`),
      el('p', {},
        `These data cannot say why the paths differed, but the difference in the initial disruption is relevant. Sectors that shed many workers later recruited aggressively as demand recovered, drawing workers away from other employers and generating more quits and replacement hiring, a pattern documented for the broader recovery (`,
        el('a', { href: 'https://www.frbsf.org/research-and-insights/publications/economic-letter/2022/04/great-resignations-are-common-during-fast-recoveries/', rel: 'noopener', text: 'Hobijn, 2022' }),
        `). Education lost a smaller share of its jobs and rebuilt them more gradually (see public education employment, below), so it may have seen less of that churn. ` +
        `Another possibility is that some staff deferred departures during the uncertain early years of the pandemic and left later. These data cannot test either explanation or establish how much either contributed in education. To compare the series yourself, switch the charts above to `,
        show('LDR', 'layoffs and discharges'), ', ', show('QUR', 'quits'), ', or ', show('HIR', 'hires'), '.'),
    );
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
    const byJOR = [...N.industries].filter((r) => r.JOR != null).sort((a, b) => a.JOR - b.JOR);
    const rank = byJOR.findIndex((r) => r.code === '923000') + 1;
    const rankTxt = rank <= 3 ? ` That rate is among the lowest of the ${byJOR.length} industry series shown.`
      : rank > byJOR.length - 3 ? ` That rate is among the highest of the ${byJOR.length} industry series shown.` : '';
    // Relative wording follows the data, so the sentence stays accurate as new months arrive.
    const rel = (a, b) => (a < b * 0.85 ? 'lower than' : a > b * 1.15 ? 'higher than' : 'similar to');
    const jorRel = rel(ed.JOR, all.JOR), qurRel = rel(ed.QUR, all.QUR);
    const summary = jorRel === 'lower than' && qurRel === 'lower than'
      ? 'By these economy-wide measures, openings and quits in public education are both relatively low compared with other employers.'
      : jorRel === 'higher than' || qurRel === 'higher than'
        ? 'By at least one of these economy-wide measures, public education is running higher than other employers.'
        : 'By these economy-wide measures, public education looks broadly similar to other employers.';
    $('#ind-lede').replaceChildren(document.createTextNode(
      `In ${monthLabel(N.industry_month, true)}, state & local education had about ${num(ed.JOL)},000 job openings, an openings rate of ${pct(ed.JOR)}, compared with ${pct(all.JOR)} for all sectors and ${pct(xed.JOR)} for the rest of state and local government.${rankTxt} ` +
      `Its quits rate was ${qurRel} the all-sector rate (${pct(ed.QUR)} vs. ${pct(all.QUR)}). ${summary} ` +
      `That is useful context, but these rates do not directly measure how hard positions are to fill or how many workers schools lose. Openings also depend on how many positions employers are trying to fill and how long they stay open, and quits exclude retirements, which BLS counts separately. The picture can also look very different for particular positions and places.`));
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
      if (b === 'Computed') bits.push(st.rate_qualifier ? `computed; ${st.rate_qualifier}` : 'computed');
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
      { label: 'State series: published or computed', color: 'var(--s1)', marker: 'circle', width: 2.25 },
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
        grid.append(el('div', { class: 'panel' }, el('h4', { text: st.name }),
          el('p', { class: 'cov' }, `${st.coverage}. ${st.timing}. `, el('a', { href: `#def-${st.id}`, class: 'def-link', text: 'Definition and sources' })),
          st.panel_note ? el('p', { class: 'panel-note', text: st.panel_note }) : null, chart));
        statePanels[st.id] = lineChart(chart, panelCfg(st, f));
      }
    }
  }

  // School Pulse Panel: vacancy rates by role, latest October wave.
  function renderSppRoles() {
    const host = $('#chart-spp');
    if (!host || !P) { const fig = $('#fig-spp'); if (fig) fig.hidden = true; return; }
    const latest = P.waves.filter((w) => w.endsWith('-10')).pop();
    const yr = latest.slice(0, 4);
    const FLAG_TXT = { caution: 'NCES: interpret with caution', unreliable: 'NCES: reporting standards not met' };
    const ci = (v) => (v.se != null ? ` (95% CI ±${(1.96 * v.se).toFixed(1)})` : '') + (v.flag ? `; ${FLAG_TXT[v.flag]}` : '');
    const toRow = (r) => {
      const v = r.values[latest];
      return {
        label: (r.total ? (r.group === 'teaching' ? 'All teaching positions' : 'All non-teaching positions') : r.name) + (v && v.flag ? ' (!)' : ''),
        value: v ? v.pct : null,
        highlight: r.var === 'PCTVAC1TOT_oct', ref: r.var === 'PCTVAC2TOT_oct', raw: r,
        note: 'NCES School Pulse Panel. Percent of positions (filled + vacant) reported vacant; rounded to whole percents by NCES.' +
          (v && v.flag ? ` ${FLAG_TXT[v.flag]}: the standard error is large relative to the estimate.` : ''),
      };
    };
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
    $('#spp-lede').textContent = `Nationally, the most direct recent evidence on teacher vacancies comes from NCES's School Pulse Panel, which asked a national sample of public school leaders how many positions they had in each role ("filled + vacant") and how many were vacant. ` +
      `By that measure, ${Object.entries(sppTeach().values).sort().map(([k, v], i) => `${v.pct}%${i === 0 ? ' of teaching positions were vacant' : ''} in October ${k.slice(0, 4)}`).join(', ').replace(/, ([^,]*)$/, ', and $1')}. ` +
      (sppTeach().questionnaire_change ? `NCES cautions against reading these as a trend, though: the questionnaire changed between waves and no study measured how much that affected the estimates. ` : '') +
      `The share of schools with at least one vacant teaching position was ${Object.entries(sch).map(([k, v]) => `${v}% in ${k.slice(0, 4)}`).join(', ').replace(/, ([^,]*)$/, ', and $1')}. ` +
      `${higher.length > nonTeach.length / 2 ? 'As in Illinois, vacancy rates were generally higher for non-teaching staff than for teachers' : 'Vacancy rates for non-teaching staff were mixed relative to teachers'}: in October ${yr}, ${higher.length} of ${nonTeach.length} non-teaching roles had higher point estimates than teaching positions overall (not every difference is statistically distinguishable), led by ${higher.filter((r) => !/^other/i.test(r.name)).slice(0, 3).map((r) => `${r.name.toLowerCase()} (${r.values[latest].pct}%${r.values[latest].flag ? ', an estimate NCES flags as imprecise' : ''})`).join(', ')}. ` +
      `The survey's last staffing wave was October ${yr}, and NCES has not announced another.`;
  }

  // Why these states? A short summary of the 50-state inventory; the state-by-state
  // classifications, sources, and reasons are on the provenance page.
  function renderInventory() {
    const host = $('#inventory-summary');
    if (!host || !I) return;
    const n = (c) => I.states.filter((s) => s.category === c).length;
    const cand = I.states.filter((s) => s.category === 'candidate').map((s) => s.state);
    const list = cand.length > 1 ? `${cand.slice(0, -1).join(', ')}, and ${cand[cand.length - 1]}` : cand.join('');
    host.replaceChildren(
      el('p', {}, `Every state and DC was reviewed (full review completed ${longDate(I.full_review)}; inventory last updated ${longDate(I.as_of)}, with later changes recorded in the changes log). For most, this review did not find figures suitable for the rate comparisons shown here: for ${n('none')}, no statewide vacancy data were found; ${n('collects')} collect vacancy data, but no published statewide figures were found; ${n('counts')} publish counts without a matching denominator; and ${n('different')} publish figures that measure something else, such as job postings or positions not filled by fully licensed teachers. ` +
        `The closest candidates not yet shown (${list}) each lack at least one of these: a published rate, a clear definition and date, or consistent coverage. `,
        'The full inventory, with each state\'s sources and the reasons for its classification, is on the ', el('a', { href: 'provenance.html#inventory', text: 'data provenance page' }), '.'),
    );
  }

  function renderStatesTable() {
    const t = $('#states-table');
    t.querySelectorAll('thead,tbody').forEach((n) => n.remove());
    const change = (d) => (Math.abs(d) < 0.005 ? 'at peak' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} pts`);
    const stack = (main, sub, cls) => el('td', { class: cls }, main, sub ? el('br') : null, sub ? el('span', { class: 'dim small', text: sub }) : null);
    t.append(el('thead', {}, el('tr', {}, ['', 'Positions counted', 'When', 'Counts substitute-covered positions?', 'Latest rate', 'Peak in this series'].map((h, j) => el('th', { scope: 'col', class: [4, 5].includes(j) ? 'num' : null, text: h })))));
    const tb = el('tbody');
    // Alphabetical on purpose: the measures differ, so ordering by rate would imply a ranking.
    for (const st of [...S.states].sort((a, b) => a.name.localeCompare(b.name))) {
      const rated = st.points.map((p) => ({ p, r: rateOf(p) })).filter((x) => x.r.v != null);
      const latest = rated[rated.length - 1];
      const hi = rated.reduce((a, b) => (b.r.v > a.r.v ? b : a));
      const yr = latest.p.sy + (latest.p.agency_label && latest.p.agency_label !== latest.p.sy ? ` (state's label: ${latest.p.agency_label})` : '');
      tb.append(el('tr', {},
        el('th', { scope: 'row' }, el('a', { href: `#def-${st.id}`, text: st.name }), el('br'), el('span', { class: 'dim small', text: st.tier === 'snapshot' ? 'Start-of-year snapshot' : 'Different measure' })),
        el('td', { text: st.coverage }),
        el('td', { text: st.measure.timing_short }),
        el('td', { text: st.measure.substitutes_short }),
        stack(latest.r.text, `${yr} · ${latest.r.basis.toLowerCase()}${st.rate_qualifier && latest.r.basis === 'Computed' ? `; ${st.rate_qualifier}` : ''}`, 'num'),
        rated.length > 1 ? stack(`${hi.r.text} (${hi.p.sy})`, `latest vs. peak: ${change(latest.r.v - hi.r.v)}`, 'num') : el('td', { class: 'num dim', text: 'one year only' }),
      ));
    }
    const ne = S.nebraska.years[S.nebraska.years.length - 1];
    tb.append(el('tr', {}, el('th', { scope: 'row' }, el('a', { href: '#def-NE', text: 'Nebraska' }), el('br'), el('span', { class: 'dim small', text: 'Counts only' })), el('td', { text: S.nebraska.coverage }),
      el('td', { text: S.nebraska.measure.timing_short }), el('td', { text: S.nebraska.measure.substitutes_short }),
      stack('no rate', `${ne.sy} · counts only; no denominator published`, 'num dim'), el('td', {})));
    // National references: one row each, as [school year, value] pairs.
    const oct = N.october_nsa.filter((o) => o.year >= 2019);
    const spp = Object.entries(sppBySchoolYear()).sort();
    const nm = Object.fromEntries(S.national_measures.map((m) => [m.id, m]));
    const refs = [
      ...(spp.length ? [{ name: 'NCES School Pulse Panel, teaching (national)', id: 'spp', what: 'Public school teaching positions (survey estimate)', basis: 'Published (NCES), rounded', pts: spp.map(([sy, v]) => [sy, v.pct]), d: 0, noTrend: (sppTeach() || {}).questionnaire_change }] : []),
      { name: 'JOLTS state & local education (national)', id: 'jolts', what: 'All jobs in public schools and colleges; not seasonally adjusted', basis: 'Published (BLS)', pts: oct.map((o) => [o.school_year, o.sled_nsa]), d: 1 },
      { name: 'JOLTS all sectors (national)', id: 'jolts', what: 'All jobs, all employers; not seasonally adjusted', basis: 'Published (BLS)', pts: oct.map((o) => [o.school_year, o.total_nsa]), d: 1 },
    ];
    for (const r of refs) {
      const lo = r.pts[r.pts.length - 1];
      const hi = r.pts.reduce((a, c) => (c[1] > a[1] ? c : a));
      tb.append(el('tr', { class: 'bench-row' },
        el('th', { scope: 'row', class: 'dim' }, el('a', { href: `#def-${r.id}`, text: r.name }), ', benchmark'),
        el('td', { class: 'dim', text: r.what }),
        el('td', { class: 'dim', text: nm[r.id].timing_short }),
        el('td', { class: 'dim', text: nm[r.id].substitutes_short }),
        stack(`${lo[1].toFixed(r.d)}%`, `${lo[0]} · ${r.basis.replace(/^Published/, 'published')}`, 'num'),
        r.noTrend
          // NCES warns its questionnaire changed between waves, so no peak or change is computed.
          ? el('td', { class: 'dim small', text: 'Not compared across years: NCES warns that questionnaire changes limit comparability' })
          : stack(`${hi[1].toFixed(r.d)}% (${hi[0]})`, `latest vs. peak: ${change(lo[1] - hi[1])}`, 'num')));
    }
    t.append(tb);
  }
  // Definitions, sources, and limitations: the single detailed home for each measure.
  function renderStateDefs() {
    const box = $('#state-defs');
    const FIELDS = [
      ['counted', 'What counts'],
      ['includes_substitute_covered', 'Positions covered by substitutes or not-fully-qualified staff'],
      ['positions', 'Which positions'],
      ['timing', 'When'],
      ['denominator', 'Rate denominator'],
      ['coverage', 'Coverage'],
    ];
    const fields = (m) => el('dl', { class: 'prov-dl' }, FIELDS.flatMap(([k, h]) => [el('dt', { text: h }), el('dd', { text: m[k] || '–' })]));
    const sources = (list) => el('p', { style: 'margin-top:8px' }, 'Sources: ', ...list.flatMap((src, i) => [i ? ' · ' : '', el('a', { href: src.url, rel: 'noopener', text: src.label })]));
    const entry = (id, title, sub, body) => el('details', { id: `def-${id}` }, el('summary', {}, `${title} `, el('span', { text: `· ${sub}` })), el('div', { class: 'body' }, ...body));
    const states = [...S.states, { id: 'NE', name: 'Nebraska', agency: S.nebraska.agency, timing: S.nebraska.timing, measure: S.nebraska.measure, definition: S.nebraska.definition, sources: S.nebraska.sources, points: S.nebraska.years.map((y) => ({ sy: y.sy, note: `${y.vacant} vacant; ${y.unfilled} "unfilled" (broader measure).${y.note ? ' ' + y.note : ''}` })) }];
    const NATIONAL_SOURCES = {
      spp: [{ label: 'NCES School Pulse Panel', url: 'https://nces.ed.gov/surveys/spp/' }],
      jolts: [{ label: 'BLS Job Openings and Labor Turnover Survey', url: 'https://www.bls.gov/jlt/' }],
    };
    box.replaceChildren(
      ...states.map((st) => entry(st.id, st.name, `${st.agency} · ${st.timing}`, [
        fields(st.measure),
        el('p', {}, el('strong', { text: 'Qualifications. ' }), st.definition),
        el('p', { class: 'small', style: 'margin:8px 0 2px' }, el('strong', { text: 'Figures by school year' })),
        el('ul', {}, st.points.map((p) => el('li', {}, el('strong', { text: `${p.sy}${p.agency_label && p.agency_label !== p.sy ? ` (state's label: ${p.agency_label})` : ''}: ` }), (rateOf(p).v != null ? `${rateOf(p).text}. ` : ''), p.note || ''))),
        sources(st.sources),
      ])),
      ...S.national_measures.map((m) => entry(m.id, m.name, 'national benchmark', [fields(m), sources(NATIONAL_SOURCES[m.id] || [])])),
    );
    // Links to an entry (from chart panels and the table) open it.
    const openFromHash = () => { const d = location.hash.startsWith('#def-') && document.getElementById(location.hash.slice(1)); if (d) { d.open = true; d.scrollIntoView(); } };
    window.addEventListener('hashchange', openFromHash);
    openFromHash();
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
      `Pooled figures can hide differences in vacancy rates across staff categories. Illinois publishes filled and unfilled positions separately for different kinds of school staff. In ${ic.years[li]}, unfilled rates by ISBE's definition were ${latest.map((s) => `${s.v.toFixed(2)}% for ${s.name.toLowerCase()}`).join(', ')}, and ${allStaff.toFixed(2)}% across all four categories. ` +
      `${teachRank === 1 ? 'Teaching had the highest unfilled rate of the four.' : `Teaching did not have the highest unfilled rate: by this measure, shortages were most severe among ${latest[0].name.toLowerCase()}, a pattern that data on teachers alone would miss.`}`));
  }

  // Illinois: growth in filled FTE by category beside each category's vacancy rate. Both come from
  // ISBE's vacancy collection, so the categories match exactly; enrollment is from the Report Card.
  function renderIlGrowth() {
    const fig = $('#fig-il-growth');
    const ic = S.illinois_categories, en = S.illinois_enrollment;
    if (!fig || !ic.filled_school_year || !en || !en.by_school_year) { if (fig) fig.hidden = true; return; }
    // Filled counts are ISBE staff-record counts for the school year shown in filled_school_year.
    const fy = ic.filled_school_year, last = fy.length - 1, i0 = 0;
    const y0 = fy[i0], y1 = fy[last];
    const li = ic.years.length - 1;
    const rateAt = (c, i) => (c.unfilled[i] / (c.unfilled[i] + c.filled[i])) * 100;
    const rows = ic.categories.map((c) => {
      const all = c.name.startsWith('All');
      return { label: all ? 'All four categories' : c.name, ref: all, growth: ((c.filled[last] / c.filled[i0]) - 1) * 100, rate: rateAt(c, li), c };
    });
    const order = [...rows.filter((r) => !r.ref).sort((a, b) => b.growth - a.growth), ...rows.filter((r) => r.ref)];
    const enChg = ((en.by_school_year[y1] / en.by_school_year[y0]) - 1) * 100;
    const pc = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
    const g = el('div'), v = el('div');
    $('#chart-il-growth').replaceChildren(el('div', { class: 'grid2' },
      el('div', {}, el('h4', { class: 'tier-h', text: `Change in filled FTE, ${y0} to ${y1}` }), g),
      el('div', {}, el('h4', { class: 'tier-h', text: `Unfilled rate, ${ic.years[li]}` }), v)));
    hbarChart(g, order.map((r) => ({ label: r.label, value: r.growth, ref: r.ref, raw: r,
      note: `Filled FTE in ISBE staff records: ${num(r.c.filled[i0], 0)} in ${y0}, ${num(r.c.filled[last], 0)} in ${y1}.` })), {
      fmt: pc, tipRows: (row) => [{ value: pc(row.raw.growth), name: `filled FTE, ${y0} to ${y1}` }, { value: `${row.raw.rate.toFixed(2)}%`, name: `unfilled rate, ${ic.years[li]}` }],
    });
    hbarChart(v, order.map((r) => ({ label: r.label, value: r.rate, ref: r.ref, raw: r,
      note: `${num(r.c.unfilled[li], 0)} unfilled FTE in ${ic.years[li]}, against ${num(r.c.filled[li], 0)} filled (ISBE's prior-year count).` })), {
      fmt: (x) => `${x.toFixed(2)}%`, tipRows: (row) => [{ value: `${row.raw.rate.toFixed(2)}%`, name: `unfilled rate, ${ic.years[li]}` }, { value: pc(row.raw.growth), name: `filled FTE, ${y0} to ${y1}` }],
    });
    $('#il-growth-sub').textContent = `Same four categories in both panels, ordered by growth. Over the same years, statewide enrollment changed ${pc(enChg)}`;
    const top = order[0], teach = rows.find((r) => r.label === 'Teaching');
    const byRate = [...rows.filter((r) => !r.ref)].sort((a, b) => b.rate - a.rate);
    const sameTop = byRate[0] === top;
    const noun = { Paraprofessionals: 'paraprofessional', 'School support personnel': 'school support personnel', Administrators: 'administrator', Teaching: 'teaching' };
    const moved = (x) => `${x >= 0 ? 'grew' : 'fell'} ${Math.abs(x).toFixed(1)}%`;
    // How the fastest-growing category's unfilled rate moved over the years shown.
    const topRates = ic.years.map((_, i) => rateAt(top.c, i));
    const peakI = topRates.reduce((b, x, i) => (x > topRates[b] ? i : b), 0);
    const trend = peakI < li && topRates[peakI] - topRates[li] >= 0.5
      ? ` Meanwhile, the ${noun[top.label] || top.label.toLowerCase()} unfilled rate fell from ${topRates[peakI].toFixed(1)}% in ${ic.years[peakI]} to ${topRates[li].toFixed(2)}% in ${ic.years[li]}, even as filled positions grew: staffing growth, relatively high unfilled rates, and improving vacancy measures can all occur together.`
      : '';
    $('#il-growth-lede').textContent =
      `Illinois's data also show where schools were adding staff. Between ${y0} and ${y1}, filled ${noun[top.label] || top.label.toLowerCase()} positions ${moved(top.growth)}, compared with ${Math.abs(teach.growth).toFixed(1)}% for teaching positions, while statewide enrollment ${moved(enChg)}. ` +
      (sameTop ? `The category growing fastest also had the highest unfilled rate. That is consistent with greater recruitment needs in the categories schools were expanding, but it does not establish that expansion caused the vacancies:`
        : `The fastest-growing category was not the one with the highest unfilled rate, so staffing growth alone does not account for where unfilled rates were highest. In any case, these figures cannot establish causes:`) +
      ` growth in filled positions also enlarges the rate's denominator, and vacancies can also arise from replacement hiring or from positions that are slow to fill.${trend} The window is short and covers one state. Still, Illinois provides a more closely aligned comparison of staffing growth and reported unfilled rates by role than the national figures above, which come from different sources with different categories.`;
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
    // Shares only: an absolute "teacher openings" figure would invite being quoted as a count.
    parts.forEach((p) => { p.text = `${Math.round((p.value / jol) * 100)}%`; p.note = 'Illustration under equal vacancy rates, not a count.'; });
    $('#comp-sub').textContent = `Illustration: how ${monthLabel(N.latest_month, true)}'s state & local education openings would divide if every group had the same vacancy rate. Shares, not counts`;
    const host = $('#chart-comp');
    host.replaceChildren();
    stackBlock(host, parts, jol);
    host.append(stackLegend(parts));
    $('#comp-note').textContent = `An illustration, not a count of teacher vacancies. Local government, used here as a stand-in for K-12, is ${Math.round(kShare * 100)}% of state & local education payroll jobs (CES, ${monthLabel(N.latest_month)}); teachers are ${(tShare * 100).toFixed(1)}% of public K-12 staff FTE (NCES CCD, ${c.nces_year}), so the calculation also mixes jobs with FTE. Its main point is that teachers are a minority of what the JOLTS education line covers. It assumes every group has the same vacancy rate, which is unlikely: rates differ by role (see the School Pulse Panel figures above), in directions that depend on both turnover and how long positions stay open.`;
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
    $('#ne-rule').textContent = `Nebraska's data illustrate why this matters: of the ${num(l.unfilled, 2)} positions it counted as "unfilled" in ${l.sy}, ${num(l.vacant, 2)} were vacant. The other ${num(l.unfilled - l.vacant, 2)} were filled, but by staff who were not fully qualified for them. A position covered temporarily by a substitute while the district keeps recruiting is a different case: the district is still trying to fill it, and several states, including Iowa, count it as unfilled.`;
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
    run('shock', renderShock);
    run('staff-ratio', renderStaffingNces);
    run('industries', renderIndustries);
    run('states', renderStates);
    run('states-table', renderStatesTable);
    run('state-defs', renderStateDefs);
    run('inventory', renderInventory);
    run('spp', renderSppRoles);
    run('illinois', renderIllinois);
    run('il-growth', renderIlGrowth);
    run('composition', renderComposition);
    run('nebraska', renderNebraska);
    for (const id of ['#metric', '#range', '#smooth']) $(id).addEventListener('change', () => run('market', renderMarket));
    for (const id of ['#ind-metric', '#ind-sort']) $(id).addEventListener('change', () => run('industries', renderIndustries));
    $('#bench-long').addEventListener('change', () => run('states', renderStates));
    window.addEventListener('scroll', hideTip, { passive: true });
  }
  boot();
})();
