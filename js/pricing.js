/* ParkSmart — pricing
 * Every started hour is charged: the first hour at one rate, each extra
 * hour at another, with an optional free grace period and a cap for each
 * 24-hour block. All money is handled in cents to avoid rounding errors.
 */
(function () {
  'use strict';
  const PS = window.PS;
  const U = PS.util;

  const cents = (v) => Math.max(0, Math.round((Number(v) || 0) * 100));

  function rates(settings) {
    return {
      grace: Math.max(0, Math.floor(Number(settings.graceMinutes) || 0)),
      first: cents(settings.firstHour),
      extra: cents(settings.extraHour),
      max: cents(settings.dailyMax),
    };
  }

  function blockPrice(hours, r) {
    if (hours <= 0) return 0;
    const raw = r.first + (hours - 1) * r.extra;
    return r.max > 0 ? Math.min(raw, r.max) : raw;
  }

  /* Price for a stay of `ms` milliseconds, with a printable breakdown. */
  function quote(ms, settings) {
    const r = rates(settings);
    const minutes = Math.max(0, Math.ceil(ms / 60000));
    const lines = [];

    if (minutes <= r.grace) {
      lines.push({ label: r.grace ? `Free for the first ${r.grace} min` : 'No charge', amount: 0 });
      return { total: 0, lines, minutes, free: true, capped: false };
    }

    const days = Math.floor(minutes / 1440);
    const rest = minutes - days * 1440;
    const hours = Math.ceil(rest / 60);
    let total = 0;
    let capped = false;

    if (days > 0) {
      const perDay = blockPrice(24, r);
      lines.push({ label: days === 1 ? '1 full day' : `${days} full days`, amount: days * perDay });
      total += days * perDay;
    }
    if (hours > 0) {
      const raw = r.first + (hours - 1) * r.extra;
      lines.push({ label: days > 0 ? `First hour of day ${days + 1}` : 'First hour', amount: r.first });
      if (hours > 1) {
        const n = hours - 1;
        lines.push({
          label: `${n} more ${n === 1 ? 'hour' : 'hours'} at ${U.money(r.extra, settings.currency)}`,
          amount: n * r.extra,
        });
      }
      if (r.max > 0 && raw > r.max) {
        lines.push({ label: 'Daily maximum applied', amount: r.max - raw });
        capped = true;
      }
      total += r.max > 0 ? Math.min(raw, r.max) : raw;
    }
    return { total, lines, minutes, free: false, capped };
  }

  /* When will the price next go up? Returns { inMs, total } or null. */
  function nextStep(ms, settings) {
    const r = rates(settings);
    const now = quote(ms, settings).total;
    const minutes = Math.max(0, Math.ceil(ms / 60000));
    const candidates = [r.grace + 1];
    const startHour = Math.floor(minutes / 60);
    for (let k = startHour; k < startHour + 52; k++) candidates.push(k * 60 + 1);
    candidates.sort((a, b) => a - b);
    for (const m of candidates) {
      if (m <= minutes) continue;
      const total = quote(m * 60000, settings).total;
      if (total > now) return { inMs: Math.max(0, (m - 1) * 60000 - ms), total };
    }
    return null;
  }

  /* Representative stays for the price preview in Setup. */
  const PREVIEW = [
    { label: '30 min', ms: 30 * 60000 },
    { label: '1 hour', ms: 60 * 60000 },
    { label: '2 hours', ms: 120 * 60000 },
    { label: '4 hours', ms: 240 * 60000 },
    { label: '8 hours', ms: 480 * 60000 },
    { label: '24 hours', ms: 1440 * 60000 },
  ];

  PS.pricing = { quote, nextStep, rates, PREVIEW };
})();
