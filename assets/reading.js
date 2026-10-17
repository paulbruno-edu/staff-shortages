/* Further reading page: renders data/reading.json. Each reading is listed under every theme
   in its "themes" list; readings with "start_here" also get a card in the Start here row. */
(async function () {
  const TYPE_LABEL = { research: "Research", synthesis: "Review", essay: "Essay" };
  const SHORT = {
    defining: "Definitions", vacancies: "Vacancy rates", staff: "Beyond teachers", market: "Labor market",
    size: "Workforce size", pipeline: "Pipeline", pandemic: "The pandemic period", levers: "What helps",
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const themesEl = document.getElementById("themes");

  let data;
  try {
    const r = await fetch("data/reading.json");
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
  } catch (e) {
    themesEl.innerHTML = '<p class="error">The reading list could not be loaded.</p>';
    return;
  }
  const { themes, readings } = data;
  const themeById = Object.fromEntries(themes.map((t) => [t.id, t]));

  const cite = (e) => {
    const end = /[?!]$/.test(e.title) ? "" : ".";
    return `${esc(e.authors)} (${esc(e.year)}). <span class="ttl"><a href="${esc(e.url)}">${esc(e.title)}</a></span>${end} <em>${esc(e.venue)}</em>.`;
  };

  const entry = (e, i, here) => {
    const tags = [`<span class="tag">${TYPE_LABEL[e.type]}</span>`];
    if (e.start_here) tags.push('<span class="tag start">Start here</span>');
    if (e.different_measure) tags.push(`<span class="tag diff" title="Measures shortages differently from the dashboard">Different measure: ${esc(e.different_measure)}</span>`);
    if (e.by_author) tags.push('<span class="tag own">By the dashboard\'s author</span>');
    const others = e.themes.filter((id) => id !== here).map((id) => themeById[id]);
    if (others.length) tags.push(`<span>Also in: ${others.map((t) => `<a href="#${t.id}">${esc(t.heading.replace(/\?$/, ""))}</a>`).join(", ")}</span>`);
    return `<li class="entry" data-type="${e.type}" data-i="${i}">
      <p class="cite">${cite(e)}</p>
      <p class="note">${esc(e.note)}</p>
      <p class="meta">${tags.join(" ")}</p>
    </li>`;
  };

  // Start here cards
  document.getElementById("start-grid").innerHTML = readings
    .filter((e) => e.start_here)
    .sort((a, b) => a.start_here.order - b.start_here.order)
    .map((e) => {
      const s = e.start_here;
      const first = e.authors.split(",")[0];
      return `<div class="start-card">
        <div class="n">${s.order} · ${TYPE_LABEL[e.type]}</div>
        <h3><a href="${esc(e.url)}">${esc(s.title || e.title.split(":")[0])}</a></h3>
        <p>${esc(first)}${e.authors.includes("&") ? " et al." : ""} (${esc(e.year)}), <em>${esc(s.venue || e.venue.split(",")[0])}</em></p>
        <p class="why">${esc(s.why)}</p>
      </div>`;
    })
    .join("");
  const nStart = readings.filter((e) => e.start_here).length;
  document.getElementById("start-count").textContent = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][nStart] || String(nStart);

  // Theme sections, and their links in the section bar
  const toc = document.getElementById("toc");
  themesEl.innerHTML = themes
    .map((t) => {
      toc.insertAdjacentHTML("beforeend", `<a href="#${t.id}">${esc(SHORT[t.id] || t.heading)}</a>`);
      const items = readings.map((e, i) => [e, i]).filter(([e]) => e.themes.includes(t.id));
      return `<section id="${t.id}">
        <h2>${esc(t.heading)}</h2>
        <p class="theme-q">${esc(t.question)}</p>
        <p class="small">On the dashboard: <a href="${esc(t.dashboard_link)}">${esc(t.dashboard_label)}</a></p>
        <ul class="entries">${items.map(([e, i]) => entry(e, i, t.id)).join("")}</ul>
        <p class="empty" hidden>No sources of this type in this section.</p>
      </section>`;
    })
    .join("");

  // Type filter
  const chips = document.querySelectorAll(".chip");
  const apply = (f) => {
    chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.f === f)));
    const shown = new Set();
    themesEl.querySelectorAll("section").forEach((sec) => {
      let n = 0;
      sec.querySelectorAll(".entry").forEach((li) => {
        const on = f === "all" || li.dataset.type === f;
        li.hidden = !on;
        if (on) { n++; shown.add(li.dataset.i); }
      });
      sec.querySelector(".empty").hidden = n > 0;
    });
    document.getElementById("count").textContent = `${shown.size} of ${readings.length} readings shown.`;
  };
  chips.forEach((c) => c.addEventListener("click", () => apply(c.dataset.f)));
  apply("all");

  // Jump to a section named in the address once it exists
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
