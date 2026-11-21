/* ParkSmart — shared helpers: DOM, formatting, licence plates, files. */
(function () {
  'use strict';
  const PS = window.PS;
  const U = (PS.util = {});

  /* ---------- DOM ---------- */
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  U.esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  U.debounce = (fn, ms) => {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  U.reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  U.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* Small seeded PRNG so decorative details (trees) stay put between renders. */
  U.seeded = (seed) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  U.weighted = (pairs, rnd = Math.random) => {
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let r = rnd() * total;
    for (const [value, w] of pairs) {
      r -= w;
      if (r <= 0) return value;
    }
    return pairs[pairs.length - 1][0];
  };

  /* ---------- Licence plates ---------- */
  U.normalizePlate = (s) =>
    String(s || '')
      .toUpperCase()
      .replace(/[^A-Z0-9 -]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/-+/g, '-')
      .trim();
  U.plateKey = (s) => U.normalizePlate(s).replace(/[\s-]/g, '');
  U.validPlate = (s) => {
    const k = U.plateKey(s);
    return k.length >= 2 && k.length <= 10;
  };

  const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  U.randomPlate = (rnd = Math.random) => {
    const L = () => LETTERS[Math.floor(rnd() * LETTERS.length)];
    const N = () => String(Math.floor(rnd() * 10));
    const pattern = Math.floor(rnd() * 3);
    if (pattern === 0) return `${L()}${L()} ${N()}${N()}${N()} ${L()}${L()}`;
    if (pattern === 1) return `${N()}${L()}${L()}${L()} ${N()}${N()}${N()}`;
    return `${L()}${L()}${L()}-${N()}${N()}${N()}${N()}`;
  };

  /* ---------- Formatting ---------- */
  let moneyFmt = null;
  let moneyCurrency = '';
  U.money = (cents, currency) => {
    const cur = currency || (PS.store && PS.store.state ? PS.store.state.settings.currency : 'USD');
    if (cur !== moneyCurrency) {
      try {
        moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur });
      } catch (e) {
        moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
      }
      moneyCurrency = cur;
    }
    return moneyFmt.format((cents || 0) / 100);
  };

  U.duration = (ms) => {
    const m = Math.floor(Math.max(0, ms) / 60000);
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h < 24) return mm ? `${h}h ${mm}m` : `${h}h`;
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh ? `${d}d ${hh}h` : `${d}d`;
  };

  /* Long form for screen readers and sentences: "2 hours 13 minutes". */
  U.durationLong = (ms) => {
    const m = Math.floor(Math.max(0, ms) / 60000);
    if (m < 1) return 'less than a minute';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    const parts = [];
    if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
    if (mm) parts.push(`${mm} ${mm === 1 ? 'minute' : 'minutes'}`);
    return parts.join(' ');
  };

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const dayTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const fullFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });

  U.time = (ts) => timeFmt.format(ts);
  U.hour = (ts) => hourFmt.format(ts);
  U.fullTime = (ts) => fullFmt.format(ts);
  U.smartTime = (ts, now = Date.now()) =>
    new Date(ts).toDateString() === new Date(now).toDateString() ? timeFmt.format(ts) : dayTimeFmt.format(ts);

  U.pct = (v) => `${Math.round(v * 100)}%`;
  /* Lower-case the first letter of a name, leaving acronyms like SUV or EV alone. */
  U.lower = (s) => (/^[A-Z]{2,}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  U.plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* ---------- Files ----------
   * A Blob link downloads the file. A page that embeds the app can set
   * PS.host.saveFile to save files its own way; it returns 'saved',
   * 'declined', 'busy' or 'unavailable', or null to fall back.
   */
  U.saveFile = async (filename, text, mime) => {
    const host = PS.host;
    if (host && typeof host.saveFile === 'function') {
      const result = await host.saveFile(filename, text, mime);
      if (result) return result;
    }
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'saved';
  };

  U.csv = (rows) =>
    rows
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(','),
      )
      .join('\n');
})();
