/* ParkSmart — state store
 * One plain object holds the whole lot: settings, bay types, the cars
 * parked right now (sessions) and completed visits (history). Every
 * change goes through an action below, is saved to localStorage and
 * announced to subscribers.
 */
(function () {
  'use strict';
  const PS = window.PS;
  const U = PS.util;

  const KEY = 'parksmart:v2';
  const VERSION = 2;
  const HISTORY_LIMIT = 4000;
  const listeners = new Set();
  let state = null;
  let storageOk = true;

  function defaultBayTypes() {
    const types = {};
    PS.BAYS.forEach((b) => (types[b.id] = PS.DEFAULT_BAY_TYPES[b.id] || 'standard'));
    return types;
  }

  function blankState(settings) {
    return {
      version: VERSION,
      settings: { ...PS.DEFAULT_SETTINGS, ...(settings || {}) },
      bayTypes: defaultBayTypes(),
      sessions: {},
      history: [],
      demo: false,
    };
  }

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  /* Accept only well-formed data, so a damaged save can never break the app. */
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = blankState();
    const s = raw.settings || {};
    for (const key of Object.keys(PS.DEFAULT_SETTINGS)) {
      const def = PS.DEFAULT_SETTINGS[key];
      const v = s[key];
      if (typeof def === 'number' && v !== null && v !== '' && isNum(Number(v)) && Number(v) >= 0) out.settings[key] = Number(v);
      if (typeof def === 'string' && typeof v === 'string') out.settings[key] = v.slice(0, 60);
    }
    if (!PS.CURRENCIES.includes(out.settings.currency)) out.settings.currency = PS.DEFAULT_SETTINGS.currency;
    if (!['system', 'light', 'dark'].includes(out.settings.theme)) out.settings.theme = 'system';

    if (raw.bayTypes && typeof raw.bayTypes === 'object') {
      for (const id of Object.keys(out.bayTypes)) {
        if (PS.BAY_TYPES[raw.bayTypes[id]]) out.bayTypes[id] = raw.bayTypes[id];
      }
    }
    const plates = new Set();
    if (raw.sessions && typeof raw.sessions === 'object') {
      for (const [spot, ses] of Object.entries(raw.sessions)) {
        if (!PS.BAY_BY_ID[spot] || !ses || !isNum(ses.entered)) continue;
        const plate = U.normalizePlate(ses.plate);
        if (!U.validPlate(plate) || plates.has(U.plateKey(plate))) continue;
        plates.add(U.plateKey(plate));
        out.sessions[spot] = {
          id: String(ses.id || U.uid()),
          plate,
          kind: PS.VEHICLES[ses.kind] ? ses.kind : 'car',
          color: PS.CAR_COLORS[ses.color] ? ses.color : 'silver',
          entered: Math.min(ses.entered, Date.now()),
          needs: { ev: !!(ses.needs && ses.needs.ev), accessible: !!(ses.needs && ses.needs.accessible) },
          jitter: {
            dx: isNum(ses.jitter && ses.jitter.dx) ? U.clamp(ses.jitter.dx, -2, 2) : 0,
            rot: isNum(ses.jitter && ses.jitter.rot) ? U.clamp(ses.jitter.rot, -2, 2) : 0,
          },
        };
      }
    }
    if (Array.isArray(raw.history)) {
      out.history = raw.history
        .filter((h) => h && PS.BAY_BY_ID[h.spot] && isNum(h.entered) && isNum(h.exited) && h.exited >= h.entered)
        .map((h) => ({
          id: String(h.id || U.uid()),
          plate: U.normalizePlate(h.plate) || 'UNKNOWN',
          kind: PS.VEHICLES[h.kind] ? h.kind : 'car',
          color: PS.CAR_COLORS[h.color] ? h.color : 'silver',
          spot: h.spot,
          entered: h.entered,
          exited: h.exited,
          fee: isNum(h.fee) ? Math.max(0, Math.round(h.fee)) : 0,
          method: PS.PAYMENT_METHODS[h.method] ? h.method : 'card',
        }))
        .sort((a, b) => a.exited - b.exited)
        .slice(-HISTORY_LIMIT);
    }
    out.demo = !!raw.demo;
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? sanitize(JSON.parse(raw)) : null;
    } catch (e) {
      storageOk = false;
      return null;
    }
  }

  const persist = U.debounce(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
  }, 200);

  function emit(reason, detail) {
    persist();
    listeners.forEach((fn) => {
      try {
        fn(state, reason, detail || {});
      } catch (err) {
        console.error(err);
      }
    });
  }

  function fail(message) {
    const err = new Error(message);
    err.userFacing = true;
    throw err;
  }

  const store = (PS.store = {
    get state() {
      return state;
    },
    get storageOk() {
      return storageOk;
    },

    /* Returns true when there was no saved lot and demo data was created. */
    init() {
      state = load();
      if (state) return false;
      state = PS.demo.generate(blankState());
      persist();
      return true;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /* ---------- Queries ---------- */
    typeOf: (id) => state.bayTypes[id] || 'standard',
    session: (id) => state.sessions[id] || null,
    isFree: (id) => !state.sessions[id],

    findPlate(plate) {
      const key = U.plateKey(plate);
      if (!key) return null;
      for (const [spot, s] of Object.entries(state.sessions)) if (U.plateKey(s.plate) === key) return spot;
      return null;
    },

    lastVisit(plate) {
      const key = U.plateKey(plate);
      for (let i = state.history.length - 1; i >= 0; i--) {
        if (U.plateKey(state.history[i].plate) === key) return state.history[i];
      }
      return null;
    },

    counts() {
      const c = { total: PS.BAYS.length, free: 0, occupied: 0, overstay: 0, evFree: 0, evTotal: 0, accFree: 0, accTotal: 0 };
      const limit = state.settings.maxStayHours * 3600e3;
      const now = Date.now();
      for (const bay of PS.BAYS) {
        const t = state.bayTypes[bay.id];
        const s = state.sessions[bay.id];
        if (t === 'ev') c.evTotal++;
        if (t === 'accessible') c.accTotal++;
        if (s) {
          c.occupied++;
          if (limit > 0 && now - s.entered > limit) c.overstay++;
        } else {
          c.free++;
          if (t === 'ev') c.evFree++;
          if (t === 'accessible') c.accFree++;
        }
      }
      return c;
    },

    isOverstay(session, now = Date.now()) {
      const limit = state.settings.maxStayHours * 3600e3;
      return !!session && limit > 0 && now - session.entered > limit;
    },

    revenueSince(ts) {
      let sum = 0;
      for (let i = state.history.length - 1; i >= 0; i--) {
        const h = state.history[i];
        if (h.exited < ts) break;
        sum += h.fee;
      }
      return sum;
    },

    /* ---------- Actions ---------- */
    checkIn({ spot, plate, kind = 'car', color = 'silver', needs = {}, at }) {
      if (!PS.BAY_BY_ID[spot]) fail('That bay does not exist.');
      if (state.sessions[spot]) fail(`Bay ${spot} is already taken.`);
      const clean = U.normalizePlate(plate);
      if (!U.validPlate(clean)) fail('Enter a plate with 2 to 10 letters or numbers.');
      const already = store.findPlate(clean);
      if (already) fail(`${clean} is already parked in ${already}.`);
      const session = {
        id: U.uid(),
        plate: clean,
        kind: PS.VEHICLES[kind] ? kind : 'car',
        color: PS.CAR_COLORS[color] ? color : 'silver',
        entered: Math.min(at || Date.now(), Date.now()),
        needs: { ev: !!needs.ev, accessible: !!needs.accessible },
        jitter: { dx: (Math.random() - 0.5) * 3, rot: (Math.random() - 0.5) * 3 },
      };
      state.sessions[spot] = session;
      emit('checkin', { spot, session });
      return session;
    },

    checkOut(spot, { method = 'card', at } = {}) {
      const s = state.sessions[spot];
      if (!s) fail(`Bay ${spot} is already free.`);
      const exited = Math.max(s.entered, at || Date.now());
      const q = PS.pricing.quote(exited - s.entered, state.settings);
      const record = {
        id: s.id,
        plate: s.plate,
        kind: s.kind,
        color: s.color,
        spot,
        entered: s.entered,
        exited,
        fee: q.total,
        method: PS.PAYMENT_METHODS[method] ? method : 'card',
      };
      state.history.push(record);
      if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
      delete state.sessions[spot];
      emit('checkout', { spot, record, session: s });
      return record;
    },

    move(from, to) {
      const s = state.sessions[from];
      if (!s) fail(`Bay ${from} is empty.`);
      if (!PS.BAY_BY_ID[to]) fail('That bay does not exist.');
      if (state.sessions[to]) fail(`Bay ${to} is already taken.`);
      s.jitter = { dx: (Math.random() - 0.5) * 3, rot: (Math.random() - 0.5) * 3 };
      state.sessions[to] = s;
      delete state.sessions[from];
      emit('move', { from, to, session: s });
      return s;
    },

    setBayType(id, type) {
      if (!PS.BAY_TYPES[type] || !PS.BAY_BY_ID[id]) return;
      state.bayTypes[id] = type;
      emit('baytype', { spot: id, type });
    },

    updateSettings(patch) {
      Object.assign(state.settings, patch);
      emit('settings', { patch });
    },

    loadDemo() {
      const keep = { settings: state.settings, bayTypes: state.bayTypes };
      const next = blankState(keep.settings);
      next.bayTypes = { ...keep.bayTypes };
      state = PS.demo.generate(next);
      emit('reset', { demo: true });
    },

    clearAll() {
      const next = blankState(state.settings);
      next.bayTypes = { ...state.bayTypes };
      state = next;
      emit('reset', { demo: false });
    },

    clearHistory() {
      state.history = [];
      emit('history', {});
    },

    exportJSON() {
      return JSON.stringify({ app: 'ParkSmart', exportedAt: new Date().toISOString(), ...state }, null, 2);
    },

    /* Read a backup without applying it; throws a user-facing error if it is not one. */
    parseBackup(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        fail('That file is not valid JSON.');
      }
      const looksRight = parsed && typeof parsed === 'object' && (parsed.app === 'ParkSmart' || parsed.settings || parsed.sessions);
      const clean = looksRight ? sanitize(parsed) : null;
      if (!clean) fail('That file does not look like a ParkSmart backup.');
      return clean;
    },

    restoreBackup(clean) {
      state = clean;
      emit('reset', { imported: true });
    },
  });

  // Keep several open tabs in step with each other.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      const next = sanitize(JSON.parse(e.newValue));
      if (next) {
        state = next;
        listeners.forEach((fn) => fn(state, 'reset', { external: true }));
      }
    } catch (err) {
      /* ignore */
    }
  });

  store.HISTORY_LIMIT = HISTORY_LIMIT;
})();
