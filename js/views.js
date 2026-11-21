/* ParkSmart — Activity, Insights and Rates & setup views. */
(function () {
  'use strict';
  const PS = window.PS;
  const U = PS.util;
  const { $, $$, esc } = U;
  const store = PS.store;

  const views = (PS.views = {
    current: null,
    activity: { tab: 'parked', query: '', period: 24, limit: 100 },
    init() {
      wireActivity();
      wireSetup();
      wireInsights();
    },
    show(view) {
      views.current = view;
      if (view === 'activity') renderActivity();
      if (view === 'insights') renderInsights();
      if (view === 'setup') renderSetup();
    },
    refresh(reason) {
      if (views.current === 'activity') activitySoon();
      // Insights redraw on structural changes; arrivals and departures show up on the minute tick.
      if (views.current === 'insights' && ['reset', 'history', 'settings', 'baytype'].includes(reason)) insightsSoon();
      if (views.current === 'setup') renderSetup();
    },
    tick() {
      if (views.current === 'activity') renderActivity();
      if (views.current === 'insights') renderInsights();
    },
  });

  const activitySoon = U.debounce(() => views.current === 'activity' && renderActivity(), 120);
  const insightsSoon = U.debounce(() => views.current === 'insights' && renderInsights(), 400);

  function reportSave(result, okMsg) {
    if (result === 'saved') PS.app.toast(okMsg);
    else if (result === 'busy') PS.app.toast('Finish the save that is already open first.', { tone: 'warn' });
    else if (result === 'unavailable') PS.app.toast('Files cannot be saved from this view.', { tone: 'warn' });
  }

  const colorDot = (color) => `<i class="dot" style="--dot:${(PS.CAR_COLORS[color] || PS.CAR_COLORS.silver).hex}"></i>`;

  /* ---------- Activity ---------- */
  function parkedRows() {
    const q = U.plateKey(views.activity.query);
    const now = Date.now();
    return Object.entries(store.state.sessions)
      .map(([spot, s]) => ({ spot, s, ms: now - s.entered }))
      .filter((r) => !q || U.plateKey(r.s.plate).includes(q) || r.spot.includes(q))
      .sort((a, b) => b.ms - a.ms);
  }

  function historyRows() {
    const a = views.activity;
    const q = U.plateKey(a.query);
    const from = a.period ? Date.now() - a.period * 3600e3 : 0;
    const out = [];
    const h = store.state.history;
    for (let i = h.length - 1; i >= 0; i--) {
      const r = h[i];
      if (r.exited < from) break;
      if (q && !U.plateKey(r.plate).includes(q) && !r.spot.includes(q)) continue;
      out.push(r);
    }
    return out;
  }

  function renderActivity() {
    const box = $('#activity-table');
    const active = document.activeElement;
    const focused = active && box.contains(active) && active.dataset ? active.dataset.spot : null;
    drawActivity();
    if (focused) {
      const row = box.querySelector(`tr[data-spot="${focused}"]`);
      if (row) row.focus({ preventScroll: true });
    }
  }

  function drawActivity() {
    const a = views.activity;
    const parked = parkedRows();
    const history = historyRows();
    $('#count-parked').textContent = Object.keys(store.state.sessions).length;
    $('#count-history').textContent = history.length;
    $$('[data-tab]').forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.tab === a.tab));
      t.tabIndex = t.dataset.tab === a.tab ? 0 : -1;
    });
    $('#activity-period').hidden = a.tab !== 'history';
    const box = $('#activity-table');
    box.setAttribute('aria-labelledby', a.tab === 'parked' ? 'tab-parked' : 'tab-history');
    const settings = store.state.settings;
    const now = Date.now();

    if (a.tab === 'parked') {
      if (!parked.length) {
        box.innerHTML = empty(
          a.query ? `No parked car matches “${esc(a.query)}”.` : 'The lot is empty.',
          a.query ? 'Check the spelling, or look in History.' : 'Use New arrival to check the first car in.',
        );
        return;
      }
      const rows = parked.slice(0, a.limit).map(({ spot, s, ms }) => {
        const late = store.isOverstay(s, now);
        const type = store.typeOf(spot);
        const status = late
          ? `<span class="badge badge-late">Over limit</span>`
          : type === 'ev' && s.needs.ev
            ? `<span class="badge badge-ev">Charging</span>`
            : '';
        return `<tr class="is-clickable" data-spot="${spot}" tabindex="0">
          <td><span class="bay-chip t-${type}">${spot}</span></td>
          <td><span class="plate">${esc(s.plate)}</span></td>
          <td class="hide-sm">${colorDot(s.color)}${esc(PS.CAR_COLORS[s.color].name)} ${esc(U.lower(PS.VEHICLES[s.kind].name))}</td>
          <td class="num hide-sm">${esc(U.smartTime(s.entered, now))}</td>
          <td class="num">${U.duration(ms)}</td>
          <td class="num">${U.money(PS.pricing.quote(ms, settings).total)}</td>
          <td>${status}</td>
        </tr>`;
      });
      box.innerHTML = table(
        ['Bay', 'Plate', ['Vehicle', 'hide-sm'], ['Arrived', 'num hide-sm'], ['Parked for', 'num'], ['Fee so far', 'num'], ['Status', '']],
        rows,
        parked.length > a.limit,
      );
      return;
    }

    if (!history.length) {
      box.innerHTML = empty(
        a.query ? `No visits match “${esc(a.query)}”.` : 'No finished visits in this period.',
        a.query ? 'Try a longer period or a different plate.' : 'Visits appear here as cars check out.',
      );
      return;
    }
    const rows = history.slice(0, a.limit).map(
      (r) => `<tr>
        <td class="num">${esc(U.smartTime(r.exited, now))}</td>
        <td><span class="plate">${esc(r.plate)}</span></td>
        <td><span class="bay-chip t-${store.typeOf(r.spot)}">${r.spot}</span></td>
        <td class="num hide-sm">${esc(U.smartTime(r.entered, now))}</td>
        <td class="num">${U.duration(r.exited - r.entered)}</td>
        <td class="num">${r.fee ? U.money(r.fee) : '<span class="muted">Free</span>'}</td>
        <td class="hide-sm">${esc(PS.PAYMENT_METHODS[r.method])}</td>
      </tr>`,
    );
    box.innerHTML = table(
      [['Left', 'num'], 'Plate', 'Bay', ['Arrived', 'num hide-sm'], ['Time parked', 'num'], ['Paid', 'num'], ['Method', 'hide-sm']],
      rows,
      history.length > a.limit,
    );
  }

  function table(cols, rows, more) {
    const head = cols
      .map((c) => (Array.isArray(c) ? `<th scope="col" class="${c[1]}">${c[0]}</th>` : `<th scope="col">${c}</th>`))
      .join('');
    return `<table class="table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>
      ${more ? `<div class="table-more"><button type="button" class="btn btn-quiet" data-act="more">Show more</button></div>` : ''}`;
  }

  const empty = (title, body) => `<div class="empty"><p class="empty-title">${title}</p><p>${body}</p></div>`;

  function exportActivity() {
    const a = views.activity;
    const now = Date.now();
    let rows;
    let name;
    if (a.tab === 'parked') {
      rows = [['Bay', 'Plate', 'Vehicle', 'Color', 'Arrived', 'Minutes parked', 'Fee so far']];
      for (const { spot, s, ms } of parkedRows()) {
        rows.push([spot, s.plate, PS.VEHICLES[s.kind].name, PS.CAR_COLORS[s.color].name, new Date(s.entered).toISOString(), Math.floor(ms / 60000), (PS.pricing.quote(ms, store.state.settings).total / 100).toFixed(2)]);
      }
      name = 'parksmart-parked';
    } else {
      rows = [['Left', 'Plate', 'Bay', 'Arrived', 'Minutes parked', 'Paid', 'Method']];
      for (const r of historyRows()) {
        rows.push([new Date(r.exited).toISOString(), r.plate, r.spot, new Date(r.entered).toISOString(), Math.round((r.exited - r.entered) / 60000), (r.fee / 100).toFixed(2), PS.PAYMENT_METHODS[r.method]]);
      }
      name = 'parksmart-history';
    }
    if (rows.length === 1) return PS.app.toast('There is nothing to export.', { tone: 'warn' });
    const date = new Date(now).toISOString().slice(0, 10);
    U.saveFile(`${name}-${date}.csv`, U.csv(rows), 'text/csv').then((r) => reportSave(r, `Exported ${U.plural(rows.length - 1, 'row', 'rows')}.`));
  }

  function wireActivity() {
    const tabs = $('#activity-tabs');
    tabs.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (!t) return;
      views.activity.tab = t.dataset.tab;
      views.activity.limit = 100;
      renderActivity();
    });
    tabs.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const next = views.activity.tab === 'parked' ? 'history' : 'parked';
      views.activity.tab = next;
      renderActivity();
      $(`[data-tab="${next}"]`).focus();
    });
    $('#activity-search').addEventListener('input', (e) => {
      views.activity.query = e.target.value;
      views.activity.limit = 100;
      activitySoon();
    });
    $('#activity-period').addEventListener('change', (e) => {
      views.activity.period = Number(e.target.value);
      renderActivity();
    });
    $('#btn-export-csv').addEventListener('click', exportActivity);
    const box = $('#activity-table');
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="more"]')) {
        views.activity.limit += 200;
        return renderActivity();
      }
      const row = e.target.closest('tr[data-spot]');
      if (row) PS.focusVehicle(row.dataset.spot);
    });
    box.addEventListener('keydown', (e) => {
      const row = e.target.closest('tr[data-spot]');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        PS.focusVehicle(row.dataset.spot);
      }
    });
  }

  /* ---------- Insights ---------- */
  let insightsWidth = 0;
  function renderInsights() {
    const box = $('#insights');
    const now = Date.now();
    const s = PS.stats.summary(now);
    if (!s.visits && s.peak.v === 0) {
      box.innerHTML = `
        <div class="card empty">
          <p class="empty-title">Nothing to show yet</p>
          <p>Insights cover the last 24 hours and fill in as cars check in and out.</p>
          <div class="btn-row empty-actions">
            <button type="button" class="btn btn-primary" data-act="arrival">New arrival</button>
            <button type="button" class="btn btn-quiet" data-act="simulate">Simulate traffic</button>
          </div>
        </div>`;
      insightsWidth = box.clientWidth;
      return;
    }
    const occNow = s.series[s.series.length - 1];
    const lengthMax = Math.max(1, ...s.lengthBins.map((b) => b.n));
    const methodTotal = Object.values(s.methods).reduce((a, b) => a + b, 0);
    const methodRows = Object.entries(s.methods).filter(([, v]) => v > 0);

    box.innerHTML = `
      <div class="insights-head">
        <h2>Last 24 hours</h2>
        <p class="muted">Updated ${esc(U.time(now))}</p>
      </div>
      <dl class="kpis">
        <div class="kpi"><dt>Revenue</dt><dd>${U.money(s.revenue)}</dd></div>
        <div class="kpi"><dt>Finished visits</dt><dd>${s.visits}</dd></div>
        <div class="kpi"><dt>Average stay</dt><dd>${s.visits ? U.duration(s.avgStay) : '–'}</dd></div>
        <div class="kpi"><dt>Busiest moment</dt><dd>${U.pct(s.peak.v)}<small>full at ${esc(U.smartTime(s.peak.t, now))}</small></dd></div>
        <div class="kpi"><dt>Visits per bay</dt><dd>${s.turnover.toFixed(1)}</dd></div>
      </dl>
      <section class="block block-wide" aria-labelledby="h-occ">
        <header class="block-head">
          <h3 id="h-occ">Occupancy</h3>
          <p>${U.pct(occNow.v)} full now. Sampled every 15 minutes.</p>
        </header>
        <div class="chart" id="chart-occ" role="img" aria-label="Occupancy over the last 24 hours. Peak ${U.pct(s.peak.v)} at ${esc(U.smartTime(s.peak.t, now))}, now ${U.pct(occNow.v)}."></div>
      </section>
      <div class="insights-grid">
        <section class="block" aria-labelledby="h-rev">
          <header class="block-head"><h3 id="h-rev">Revenue by hour</h3><p>Fees collected at check-out.</p></header>
          <div class="chart" id="chart-rev" role="img" aria-label="Revenue per hour over the last 24 hours, ${U.money(s.revenue)} in total."></div>
        </section>
        <section class="block" aria-labelledby="h-len">
          <header class="block-head"><h3 id="h-len">Length of stay</h3><p>Finished visits by time parked.</p></header>
          <ul class="hbars">
            ${s.lengthBins
              .map(
                (b) => `<li><span class="hbar-label">${b.label}</span><span class="hbar-track"><span class="hbar-fill" style="width:${(b.n / lengthMax) * 100}%"></span></span><span class="hbar-val">${b.n}</span></li>`,
              )
              .join('')}
          </ul>
        </section>
        <section class="block" aria-labelledby="h-busy">
          <header class="block-head"><h3 id="h-busy">Busiest bays</h3><button type="button" class="link-btn" data-act="heatmap">See the heatmap</button></header>
          <ol class="rank">
            ${s.busiest
              .map(
                (b) => `<li><span class="bay-chip t-${store.typeOf(b.id)}">${b.id}</span><span class="hbar-track"><span class="hbar-fill hbar-busy" style="width:${b.share * 100}%"></span></span><span class="hbar-val">${U.pct(b.share)}</span></li>`,
              )
              .join('')}
          </ol>
          <p class="block-foot">Quietest: ${s.quietest.map((b) => `${b.id} (${U.pct(b.share)})`).join(', ')}.</p>
        </section>
        <section class="block" aria-labelledby="h-pay">
          <header class="block-head"><h3 id="h-pay">How people paid</h3><p>Share of revenue.</p></header>
          ${
            methodTotal
              ? `<div class="stack" role="img" aria-label="${methodRows.map(([k, v]) => `${PS.PAYMENT_METHODS[k]} ${U.pct(v / methodTotal)}`).join(', ')}">
                  ${methodRows.map(([k, v]) => `<span class="stack-part pay-${k}" style="flex:${v}"></span>`).join('')}
                </div>
                <ul class="stack-legend">
                  ${methodRows.map(([k, v]) => `<li><i class="dot pay-${k}"></i>${PS.PAYMENT_METHODS[k]}<span>${U.money(v)}</span><span class="muted">${U.pct(v / methodTotal)}</span></li>`).join('')}
                </ul>`
              : `<p class="muted">No paid visits yet.</p>`
          }
        </section>
      </div>`;

    PS.charts.area($('#chart-occ'), s.series, { height: 230 });
    PS.charts.bars($('#chart-rev'), s.buckets, { height: 200 });
    insightsWidth = box.clientWidth;
  }

  function wireInsights() {
    const box = $('#insights');
    box.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      location.hash = '#map';
      setTimeout(() => {
        if (act.dataset.act === 'heatmap' && !PS.map.heat) $('#btn-heat').click();
        if (act.dataset.act === 'arrival') $('#btn-arrival').click();
        if (act.dataset.act === 'simulate' && !PS.simRunning()) PS.setSimulation(true, true);
      }, 60);
    });
    if ('ResizeObserver' in window) {
      new ResizeObserver(
        U.debounce(() => {
          if (views.current === 'insights' && Math.abs(box.clientWidth - insightsWidth) > 4) renderInsights();
        }, 150),
      ).observe(box);
    }
  }

  /* ---------- Rates & setup ---------- */
  const NUMERIC = {
    graceMinutes: { min: 0, max: 240 },
    firstHour: { min: 0, max: 10000 },
    extraHour: { min: 0, max: 10000 },
    dailyMax: { min: 0, max: 100000 },
    maxStayHours: { min: 0, max: 168 },
  };

  function renderSetup() {
    const form = $('#setup-form');
    const st = store.state.settings;
    for (const [key, value] of Object.entries(st)) {
      const input = form.elements[key];
      if (!input || input === document.activeElement || input.type === 'radio') continue;
      if (String(input.value) !== String(value)) input.value = value;
    }
    $$('.unit-currency').forEach((n) => (n.textContent = currencySymbol(st.currency)));
    renderPreview();
    const counts = { standard: 0, ev: 0, accessible: 0 };
    PS.BAYS.forEach((b) => counts[store.typeOf(b.id)]++);
    $('#bay-summary').textContent = `${U.plural(counts.ev, 'EV charging bay', 'EV charging bays')}, ${U.plural(counts.accessible, 'accessible bay', 'accessible bays')} and ${counts.standard} standard. ${PS.BAYS.length} bays in all.`;
    $('#sim-toggle').checked = PS.simRunning();
    const hist = store.state.history.length;
    $('#data-summary').textContent = `${U.plural(Object.keys(store.state.sessions).length, 'car', 'cars')} parked and ${U.plural(hist, 'finished visit', 'finished visits')} saved in this browser.`;
  }

  function currencySymbol(code) {
    try {
      const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).formatToParts(0);
      return (parts.find((p) => p.type === 'currency') || {}).value || code;
    } catch (e) {
      return code;
    }
  }

  function renderPreview() {
    const st = store.state.settings;
    const rows = PS.pricing.PREVIEW.map((p) => {
      const q = PS.pricing.quote(p.ms, st);
      return `<tr><th scope="row">${p.label}</th><td class="num">${q.total ? U.money(q.total) : 'Free'}</td></tr>`;
    }).join('');
    $('#price-preview').innerHTML = `<caption>What a stay costs</caption><tbody>${rows}</tbody>`;
  }

  function wireSetup() {
    const form = $('#setup-form');
    const sel = form.elements.currency;
    sel.innerHTML = PS.CURRENCIES.map((c) => `<option value="${c}">${c}</option>`).join('');
    const saveText = U.debounce((key, value) => store.updateSettings({ [key]: value }), 300);

    form.addEventListener('input', (e) => {
      const t = e.target;
      const key = t.name;
      if (!key || !(key in store.state.settings)) return;
      if (key === 'lotName') return saveText(key, t.value.trim().slice(0, 40) || 'Parking lot');
      if (key === 'currency') return store.updateSettings({ currency: t.value });
      if (NUMERIC[key]) {
        const v = Number(t.value);
        const { min, max } = NUMERIC[key];
        const ok = t.value !== '' && Number.isFinite(v) && v >= min && v <= max;
        t.setAttribute('aria-invalid', String(!ok));
        const err = form.querySelector(`[data-error-for="${key}"]`);
        if (err) {
          err.hidden = ok;
          err.textContent = ok ? '' : `Enter a number from ${min} to ${max}.`;
        }
        if (ok) saveText(key, key === 'graceMinutes' ? Math.round(v) : Math.round(v * 100) / 100);
      }
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('change', (e) => {
      if (e.target.name === 'currency') store.updateSettings({ currency: e.target.value });
    });

    $('#sim-toggle').addEventListener('change', (e) => PS.setSimulation(e.target.checked, true));
    $('#btn-edit-bays').addEventListener('click', () => {
      location.hash = '#map';
      setTimeout(() => PS.setEditMode(true), 60);
    });
    $('#btn-demo').addEventListener('click', async () => {
      const ok = await PS.app.confirmDialog({
        title: 'Load demo data?',
        message: 'This replaces the parked cars and visit history with a made-up day. Your rates and bay types stay.',
        confirm: 'Load demo data',
      });
      if (ok) {
        store.loadDemo();
        PS.app.toast('Demo data loaded.');
      }
    });
    $('#btn-export-json').addEventListener('click', () => {
      const date = new Date().toISOString().slice(0, 10);
      U.saveFile(`parksmart-backup-${date}.json`, store.exportJSON(), 'application/json').then((r) => reportSave(r, 'Backup saved.'));
    });
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      let clean;
      try {
        clean = store.parseBackup(await file.text());
      } catch (err) {
        PS.app.toast(err.userFacing ? err.message : 'That file could not be read.', { tone: 'warn' });
        return;
      }
      const parked = Object.keys(clean.sessions).length;
      const ok = await PS.app.confirmDialog({
        title: 'Restore this backup?',
        message: `Everything saved now will be replaced with ${U.plural(parked, 'parked car', 'parked cars')} and ${U.plural(clean.history.length, 'finished visit', 'finished visits')} from ${file.name}.`,
        confirm: 'Restore backup',
      });
      if (!ok) return;
      PS.setSimulation(false);
      store.restoreBackup(clean);
      PS.app.toast('Backup restored.');
    });
    $('#btn-clear-history').addEventListener('click', async () => {
      const ok = await PS.app.confirmDialog({
        title: 'Clear visit history?',
        message: 'All finished visits and their revenue are deleted. Cars parked right now stay.',
        confirm: 'Clear history',
      });
      if (ok) {
        store.clearHistory();
        PS.app.toast('History cleared.');
      }
    });
    $('#btn-clear-all').addEventListener('click', async () => {
      const ok = await PS.app.confirmDialog({
        title: 'Empty the lot?',
        message: 'Every parked car and all history are removed, so you can start with your own data. Rates and bay types stay.',
        confirm: 'Empty the lot',
      });
      if (ok) {
        PS.setSimulation(false);
        store.clearAll();
        PS.app.toast('The lot is empty and ready for real cars.');
      }
    });
  }
})();
