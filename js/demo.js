/* ParkSmart — demo data
 * Builds a believable last 24 hours for the lot: quiet nights, busy
 * days, a mix of short and long stays, and about 60% of bays taken now.
 */
(function () {
  'use strict';
  const PS = window.PS;
  const U = PS.util;
  const HOUR = 3600e3;
  const MIN = 60e3;

  /* Average minutes between arrivals at one bay, by hour of day. */
  const GAP_BY_HOUR = [240, 260, 280, 280, 260, 200, 110, 50, 30, 26, 24, 24, 22, 24, 26, 28, 30, 34, 45, 70, 100, 140, 180, 220];

  function arrivalGap(t, type, rnd) {
    const mean = GAP_BY_HOUR[new Date(t).getHours()] * (type === 'accessible' ? 3 : type === 'ev' ? 1.6 : 1);
    return -Math.log(1 - rnd()) * mean * MIN;
  }

  function stayLength(rnd) {
    const u = rnd();
    if (u < 0.5) return (12 + rnd() * 48) * MIN;
    if (u < 0.85) return (60 + rnd() * 90) * MIN;
    if (u < 0.96) return (150 + rnd() * 150) * MIN;
    return (300 + rnd() * 240) * MIN;
  }

  function vehicle(rnd) {
    return {
      kind: U.weighted([['car', 60], ['suv', 28], ['van', 12]], rnd),
      color: U.weighted(
        [['white', 22], ['black', 18], ['silver', 16], ['gray', 16], ['blue', 10], ['red', 8], ['green', 5], ['sand', 5]],
        rnd,
      ),
    };
  }

  const method = (rnd) => U.weighted([['card', 68], ['cash', 20], ['app', 12]], rnd);

  /* A random arriving vehicle, used by the traffic simulation as well. */
  function randomArrival(rnd = Math.random) {
    const v = vehicle(rnd);
    return {
      plate: U.randomPlate(rnd),
      kind: v.kind,
      color: v.color,
      needs: { ev: rnd() < 0.12, accessible: rnd() < 0.05 },
    };
  }

  function generate(base) {
    const st = base;
    const rnd = Math.random;
    const now = Date.now();
    const used = new Set();
    const plate = () => {
      let p;
      do p = U.randomPlate(rnd);
      while (used.has(U.plateKey(p)));
      used.add(U.plateKey(p));
      return p;
    };
    const lastExit = {};

    st.sessions = {};
    st.history = [];
    st.demo = true;

    const startSession = (spot, entered) => {
      const v = vehicle(rnd);
      const type = st.bayTypes[spot];
      st.sessions[spot] = {
        id: U.uid(),
        plate: plate(),
        kind: v.kind,
        color: v.color,
        entered,
        needs: { ev: type === 'ev', accessible: type === 'accessible' },
        jitter: { dx: (rnd() - 0.5) * 3, rot: (rnd() - 0.5) * 3 },
      };
    };

    for (const bay of PS.BAYS) {
      const type = st.bayTypes[bay.id];
      let t = now - 26 * HOUR + rnd() * 2 * HOUR;
      for (let guard = 0; guard < 80; guard++) {
        t += arrivalGap(t, type, rnd);
        if (t >= now) break;
        const stay = stayLength(rnd);
        if (t + stay >= now) {
          startSession(bay.id, t);
          break;
        }
        const v = vehicle(rnd);
        const exited = t + stay;
        st.history.push({
          id: U.uid(),
          plate: U.randomPlate(rnd),
          kind: v.kind,
          color: v.color,
          spot: bay.id,
          entered: t,
          exited,
          fee: PS.pricing.quote(stay, st.settings).total,
          method: method(rnd),
        });
        lastExit[bay.id] = exited;
        t = exited;
      }
    }

    // Make sure the lot looks lively whatever the time of day.
    const target = Math.round(PS.BAYS.length * 0.6);
    const free = PS.BAYS.filter((b) => !st.sessions[b.id] && st.bayTypes[b.id] === 'standard');
    while (Object.keys(st.sessions).length < target && free.length) {
      const bay = free.splice(Math.floor(rnd() * free.length), 1)[0];
      const earliest = (lastExit[bay.id] || now - 3 * HOUR) + 4 * MIN;
      if (earliest > now - 3 * MIN) continue; // the last car only just left
      const entered = Math.max(earliest, now - (5 + rnd() * 170) * MIN);
      startSession(bay.id, Math.min(entered, now - 3 * MIN));
    }

    // Two or three long stays, so time-limit alerts have something to show.
    const limit = st.settings.maxStayHours * HOUR;
    if (limit > 0) {
      const late = Object.values(st.sessions).filter((s) => now - s.entered > limit);
      // Too many: bring the extra arrivals forward (still after the previous car left).
      late.slice(3).forEach((s) => (s.entered = now - limit * (0.35 + rnd() * 0.5)));
      if (!late.length) {
        const candidates = Object.entries(st.sessions).filter(([spot]) => (lastExit[spot] || 0) < now - limit - 2 * HOUR);
        candidates.slice(0, 2).forEach(([, s], i) => (s.entered = now - limit - (20 + i * 35) * MIN));
      }
    }

    st.history.sort((a, b) => a.exited - b.exited);
    return st;
  }

  PS.demo = { generate, randomArrival };
})();
