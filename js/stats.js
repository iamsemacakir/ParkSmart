/* ParkSmart — statistics over the last 24 hours, shared by Insights and the map heatmap. */
(function () {
  'use strict';
  const PS = window.PS;
  const HOUR = 3600e3;

  /* All stays (finished and ongoing) clipped to the window [from, to]. */
  function staysIn(from, to) {
    const st = PS.store.state;
    const out = [];
    for (let i = st.history.length - 1; i >= 0; i--) {
      const h = st.history[i];
      if (h.exited < from) break;
      if (h.entered < to) out.push({ spot: h.spot, start: Math.max(h.entered, from), end: Math.min(h.exited, to), rec: h });
    }
    for (const [spot, s] of Object.entries(st.sessions)) {
      if (s.entered < to) out.push({ spot, start: Math.max(s.entered, from), end: to, live: true, rec: s });
    }
    return out;
  }

  /* Share of the window each bay was taken, plus visit counts. */
  function utilization(now = Date.now(), hours = 24) {
    const from = now - hours * HOUR;
    const span = now - from;
    const per = {};
    PS.BAYS.forEach((b) => (per[b.id] = { busy: 0, visits: 0 }));
    for (const s of staysIn(from, now)) {
      per[s.spot].busy += s.end - s.start;
      per[s.spot].visits += 1;
    }
    for (const id of Object.keys(per)) per[id].share = Math.min(1, per[id].busy / span);
    return per;
  }

  /* Share of bays taken, sampled every `stepMin` minutes across the window. */
  function occupancySeries(now = Date.now(), hours = 24, stepMin = 15) {
    const from = now - hours * HOUR;
    const stays = staysIn(from, now);
    const total = PS.BAYS.length;
    const step = stepMin * 60e3;
    const points = [];
    for (let t = from; t <= now + 1; t += step) {
      let n = 0;
      for (const s of stays) if (s.start <= t && (s.end > t || (s.live && t >= now - 1))) n++;
      points.push({ t, v: Math.min(1, n / total), n: Math.min(total, n) });
    }
    return points;
  }

  function summary(now = Date.now()) {
    const st = PS.store.state;
    const from = now - 24 * HOUR;
    const done = st.history.filter((h) => h.exited >= from && h.exited <= now);
    const revenue = done.reduce((s, h) => s + h.fee, 0);
    const avgStay = done.length ? done.reduce((s, h) => s + (h.exited - h.entered), 0) / done.length : 0;

    // Revenue per clock hour, oldest first, ending with the current hour.
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const buckets = [];
    for (let i = 23; i >= 0; i--) buckets.push({ t: hourStart.getTime() - i * HOUR, v: 0, n: 0 });
    const firstBucket = buckets[0].t;
    for (const h of done) {
      const idx = Math.floor((h.exited - firstBucket) / HOUR);
      if (idx >= 0 && idx < 24) {
        buckets[idx].v += h.fee;
        buckets[idx].n += 1;
      }
    }

    const lengthBins = [
      { label: 'Under 30 min', max: 30 },
      { label: '30–60 min', max: 60 },
      { label: '1–2 hours', max: 120 },
      { label: '2–4 hours', max: 240 },
      { label: 'Over 4 hours', max: Infinity },
    ].map((b) => ({ ...b, n: 0 }));
    for (const h of done) {
      const m = (h.exited - h.entered) / 60e3;
      lengthBins.find((b) => m < b.max).n++;
    }

    const methods = { card: 0, cash: 0, app: 0 };
    for (const h of done) if (h.fee > 0) methods[h.method] = (methods[h.method] || 0) + h.fee;

    const series = occupancySeries(now);
    let peak = series[0] || { v: 0, t: now };
    for (const p of series) if (p.v > peak.v) peak = p;

    const util = utilization(now);
    const ranked = PS.BAYS.map((b) => ({ id: b.id, ...util[b.id] })).sort((a, b) => b.share - a.share);

    return {
      revenue,
      visits: done.length,
      avgStay,
      turnover: done.length / PS.BAYS.length,
      buckets,
      lengthBins,
      methods,
      series,
      peak,
      busiest: ranked.slice(0, 5),
      quietest: ranked.slice(-3).reverse(),
    };
  }

  PS.stats = { utilization, occupancySeries, summary };
})();
