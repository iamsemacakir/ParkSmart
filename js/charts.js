/* ParkSmart — small dependency-free SVG charts.
 * Charts are drawn at the container's real pixel size so text stays
 * crisp; colours come from CSS classes so both themes work.
 */
(function () {
  'use strict';
  const PS = window.PS;
  const U = PS.util;

  function frame(container, height) {
    const width = Math.max(260, Math.floor(container.clientWidth));
    container.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('class', 'chart-svg');
    svg.setAttribute('aria-hidden', 'true');
    container.appendChild(svg);
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(tip);
    return { svg, tip, width, height };
  }

  function showTip(tip, container, x, y, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth;
    const left = U.clamp(x - w / 2, 0, container.clientWidth - w);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
  }

  /* Round axis steps (1, 2, 2.5 or 5 times a power of ten), at most five of them. */
  function niceScale(max, maxSteps = 5) {
    const raw = Math.max(max, 1) / maxSteps;
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((s) => s >= raw);
    const top = Math.ceil(Math.max(max, 1) / step) * step;
    return { step, top, steps: Math.round(top / step) };
  }

  /* Occupancy over time: points [{t, v (0..1), n}] */
  function area(container, points, opts = {}) {
    const { svg, tip, width, height } = frame(container, opts.height || 220);
    const pad = { l: 44, r: 12, t: 12, b: 28 };
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const x = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * iw;
    const y = (v) => pad.t + (1 - v) * ih;

    let s = '';
    for (const g of [0, 0.25, 0.5, 0.75, 1]) {
      s += `<line class="chart-grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y(g)}" y2="${y(g)}"/>`;
      s += `<text class="chart-label" x="${pad.l - 8}" y="${y(g) + 4}" text-anchor="end">${g * 100}%</text>`;
    }
    // hour ticks every 3 hours on the clock
    const first = new Date(t0);
    first.setMinutes(0, 0, 0);
    const step = iw < 420 ? 6 : 3;
    for (let t = first.getTime() + 3600e3; t < t1 - 1800e3; t += 3600e3) {
      if (new Date(t).getHours() % step) continue;
      s += `<line class="chart-tick" x1="${x(t)}" x2="${x(t)}" y1="${pad.t + ih}" y2="${pad.t + ih + 4}"/>`;
      s += `<text class="chart-label" x="${x(t)}" y="${height - 7}" text-anchor="middle">${U.hour(t)}</text>`;
    }
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    s += `<path class="chart-area" d="${line} L${x(t1)} ${y(0)} L${x(t0)} ${y(0)} Z"/>`;
    s += `<path class="chart-line" d="${line}"/>`;
    const last = points[points.length - 1];
    s += `<circle class="chart-now" cx="${x(last.t)}" cy="${y(last.v)}" r="4"/>`;
    s += `<line class="chart-cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" visibility="hidden"/>`;
    s += `<circle class="chart-dot" r="4" visibility="hidden"/>`;
    s += `<rect class="chart-hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}"/>`;
    svg.innerHTML = s;

    const cross = svg.querySelector('.chart-cross');
    const dot = svg.querySelector('.chart-dot');
    const hit = svg.querySelector('.chart-hit');
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const t = t0 + ((e.clientX - r.left - pad.l) / iw) * (t1 - t0);
      let best = points[0];
      for (const p of points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      cross.setAttribute('x1', x(best.t));
      cross.setAttribute('x2', x(best.t));
      cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(best.t));
      dot.setAttribute('cy', y(best.v));
      dot.setAttribute('visibility', 'visible');
      showTip(tip, container, x(best.t), y(best.v), `<strong>${U.pct(best.v)} full</strong><span>${U.smartTime(best.t)}, ${U.plural(best.n, 'car', 'cars')}</span>`);
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    });
  }

  /* Revenue per hour: buckets [{t, v (cents), n}] */
  function bars(container, buckets, opts = {}) {
    const { svg, tip, width, height } = frame(container, opts.height || 200);
    const max = Math.max(100, ...buckets.map((b) => b.v));
    const scale = niceScale(max);
    const nice = scale.top;
    const label = (v) => U.money(v).replace(/[.,]00(?=\D*$)/, '');
    const pad = { l: 16 + label(nice).length * 7, r: 8, t: 12, b: 28 };
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const bw = iw / buckets.length;
    const y = (v) => pad.t + (1 - v / nice) * ih;
    const step = iw < 420 ? 6 : 3;
    let s = '';
    for (let i = 0; i <= scale.steps; i++) {
      const v = scale.step * i;
      s += `<line class="chart-grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      s += `<text class="chart-label" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${label(v)}</text>`;
    }
    buckets.forEach((b, i) => {
      const h = Math.max(b.v ? 2 : 0, (b.v / nice) * ih);
      const bx = pad.l + i * bw + bw * 0.16;
      const isNow = i === buckets.length - 1;
      s += `<rect class="chart-bar${isNow ? ' is-now' : ''}" x="${bx.toFixed(1)}" y="${(pad.t + ih - h).toFixed(1)}" width="${(bw * 0.68).toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
      if (new Date(b.t).getHours() % step === 0) {
        s += `<text class="chart-label" x="${(pad.l + i * bw + bw / 2).toFixed(1)}" y="${height - 7}" text-anchor="middle">${U.hour(b.t)}</text>`;
      }
      s += `<rect class="chart-hit" data-i="${i}" x="${(pad.l + i * bw).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${ih}"/>`;
    });
    svg.innerHTML = s;
    svg.addEventListener('pointermove', (e) => {
      const r = e.target.closest('[data-i]');
      if (!r) return;
      const b = buckets[+r.dataset.i];
      const cx = pad.l + (+r.dataset.i + 0.5) * bw;
      const sofar = +r.dataset.i === buckets.length - 1 ? ' so far' : '';
      showTip(tip, container, cx, y(b.v), `<strong>${U.money(b.v)}${sofar}</strong><span>${U.time(b.t)}–${U.time(b.t + 3600e3)}, ${U.plural(b.n, 'visit', 'visits')}</span>`);
    });
    svg.addEventListener('pointerleave', () => (tip.hidden = true));
  }

  PS.charts = { area, bars };
})();
