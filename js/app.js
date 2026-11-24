/* ParkSmart — application shell
 * Wires the top bar, side panel, receipt dialog, search, keyboard
 * shortcuts, the traffic simulation and hash routing together.
 */
(function () {
  'use strict';
  const PS = window.PS;
  const U = PS.util;
  const { $, $$, esc } = U;
  const store = PS.store;
  const map = PS.map;

  /* ---------- Icons ---------- */
  const svgIcon = (body) =>
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON = {
    close: svgIcon('<path d="M6 6l12 12M18 6L6 18"/>'),
    bolt: svgIcon('<path d="M13.2 2L4.6 13.4h6.2L9.8 22l8.6-11.6h-6.2z" fill="currentColor" stroke="none"/>'),
    wheel: svgIcon('<circle cx="11" cy="4.2" r="2.1" fill="currentColor" stroke="none"/><path d="M10 7.6v6h6l2.4 5.4"/><path d="M10 10.6h5"/><path d="M7.4 11.3a5.6 5.6 0 1 0 7.7 6.3"/>'),
    route: svgIcon('<circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M8.4 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.6"/>'),
    move: svgIcon('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
    print: svgIcon('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
    check: svgIcon('<circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/>'),
    warn: svgIcon('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.1"/>'),
  };
  PS.ICON = ICON;

  function miniCar(kind, color, cls = 'mini-car') {
    const hex = (PS.CAR_COLORS[color] || PS.CAR_COLORS.silver).hex;
    return `<svg class="${cls}" viewBox="-48 -21 96 42" aria-hidden="true"><g transform="rotate(90)">${map.carMarkup(kind, hex)}</g></svg>`;
  }
  PS.miniCar = miniCar;

  /* ---------- Small UI services ---------- */
  function announce(msg) {
    const node = $('#announcer');
    node.textContent = '';
    setTimeout(() => (node.textContent = msg), 30);
  }

  function toast(msg, { action, onAction, tone } = {}) {
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = `toast${tone ? ' toast-' + tone : ''}`;
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-action">${esc(action)}</button>` : ''}`;
    if (action) {
      t.querySelector('button').addEventListener('click', () => {
        t.remove();
        if (onAction) onAction();
      });
    }
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    const life = action ? 7000 : 3800;
    setTimeout(() => t.classList.add('is-leaving'), life);
    setTimeout(() => t.remove(), life + 400);
  }

  function confirmDialog({ title, message, confirm, danger = true }) {
    const dlg = $('#confirm-dialog');
    dlg.innerHTML = `
      <form method="dialog" class="dialog-card">
        <h2 id="confirm-title">${esc(title)}</h2>
        <p>${esc(message)}</p>
        <div class="dialog-actions">
          <button value="cancel" class="btn btn-quiet">Cancel</button>
          <button value="ok" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}">${esc(confirm)}</button>
        </div>
      </form>`;
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
      dlg.returnValue = 'cancel';
      dlg.showModal();
      dlg.querySelector('[value="cancel"]').focus();
    });
  }

  const isTyping = (e) => {
    const t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  };
  const finePointer = () => window.matchMedia('(pointer: fine)').matches;
  const excluded = () => [...map.busy, ...map.held.keys()];

  PS.app = { toast, announce, confirmDialog };

  /* ---------- Theme ----------
   * "Match system" follows the operating system, or the theme of a host
   * page that embeds ParkSmart and sets data-theme itself.
   */
  let hostTheme = window.PS_HOST_THEME || '';
  let themeWritten = null;
  function applyTheme() {
    const theme = store.state.settings.theme;
    const root = document.documentElement;
    const want = theme === 'light' || theme === 'dark' ? theme : hostTheme;
    themeWritten = want;
    if (want) root.dataset.theme = want;
    else delete root.dataset.theme;
    $$('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === theme)));
  }
  function watchHostTheme() {
    new MutationObserver(() => {
      const now = document.documentElement.dataset.theme || '';
      if (now === themeWritten) return;
      hostTheme = now;
      applyTheme();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  /* Some embedding hosts block the print dialog; they say so with PS.host.noPrint. */
  const canPrint = !(PS.host && PS.host.noPrint);

  /* ---------- Top bar ---------- */
  function renderTopbar() {
    const c = store.counts();
    const sign = $('#guidance');
    const full = c.free === 0;
    sign.classList.toggle('is-full', full);
    $('#free-count').textContent = full ? 'Full' : c.free;
    $('#free-word').textContent = full ? '' : 'free';
    $('#ev-free').textContent = c.evFree;
    $('#acc-free').textContent = c.accFree;
    sign.setAttribute(
      'aria-label',
      full ? 'The lot is full' : `${c.free} of ${c.total} bays free, ${c.evFree} with charging, ${c.accFree} accessible`,
    );
    const occ = c.occupied / c.total;
    $('#occ-bar').style.width = `${occ * 100}%`;
    $('#occ-text').textContent = `${U.pct(occ)} full`;
    $('#occ').classList.toggle('is-high', occ >= 0.9);
    $('#rev-24').textContent = U.money(store.revenueSince(Date.now() - 24 * 3600e3));
    const late = $('#late-count');
    late.hidden = !c.overstay;
    late.textContent = c.overstay ? `${c.overstay} over limit` : '';
    $('#lot-name').textContent = store.state.settings.lotName || 'Parking lot';
  }

  /* ---------- Side panel ---------- */
  const panel = {
    mode: null, // checkin | occupied | move
    spot: null,
    arrival: false,
    manual: false,
    submitting: false,
    suggestion: null,
    form: { plate: '', kind: 'car', color: 'white', needs: { ev: false, accessible: false } },
  };
  PS.panel = panel;
  const panelEl = () => $('#panel');

  function showPanel() {
    const p = panelEl();
    p.classList.remove('is-idle');
    $('#main').classList.add('has-sheet');
    const wasHidden = p.hidden;
    p.hidden = false;
    if (wasHidden) requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('is-open')));
    else p.classList.add('is-open');
  }

  function closePanel({ restoreFocus = false } = {}) {
    const wasMode = panel.mode;
    const spot = panel.spot;
    if (map.mode === 'move') map.setMode('normal');
    panel.mode = null;
    panel.spot = null;
    panel.arrival = false;
    panel.manual = false;
    panel.suggestion = null;
    map.showRoute(null);
    map.select(null);
    showIdle();
    if (restoreFocus && wasMode && spot) map.focusBay(spot);
  }

  /* ---------- Idle overview ----------
   * On wide screens the side panel never goes away: with no bay chosen it
   * shows who has been parked longest and the latest comings and goings,
   * so the map keeps its size and nothing jumps under the pointer.
   */
  const wide = window.matchMedia('(min-width: 900px)');

  function showIdle() {
    const p = panelEl();
    $('#main').classList.remove('has-sheet');
    if (!wide.matches) {
      p.classList.remove('is-open');
      p.hidden = true;
      p.innerHTML = '';
      return;
    }
    p.hidden = false;
    p.classList.add('is-open', 'is-idle');
    renderIdle();
  }

  function renderIdle() {
    const p = panelEl();
    if (panel.mode || p.hidden) return;
    p.classList.add('is-idle');
    if (map.mode === 'edit') return renderRepaint();
    const st = store.state;
    const now = Date.now();
    const parked = Object.entries(st.sessions)
      .filter(([spot]) => !map.arriving.has(spot))
      .sort((a, b) => a[1].entered - b[1].entered)
      .slice(0, 5);
    const events = [];
    for (const [spot, s] of Object.entries(st.sessions)) events.push({ t: s.entered, kind: 'in', spot, plate: s.plate, live: true });
    for (let i = st.history.length - 1; i >= 0 && i >= st.history.length - 12; i--) {
      const h = st.history[i];
      events.push({ t: h.exited, kind: 'out', spot: h.spot, plate: h.plate, fee: h.fee });
      events.push({ t: h.entered, kind: 'in', spot: h.spot, plate: h.plate });
    }
    events.sort((a, b) => b.t - a.t);
    const latest = events.slice(0, 6);
    const longRows = parked.length
      ? parked
          .map(([spot, s]) => {
            const late = store.isOverstay(s, now);
            return `<li><button type="button" class="idle-row" data-spot="${spot}">
              <span class="bay-chip t-${store.typeOf(spot)}">${spot}</span><span class="plate">${esc(s.plate)}</span>
              <span class="idle-meta${late ? ' is-late' : ''}">${U.duration(now - s.entered)}</span></button></li>`;
          })
          .join('')
      : `<li class="idle-empty">No cars parked.</li>`;
    const eventRows = latest.length
      ? latest
          .map(
            (e) => `<li class="idle-event"><i class="act-mark act-${e.kind}" aria-hidden="true"></i>
              <span class="idle-what"><span class="plate">${esc(e.plate)}</span> ${e.kind === 'in' ? 'arrived in' : 'left'} ${e.spot}${e.kind === 'out' && e.fee ? `, paid ${U.money(e.fee)}` : ''}</span>
              <span class="idle-meta">${esc(U.smartTime(e.t, now))}</span></li>`,
          )
          .join('')
      : `<li class="idle-empty">Arrivals and departures will show up here.</li>`;
    p.innerHTML = `
      <div class="panel-head">
        <div class="panel-head-text">
          <h2 id="panel-title" tabindex="-1">Right now</h2>
          <p class="panel-sub">Click a bay on the map to check a car in or out.</p>
        </div>
      </div>
      <div class="panel-body">
        <section class="idle-block" aria-labelledby="idle-long">
          <h3 id="idle-long">Parked longest</h3>
          <ol class="idle-list">${longRows}</ol>
        </section>
        <section class="idle-block" aria-labelledby="idle-latest">
          <h3 id="idle-latest">Latest activity</h3>
          <ol class="idle-list">${eventRows}</ol>
        </section>
      </div>`;
  }
  const renderIdleSoon = U.debounce(renderIdle, 250);

  function renderRepaint() {
    const counts = { standard: 0, ev: 0, accessible: 0 };
    PS.BAYS.forEach((b) => counts[store.typeOf(b.id)]++);
    const swatch = { standard: '<i class="lg-bay lg-std" aria-hidden="true"></i>', ev: `<i class="lg-bay lg-ev" aria-hidden="true">${ICON.bolt}</i>`, accessible: `<i class="lg-bay lg-acc" aria-hidden="true">${ICON.wheel}</i>` };
    panelEl().innerHTML = `
      <div class="panel-head">
        <div class="panel-head-text">
          <h2 id="panel-title" tabindex="-1">Repaint bays</h2>
          <p class="panel-sub">Each click on a bay moves it to the next type.</p>
        </div>
      </div>
      <div class="panel-body">
        <ul class="type-list">
          ${PS.BAY_TYPE_ORDER.map((t) => `<li>${swatch[t]}<span>${PS.BAY_TYPES[t].name}</span><span class="type-count">${counts[t]}</span></li>`).join('')}
        </ul>
        <p class="hint">The order is standard, then EV charging, then accessible. Parked cars stay where they are, and new arrivals are guided by the new layout straight away.</p>
      </div>
      <div class="panel-actions"><button type="button" class="btn btn-primary btn-lg" data-act="edit-done">Done</button></div>`;
  }

  function panelHead(spot, title, sub) {
    const type = store.typeOf(spot);
    return `
      <div class="panel-head">
        <div class="bay-tile t-${type}" aria-hidden="true">${esc(spot)}</div>
        <div class="panel-head-text">
          <h2 id="panel-title" tabindex="-1">${title}</h2>
          <p class="panel-sub">${sub}</p>
        </div>
        <button type="button" class="icon-btn panel-close" data-act="close" aria-label="Close panel">${ICON.close}</button>
      </div>`;
  }

  const typeIcon = (type) => (type === 'ev' ? ICON.bolt : type === 'accessible' ? ICON.wheel : '');

  /* --- Check-in (free bay or new arrival) --- */
  function openCheckIn({ spot = null, arrival = false, viaKeyboard = false } = {}) {
    if (map.mode !== 'normal') setEditMode(false);
    if (panel.mode !== 'checkin') panel.form = { plate: '', kind: 'car', color: 'white', needs: { ev: false, accessible: false } };
    panel.mode = 'checkin';
    panel.arrival = arrival;
    panel.manual = !!spot && !arrival;
    panel.suggestion = PS.routing.pickBay(panel.form.needs, { exclude: excluded() });
    panel.spot = spot || panel.suggestion.bay;
    renderCheckIn();
    showPanel();
    if (!panel.spot) return;
    map.select(panel.spot);
    map.showRoute(panel.spot);
    revealSoon(panel.spot);
    if (finePointer() || viaKeyboard || arrival) setTimeout(() => $('#plate-input') && $('#plate-input').focus(), 60);
  }

  function renderCheckIn() {
    const p = panelEl();
    if (!panel.spot) {
      p.innerHTML = `
        <div class="panel-head"><div class="panel-head-text"><h2 id="panel-title" tabindex="-1">The lot is full</h2>
        <p class="panel-sub">Every bay is taken right now.</p></div>
        <button type="button" class="icon-btn panel-close" data-act="close" aria-label="Close panel">${ICON.close}</button></div>
        <div class="panel-body"><p>Check a car out first, or see who has been parked longest.</p>
        <a class="btn btn-quiet" href="#activity">See parked cars</a></div>`;
      return;
    }
    const f = panel.form;
    const kinds = Object.entries(PS.VEHICLES)
      .map(([k, v]) => `<button type="button" role="radio" aria-checked="${f.kind === k}" data-kind="${k}">${miniCar(k, f.color)}<span>${v.name}</span></button>`)
      .join('');
    const colors = Object.entries(PS.CAR_COLORS)
      .map(([k, v]) => `<button type="button" class="swatch" role="radio" aria-checked="${f.color === k}" data-color="${k}" aria-label="${v.name}" title="${v.name}" style="--sw:${v.hex}"></button>`)
      .join('');
    p.innerHTML = `
      ${panelHead(panel.spot, '', '')}
      <form class="panel-body" id="checkin-form" novalidate autocomplete="off">
        <div class="field">
          <label class="field-label" for="plate-input">Licence plate</label>
          <input class="plate-input" id="plate-input" name="plate" value="${esc(f.plate)}" maxlength="12" spellcheck="false"
            autocapitalize="characters" autocomplete="off" enterkeyhint="go" aria-describedby="plate-error" placeholder="AB 123 CD">
          <p class="field-error" id="plate-error" hidden></p>
        </div>
        <div class="field">
          <span class="field-label" id="kind-label">Vehicle</span>
          <div class="seg-cars" role="radiogroup" aria-labelledby="kind-label">${kinds}</div>
        </div>
        <div class="field">
          <span class="field-label" id="color-label">Color</span>
          <div class="swatches" role="radiogroup" aria-labelledby="color-label">${colors}</div>
        </div>
        <div class="field">
          <span class="field-label" id="needs-label">Needs</span>
          <div class="needs" role="group" aria-labelledby="needs-label">
            <button type="button" class="chip" data-need="ev" aria-pressed="${f.needs.ev}">${ICON.bolt}EV charging</button>
            <button type="button" class="chip" data-need="accessible" aria-pressed="${f.needs.accessible}">${ICON.wheel}Accessible permit</button>
          </div>
        </div>
        <div class="suggest" id="suggest"></div>
      </form>
      <div class="panel-actions">
        <button type="submit" form="checkin-form" class="btn btn-primary btn-lg" id="checkin-submit"></button>
      </div>`;
    refreshCheckIn();
  }

  /* Update the parts of the check-in panel that depend on the chosen bay. */
  function refreshCheckIn() {
    const p = panelEl();
    const spot = panel.spot;
    if (!spot || panel.mode !== 'checkin' || !p.querySelector('#checkin-form')) return;
    const type = store.typeOf(spot);
    const meters = Math.round(PS.routing.driveMeters(spot));
    const tile = p.querySelector('.bay-tile');
    tile.className = `bay-tile t-${type}`;
    tile.textContent = spot;
    p.querySelector('#panel-title').textContent = panel.arrival ? 'New arrival' : 'Free bay';
    p.querySelector('.panel-sub').innerHTML = `${typeIcon(type)}${esc(PS.BAY_TYPES[type].bay)}, ${meters} m from the gate`;
    const sug = panel.suggestion;
    let html = '';
    if (panel.manual) {
      html = `<div class="suggest-row">${ICON.route}<p>You picked ${esc(spot)}. The blue line on the map shows the way from the gate.</p></div>`;
      if (sug && sug.bay && sug.bay !== spot) {
        html += `<button type="button" class="link-btn" data-act="use-suggestion">Use the suggested bay, ${esc(sug.bay)}, instead</button>`;
      }
    } else if (sug && sug.bay) {
      html = `<div class="suggest-row${sug.fallback ? ' is-warn' : ''}">${sug.fallback ? ICON.warn : ICON.route}<p>${esc(sug.reason)}</p></div>`;
    }
    const f = panel.form;
    if (type === 'ev' && !f.needs.ev) html += `<p class="note">${ICON.bolt}<span>This bay has a charger. Keep it for electric cars when you can.</span></p>`;
    if (type === 'accessible' && !f.needs.accessible) html += `<p class="note note-warn">${ICON.wheel}<span>Accessible bay. Only for cars with a permit.</span></p>`;
    const touch = window.matchMedia('(hover: none)').matches;
    html += `<p class="hint">${touch ? 'Tap' : 'Click'} any free bay on the map to choose it instead.</p>`;
    p.querySelector('#suggest').innerHTML = html;
    p.querySelector('#checkin-submit').textContent = `Check in at ${spot}`;
    $$('[data-kind]', p).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === f.kind)));
    $$('[data-color]', p).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === f.color)));
    $$('[data-need]', p).forEach((b) => b.setAttribute('aria-pressed', String(!!f.needs[b.dataset.need])));
    $$('[data-kind]', p).forEach((b) => {
      const svg = b.querySelector('svg');
      if (svg) svg.outerHTML = miniCar(b.dataset.kind, f.color);
    });
  }

  function setPlateError(msg, html) {
    const e = $('#plate-error');
    if (!e) return;
    e.hidden = !msg && !html;
    e.innerHTML = html || esc(msg || '');
    $('#plate-input').setAttribute('aria-invalid', String(!!(msg || html)));
  }

  function submitCheckIn() {
    const f = panel.form;
    const plate = U.normalizePlate($('#plate-input').value);
    if (!U.validPlate(plate)) {
      setPlateError('Enter a plate with 2 to 10 letters or numbers.');
      $('#plate-input').focus();
      return;
    }
    const dup = store.findPlate(plate);
    if (dup) {
      setPlateError('', `${esc(plate)} is already parked in ${esc(dup)}.<button type="button" class="link-btn" data-act="show-bay" data-spot="${esc(dup)}">Show it</button>`);
      $('#plate-input').focus();
      return;
    }
    const spot = panel.spot;
    if (!store.isFree(spot) || map.busy.has(spot)) {
      setPlateError(`Bay ${spot} was just taken. Pick another bay.`);
      return;
    }
    panel.submitting = true;
    try {
      map.checkIn({ spot, plate, kind: f.kind, color: f.color, needs: f.needs });
    } catch (err) {
      setPlateError(err.userFacing ? err.message : 'Could not check the car in.');
      return;
    } finally {
      panel.submitting = false;
    }
    closePanel();
    map.focusBay(spot);
    toast(`${plate} checked in at ${spot}.`);
  }

  /* --- Occupied bay --- */
  function openOccupied(spot) {
    if (map.mode === 'move') map.setMode('normal');
    if (map.mode === 'edit') setEditMode(false);
    panel.mode = 'occupied';
    panel.spot = spot;
    panel.arrival = false;
    map.showRoute(null);
    renderOccupied();
    showPanel();
    map.select(spot);
    revealSoon(spot);
  }

  /* Wait a frame so a just-opened bottom sheet has its final height. */
  function revealSoon(spot) {
    requestAnimationFrame(() => requestAnimationFrame(() => map.reveal(spot)));
  }

  function renderOccupied() {
    const spot = panel.spot;
    const s = store.session(spot);
    if (!s) return closePanel();
    const type = store.typeOf(spot);
    const colorName = PS.CAR_COLORS[s.color].name;
    const kindName = PS.VEHICLES[s.kind].name;
    const p = panelEl();
    p.innerHTML = `
      ${panelHead(spot, `<span class="plate plate-lg">${esc(s.plate)}</span>`, `${typeIcon(type)}${esc(colorName)} ${esc(U.lower(kindName))} in ${esc(U.lower(PS.BAY_TYPES[type].bay))}`)}
      <div class="panel-body">
        <div class="car-figure">${miniCar(s.kind, s.color, 'car-figure-svg')}</div>
        <dl class="facts">
          <div><dt>Arrived</dt><dd>${esc(U.smartTime(s.entered))}</dd></div>
          <div><dt>Parked for</dt><dd data-live="dur"></dd></div>
          <div><dt>Fee so far</dt><dd data-live="fee"></dd></div>
          <div><dt>Price goes up</dt><dd data-live="next"></dd></div>
        </dl>
        <div class="limit" data-live="limit-box">
          <div class="limit-bar"><span data-live="limit-bar"></span></div>
          <p data-live="limit"></p>
        </div>
        <p class="charge" data-live="charge" hidden></p>
      </div>
      <div class="panel-actions">
        <button type="button" class="btn btn-primary btn-lg" data-act="checkout">Check out</button>
        <button type="button" class="btn btn-quiet btn-lg" data-act="move">${ICON.move}Move to another bay</button>
      </div>`;
    refreshOccupied();
  }

  const fmtHours = (h) => `${h}-hour`;

  function refreshOccupied() {
    const s = store.session(panel.spot);
    if (!s) return;
    const p = panelEl();
    if (!p.querySelector('[data-live="dur"]')) return;
    const now = Date.now();
    const ms = now - s.entered;
    const settings = store.state.settings;
    const q = PS.pricing.quote(ms, settings);
    const next = PS.pricing.nextStep(ms, settings);
    const set = (k, v) => {
      const n = p.querySelector(`[data-live="${k}"]`);
      if (n && n.textContent !== v) n.textContent = v;
    };
    set('dur', U.duration(ms));
    set('fee', q.free ? 'Free so far' : U.money(q.total));
    set('next', next ? `${U.money(next.total)} in ${U.duration(next.inMs + 59e3)}` : 'Capped for today');
    const limitH = settings.maxStayHours;
    const box = p.querySelector('[data-live="limit-box"]');
    if (limitH > 0) {
      const limit = limitH * 3600e3;
      const late = ms > limit;
      box.hidden = false;
      box.classList.toggle('is-late', late);
      p.querySelector('[data-live="limit-bar"]').style.width = `${Math.min(100, (ms / limit) * 100)}%`;
      set('limit', late ? `Over the ${fmtHours(limitH)} limit by ${U.duration(ms - limit)}` : `${U.duration(limit - ms)} left of the ${fmtHours(limitH)} limit`);
    } else box.hidden = true;
    const charge = p.querySelector('[data-live="charge"]');
    const charging = store.typeOf(panel.spot) === 'ev' && s.needs.ev;
    charge.hidden = !charging;
    if (charging) {
      const kwh = Math.min(64, (ms / 3600e3) * PS.CHARGER_KW);
      const text = `Charging at ${PS.CHARGER_KW} kW, about ${kwh.toFixed(1)} kWh so far`;
      if (charge.textContent !== text) charge.innerHTML = `${ICON.bolt}<span>${text}</span>`;
    }
  }

  /* --- Move --- */
  function startMove(spot) {
    const s = store.session(spot);
    if (!s) return;
    panel.mode = 'move';
    panel.spot = spot;
    map.setMode('move', spot);
    map.setFilter('all');
    syncFilterButtons();
    panelEl().innerHTML = `
      ${panelHead(spot, `Move <span class="plate">${esc(s.plate)}</span>`, 'Pick a free bay on the map')}
      <div class="panel-body"><p class="hint-lg">The car backs out of ${esc(spot)} and drives to the bay you pick. Taken bays are dimmed.</p></div>
      <div class="panel-actions"><button type="button" class="btn btn-quiet btn-lg" data-act="cancel-move">Cancel</button></div>`;
    panelEl().querySelector('#panel-title').focus();
    announce(`Moving ${s.plate}. Choose a free bay on the map.`);
  }

  function finishMove(to) {
    const from = panel.spot;
    const s = store.session(from);
    if (!s) return closePanel();
    try {
      map.move(from, to);
    } catch (err) {
      toast(err.userFacing ? err.message : 'Could not move the car.', { tone: 'warn' });
      return;
    }
    map.setMode('normal');
    toast(`${s.plate} moved from ${from} to ${to}.`);
    panel.mode = 'occupied';
    panel.spot = to;
    renderOccupied();
    map.select(to);
  }

  /* --- Panel events --- */
  function wirePanel() {
    const p = panelEl();
    p.addEventListener('click', (e) => {
      const btn = e.target.closest('button, a');
      if (!btn || !p.contains(btn)) return;
      const f = panel.form;
      const act = btn.dataset.act;
      if (act === 'close') return closePanel({ restoreFocus: true });
      if (act === 'checkout') return openCheckout(panel.spot);
      if (act === 'move') return startMove(panel.spot);
      if (act === 'cancel-move') return openOccupied(panel.spot);
      if (act === 'show-bay') return focusVehicle(btn.dataset.spot);
      if (act === 'edit-done') return setEditMode(false);
      if (btn.classList.contains('idle-row')) return focusVehicle(btn.dataset.spot);
      if (act === 'use-suggestion' && panel.suggestion && panel.suggestion.bay) {
        panel.manual = false;
        panel.spot = panel.suggestion.bay;
        map.select(panel.spot);
        map.showRoute(panel.spot);
        revealSoon(panel.spot);
        return refreshCheckIn();
      }
      if (btn.dataset.kind) {
        f.kind = btn.dataset.kind;
        return refreshCheckIn();
      }
      if (btn.dataset.color) {
        f.color = btn.dataset.color;
        return refreshCheckIn();
      }
      if (btn.dataset.need) {
        f.needs[btn.dataset.need] = !f.needs[btn.dataset.need];
        panel.suggestion = PS.routing.pickBay(f.needs, { exclude: excluded() });
        if (!panel.manual && panel.suggestion.bay) {
          panel.spot = panel.suggestion.bay;
          map.select(panel.spot);
          map.showRoute(panel.spot);
          revealSoon(panel.spot);
        }
        return refreshCheckIn();
      }
    });
    p.addEventListener('input', (e) => {
      if (e.target.id !== 'plate-input') return;
      const pos = e.target.selectionStart;
      const up = e.target.value.toUpperCase();
      if (up !== e.target.value) {
        e.target.value = up;
        e.target.setSelectionRange(pos, pos);
      }
      panel.form.plate = e.target.value;
      setPlateError('');
    });
    p.addEventListener('submit', (e) => {
      e.preventDefault();
      submitCheckIn();
    });
  }

  /* Arrow keys move between options in any radio group. */
  function wireRadioGroups() {
    document.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const radio = e.target.closest && e.target.closest('[role="radio"]');
      const group = radio && radio.closest('[role="radiogroup"]');
      if (!group) return;
      const items = $$('[role="radio"]', group).filter((b) => !b.disabled);
      const i = items.indexOf(radio);
      const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      const next = items[(i + (back ? -1 : 1) + items.length) % items.length];
      e.preventDefault();
      next.click();
      next.focus();
    });
  }

  /* ---------- Bay activation from the map ---------- */
  function onBayActivate(id) {
    hideTooltip();
    if (map.mode === 'edit') return cycleBayType(id);
    if (map.mode === 'move') {
      if (id === panel.spot) return;
      if (store.isFree(id) && !map.busy.has(id) && !map.held.has(id)) return finishMove(id);
      toast(`${id} is taken. Pick a free bay.`, { tone: 'warn' });
      return;
    }
    if (map.held.has(id) || map.busy.has(id)) return; // a car is pulling in or out
    if (store.session(id)) {
      if (panel.mode === 'occupied' && panel.spot === id) return closePanel({ restoreFocus: true });
      return openOccupied(id);
    }
    if (panel.mode === 'checkin') {
      if (panel.spot === id && !panel.arrival) return closePanel({ restoreFocus: true });
      panel.spot = id;
      panel.manual = true;
      map.select(id);
      map.showRoute(id);
      return refreshCheckIn();
    }
    openCheckIn({ spot: id });
  }

  /* ---------- Repainting bays ---------- */
  function cycleBayType(id) {
    const order = PS.BAY_TYPE_ORDER;
    const next = order[(order.indexOf(store.typeOf(id)) + 1) % order.length];
    store.setBayType(id, next);
    announce(`${id} is now ${U.lower(PS.BAY_TYPES[next].bay)}.`);
  }

  function setEditMode(on) {
    if (on) closePanel();
    if (on && map.heat) toggleHeat(false);
    const was = map.mode === 'edit';
    map.setMode(on ? 'edit' : 'normal');
    if (on !== was && !panel.mode) renderIdle();
    $('#btn-edit').setAttribute('aria-pressed', String(on));
    const banner = $('#map-banner');
    banner.hidden = !on;
    banner.innerHTML = on
      ? `<p>Click a bay to repaint it: standard, then EV charging, then accessible.</p><button type="button" class="btn btn-primary btn-sm" data-act="edit-done">Done</button>`
      : '';
  }
  PS.setEditMode = setEditMode;

  function toggleHeat(on) {
    map.setHeat(on);
    $('#btn-heat').setAttribute('aria-pressed', String(on));
    $('#heat-legend').hidden = !on;
    $('#map-legend').hidden = on;
    hideTooltip();
  }

  /* ---------- Checkout & receipt ---------- */
  let co = null;

  function openCheckout(spot) {
    const s = store.session(spot);
    if (!s) return;
    const at = Date.now();
    co = { spot, at, method: 'card', paid: false, session: s, quote: PS.pricing.quote(at - s.entered, store.state.settings) };
    renderCheckout();
    const dlg = $('#checkout-dialog');
    dlg.showModal();
    const primary = dlg.querySelector('[data-act="collect"]');
    if (primary) primary.focus();
  }

  function receiptHTML() {
    const s = co.session;
    const q = co.quote;
    const settings = store.state.settings;
    const lines = q.lines
      .map((l) => `<div class="r-row"><span>${esc(l.label)}</span><span>${l.amount < 0 ? '−' : ''}${U.money(Math.abs(l.amount))}</span></div>`)
      .join('');
    return `
      <div class="receipt" id="receipt">
        <div class="r-brand"><span class="brand-sign brand-sign-sm" aria-hidden="true">P</span><div><strong>${esc(settings.lotName || 'ParkSmart')}</strong><span>Parking receipt</span></div></div>
        <div class="r-rule"></div>
        <div class="r-row"><span>Plate</span><span class="r-strong">${esc(s.plate)}</span></div>
        <div class="r-row"><span>Bay</span><span>${esc(co.spot)}</span></div>
        <div class="r-row"><span>In</span><span>${esc(U.fullTime(s.entered))}</span></div>
        <div class="r-row"><span>Out</span><span>${esc(U.fullTime(co.at))}</span></div>
        <div class="r-row"><span>Time parked</span><span>${esc(U.duration(co.at - s.entered))}</span></div>
        <div class="r-rule"></div>
        ${lines}
        <div class="r-rule"></div>
        <div class="r-row r-total"><span>Total</span><span>${U.money(q.total)}</span></div>
        ${co.paid && q.total ? `<div class="r-row"><span>Paid by</span><span>${esc(PS.PAYMENT_METHODS[co.method])}</span></div>` : ''}
        ${co.paid ? `<div class="r-stamp" aria-hidden="true">Paid</div>` : ''}
        <p class="r-foot">Ticket ${esc(s.id.slice(-6).toUpperCase())}. Thank you for parking with us.</p>
      </div>`;
  }

  function renderCheckout() {
    const dlg = $('#checkout-dialog');
    const q = co.quote;
    const methods = Object.entries(PS.PAYMENT_METHODS)
      .map(([k, v]) => `<button type="button" role="radio" aria-checked="${co.method === k}" data-method="${k}">${v}</button>`)
      .join('');
    const actions = co.paid
      ? `<p class="paid-note">${ICON.check}<span>${q.total ? `${U.money(q.total)} collected by ${PS.PAYMENT_METHODS[co.method].toLowerCase()}.` : 'Checked out free of charge.'} The car is on its way out.</span></p>
         <div class="dialog-actions">
           ${canPrint ? `<button type="button" class="btn btn-quiet" data-act="print">${ICON.print}Print receipt</button>` : ''}
           <button type="button" class="btn btn-primary" data-act="done">Done</button>
         </div>`
      : `${q.total ? `<div class="field"><span class="field-label" id="method-label">Payment</span><div class="seg seg-full" role="radiogroup" aria-labelledby="method-label">${methods}</div></div>` : ''}
         <div class="dialog-actions">
           <button type="button" class="btn btn-quiet" data-act="cancel">Cancel</button>
           <button type="button" class="btn btn-primary" data-act="collect">${q.total ? `Collect ${U.money(q.total)} and check out` : 'Check out free'}</button>
         </div>`;
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="dialog-head">
          <h2 id="checkout-title">${co.paid ? 'Checked out' : `Check out ${esc(co.session.plate)}`}</h2>
          <button type="button" class="icon-btn" data-act="${co.paid ? 'done' : 'cancel'}" aria-label="Close">${ICON.close}</button>
        </div>
        ${receiptHTML()}
        ${actions}
      </div>`;
  }

  function wireCheckout() {
    const dlg = $('#checkout-dialog');
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) return dlg.close(); // backdrop
      const btn = e.target.closest('button');
      if (!btn || !co) return;
      if (btn.dataset.method) {
        co.method = btn.dataset.method;
        $$('[data-method]', dlg).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.method === co.method)));
        return;
      }
      const act = btn.dataset.act;
      if (act === 'cancel' || act === 'done') return dlg.close();
      if (act === 'print') {
        document.body.classList.add('is-printing');
        try {
          window.print();
        } finally {
          setTimeout(() => document.body.classList.remove('is-printing'), 500);
        }
        return;
      }
      if (act === 'collect') {
        try {
          map.checkOut(co.spot, { method: co.method, at: co.at }, { hold: true });
        } catch (err) {
          toast(err.userFacing ? err.message : 'Could not check the car out.', { tone: 'warn' });
          return dlg.close();
        }
        co.paid = true;
        if (panel.spot === co.spot) closePanel();
        renderCheckout();
        dlg.querySelector('[data-act="done"]').focus();
        announce(`${co.session.plate} checked out. ${co.quote.total ? U.money(co.quote.total) + ' collected.' : 'No charge.'}`);
      }
    });
    dlg.addEventListener('close', () => {
      if (co && co.paid) {
        const spot = co.spot;
        map.release(spot);
        toast(`${co.session.plate} left ${spot}${co.quote.total ? `, ${U.money(co.quote.total)} collected` : ''}.`);
        if (ui.view === 'map') map.focusBay(spot);
      }
      co = null;
    });
  }

  /* ---------- Search ---------- */
  let searchIndex = -1;
  function searchMatches(q) {
    const key = U.plateKey(q);
    if (!key) return [];
    const out = [];
    const bayId = q.trim().toUpperCase();
    if (PS.BAY_BY_ID[bayId]) out.push({ spot: bayId });
    for (const [spot, s] of Object.entries(store.state.sessions)) {
      if (U.plateKey(s.plate).includes(key) && !out.some((o) => o.spot === spot)) out.push({ spot });
    }
    return out.slice(0, 7);
  }

  function renderSearch() {
    const input = $('#search-input');
    const box = $('#search-results');
    const q = input.value.trim();
    if (!q) {
      closeSearch();
      return;
    }
    const matches = searchMatches(q);
    searchIndex = matches.length ? 0 : -1;
    const now = Date.now();
    let html;
    if (matches.length) {
      html = matches
        .map((m, i) => {
          const s = store.session(m.spot);
          const type = store.typeOf(m.spot);
          return `<div class="sr-item${i === searchIndex ? ' is-active' : ''}" role="option" id="sr-${i}" data-spot="${m.spot}" aria-selected="${i === searchIndex}">
            <span class="sr-bay t-${type}">${m.spot}</span>
            ${s ? `<span class="plate">${esc(s.plate)}</span><span class="sr-meta">${U.duration(now - s.entered)}</span>` : `<span class="sr-meta">${esc(PS.BAY_TYPES[type].bay)}, free</span>`}
          </div>`;
        })
        .join('');
    } else {
      const last = store.lastVisit(q);
      html = last
        ? `<div class="sr-empty"><strong>${esc(last.plate)}</strong> is not parked now. It left ${esc(last.spot)} at ${esc(U.smartTime(last.exited, now))}.</div>`
        : `<div class="sr-empty">No parked car matches “${esc(q)}”.</div>`;
    }
    box.innerHTML = html;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (searchIndex >= 0) input.setAttribute('aria-activedescendant', `sr-${searchIndex}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function moveSearch(d) {
    const items = $$('.sr-item', $('#search-results'));
    if (!items.length) return;
    searchIndex = (searchIndex + d + items.length) % items.length;
    items.forEach((it, i) => {
      it.classList.toggle('is-active', i === searchIndex);
      it.setAttribute('aria-selected', String(i === searchIndex));
    });
    $('#search-input').setAttribute('aria-activedescendant', `sr-${searchIndex}`);
    items[searchIndex].scrollIntoView({ block: 'nearest' });
  }

  function closeSearch() {
    $('#search-results').hidden = true;
    const input = $('#search-input');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function focusVehicle(spot) {
    closeSearch();
    const go = () => {
      if (store.session(spot)) openOccupied(spot);
      else if (!map.busy.has(spot)) openCheckIn({ spot });
      map.pulse(spot);
    };
    if (ui.view !== 'map') {
      location.hash = '#map';
      setTimeout(go, 60);
    } else go();
  }
  PS.focusVehicle = focusVehicle;

  function wireSearch() {
    const input = $('#search-input');
    input.addEventListener('input', renderSearch);
    input.addEventListener('focus', () => input.value && renderSearch());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSearch(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSearch(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const items = $$('.sr-item', $('#search-results'));
        if (items[searchIndex]) {
          input.value = '';
          focusVehicle(items[searchIndex].dataset.spot);
          input.blur();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (input.value) input.value = '';
        closeSearch();
        input.blur();
      }
    });
    $('#search-results').addEventListener('pointerdown', (e) => {
      const item = e.target.closest('.sr-item');
      if (!item) return;
      e.preventDefault();
      input.value = '';
      focusVehicle(item.dataset.spot);
      input.blur();
    });
    input.addEventListener('blur', () => setTimeout(closeSearch, 120));
  }

  /* ---------- Tooltip ---------- */
  function onBayHover(id) {
    const tip = $('#tooltip');
    if (!id || map.mode === 'move') return hideTooltip();
    const live = store.session(id);
    const s = live || map.held.get(id);
    const type = store.typeOf(id);
    const now = Date.now();
    let body;
    if (map.heat && map.heatData) {
      const u = map.heatData[id];
      body = `<span>Taken ${U.pct(u.share)} of the last 24 hours</span><span class="tt-muted">${U.plural(u.visits, 'visit', 'visits')}</span>`;
    } else if (map.mode === 'edit') {
      body = `<span>${esc(PS.BAY_TYPES[type].bay)}</span><span class="tt-muted">Click to repaint</span>`;
    } else if (s) {
      const late = live && store.isOverstay(live, now);
      body = `<span class="plate">${esc(s.plate)}</span><span>${U.duration(now - s.entered)}, ${U.money(PS.pricing.quote(now - s.entered, store.state.settings).total)} so far</span>${late ? '<span class="tt-late">Over the time limit</span>' : ''}`;
    } else {
      body = `<span>Free</span>`;
    }
    tip.innerHTML = `<div class="tt-head"><strong>${id}</strong>${type !== 'standard' ? `<span class="tt-type t-${type}">${PS.BAY_TYPES[type].name}</span>` : ''}</div>${body}`;
    tip.hidden = false;
    const r = map.bayRect(id);
    if (!r) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    const left = U.clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  function hideTooltip() {
    $('#tooltip').hidden = true;
  }

  /* ---------- Map toolbar ---------- */
  function syncFilterButtons() {
    $$('[data-filter]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.filter === map.filter)));
  }

  function wireToolbar() {
    $('#map-toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.filter) {
        if (map.mode === 'move') return;
        map.setFilter(b.dataset.filter);
        syncFilterButtons();
      } else if (b.id === 'btn-heat') {
        if (map.mode === 'edit') setEditMode(false);
        toggleHeat(!map.heat);
      } else if (b.id === 'btn-edit') {
        setEditMode(map.mode !== 'edit');
      } else if (b.id === 'btn-sim') {
        setSimulation(!sim.on, true);
      }
    });
    $('#map-banner').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="edit-done"]')) setEditMode(false);
    });
    $('#sim-status').addEventListener('click', () => setSimulation(false, true));
  }

  /* ---------- Views & routing ---------- */
  const VIEWS = { map: 'Lot map', activity: 'Activity', insights: 'Insights', setup: 'Setup' };
  const ui = (PS.ui = { view: null });

  function route() {
    const name = location.hash.replace('#', '');
    const view = VIEWS[name] ? name : 'map';
    if (view === ui.view) return;
    ui.view = view;
    $$('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
    $$('.nav-link').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#map-toolbar').hidden = view !== 'map';
    $('#view-title').textContent = VIEWS[view];
    document.title = view === 'map' ? 'ParkSmart' : `${VIEWS[view]} · ParkSmart`;
    if (view !== 'map') {
      hideTooltip();
      if (panel.mode === 'move') openOccupied(panel.spot);
      if (map.mode === 'edit') setEditMode(false);
    }
    PS.views.show(view);
    const main = $('#main');
    main.scrollTop = 0;
  }

  /* ---------- Traffic simulation ---------- */
  const sim = { on: false, timer: 0 };
  function setSimulation(on, notify) {
    sim.on = on;
    clearTimeout(sim.timer);
    if (on) sim.timer = setTimeout(simStep, 700);
    $('#sim-status').hidden = !on;
    $('#btn-sim').setAttribute('aria-pressed', String(on));
    const t = $('#sim-toggle');
    if (t) t.checked = on;
    if (notify) toast(on ? 'Traffic simulation on. Cars will come and go on their own.' : 'Traffic simulation off.');
  }
  PS.setSimulation = setSimulation;
  PS.simRunning = () => sim.on;

  function simStep() {
    if (!sim.on) return;
    const dialogOpen = $('#checkout-dialog').open || $('#confirm-dialog').open;
    if (!document.hidden && map.mode === 'normal' && !dialogOpen) {
      const c = store.counts();
      const occ = c.occupied / c.total;
      const arriveChance = occ < 0.35 ? 0.78 : occ > 0.88 ? 0.18 : 0.52;
      if (Math.random() < arriveChance) simArrive();
      else simDepart();
    }
    sim.timer = setTimeout(simStep, 2000 + Math.random() * 2600);
  }

  function simArrive() {
    const v = PS.demo.randomArrival();
    if (store.findPlate(v.plate)) return;
    const exclude = excluded();
    if (panel.spot) exclude.push(panel.spot);
    const pick = PS.routing.pickBay(v.needs, { exclude });
    if (!pick.bay) return;
    try {
      map.checkIn({ spot: pick.bay, ...v });
    } catch (e) {
      /* the bay was taken meanwhile */
    }
  }

  function simDepart() {
    const now = Date.now();
    // Cars that have been here a while are the likeliest to leave; nobody leaves within 5 minutes.
    const options = Object.entries(store.state.sessions)
      .filter(([spot]) => !map.busy.has(spot) && spot !== panel.spot)
      .map(([spot, ses]) => [spot, (now - ses.entered) / 60000 - 5])
      .filter(([, w]) => w > 0);
    if (!options.length) return;
    const spot = U.weighted(options);
    try {
      map.checkOut(spot, { method: U.weighted([['card', 68], ['cash', 20], ['app', 12]]) });
    } catch (e) {
      /* already gone */
    }
  }

  /* ---------- Store changes ---------- */
  function onChange(state, reason) {
    if (reason === 'reset') {
      closePanel();
      setEditMode(false);
      map.held.clear();
      map.repaintTypes();
      map.render();
      applyTheme();
    } else if (reason === 'baytype') {
      map.repaintTypes();
    } else {
      map.render();
    }
    if (reason === 'settings') applyTheme();
    if (panel.mode === 'occupied') {
      if (!store.session(panel.spot)) closePanel();
      else refreshOccupied();
    }
    if (panel.mode === 'checkin' && !panel.submitting && panel.spot && !store.isFree(panel.spot)) {
      // Someone else took the bay we were about to use.
      panel.suggestion = PS.routing.pickBay(panel.form.needs, { exclude: excluded() });
      panel.manual = false;
      panel.spot = panel.suggestion.bay;
      if (panel.spot) {
        map.select(panel.spot);
        map.showRoute(panel.spot);
        refreshCheckIn();
      } else {
        map.select(null);
        map.showRoute(null);
        renderCheckIn();
      }
    }
    if (!panel.mode) renderIdleSoon();
    renderTopbar();
    PS.views.refresh(reason);
  }

  /* ---------- Clock ---------- */
  let lastMinute = -1;
  function tick() {
    if (panel.mode === 'occupied') refreshOccupied();
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      map.renderBays();
      renderTopbar();
      if (!panel.mode) renderIdle();
      PS.views.tick();
    }
  }

  /* ---------- Keyboard shortcuts ---------- */
  function wireShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if ($('#checkout-dialog').open || $('#confirm-dialog').open) return;
      if (e.key === 'Escape') {
        if (map.mode === 'edit') return setEditMode(false);
        if (panel.mode === 'move') return openOccupied(panel.spot);
        if (panel.mode) return closePanel({ restoreFocus: true });
        return;
      }
      if (isTyping(e)) return;
      if (e.key === '/') {
        e.preventDefault();
        $('#search-input').focus();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        startArrival(true);
      }
    });
  }

  function startArrival(viaKeyboard) {
    const open = () => openCheckIn({ arrival: true, viaKeyboard });
    if (ui.view !== 'map') {
      location.hash = '#map';
      setTimeout(open, 60);
    } else open();
  }

  /* ---------- Boot ---------- */
  function init() {
    const fresh = store.init();
    applyTheme();
    watchHostTheme();
    map.mount($('#lot'));
    map.onActivate = onBayActivate;
    map.onHover = onBayHover;
    map.setFilter('all');
    wirePanel();
    wireRadioGroups();
    wireCheckout();
    wireSearch();
    wireToolbar();
    wireShortcuts();
    $('#btn-arrival').addEventListener('click', () => startArrival(false));
    $$('[data-theme-choice]').forEach((b) =>
      b.addEventListener('click', () => store.updateSettings({ theme: b.dataset.themeChoice })),
    );
    $('#confirm-dialog').addEventListener('click', (e) => {
      if (e.target === $('#confirm-dialog')) $('#confirm-dialog').close('cancel');
    });
    window.addEventListener('resize', hideTooltip);
    $('.map-scroll').addEventListener('scroll', hideTooltip, { passive: true });
    $('#main').addEventListener('scroll', hideTooltip, { passive: true });
    PS.views.init();
    store.subscribe(onChange);
    window.addEventListener('hashchange', route);
    route();
    renderTopbar();
    showIdle();
    wide.addEventListener('change', () => {
      if (!panel.mode) showIdle();
    });
    setInterval(tick, 1000);
    if (fresh) {
      setTimeout(
        () =>
          toast('This lot is filled with demo data so you can try things out.', {
            action: 'Start empty',
            onAction: () => $('#btn-clear-all').click(),
          }),
        800,
      );
    }
    if (!store.storageOk) toast('This browser is blocking storage, so changes will not be saved.', { tone: 'warn' });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
