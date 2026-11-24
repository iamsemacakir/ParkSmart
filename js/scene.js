/* ParkSmart — scene
 * Paints the lot the way it looks from the air, on a canvas behind the
 * SVG map: lawn, aged asphalt with oil stains, patches and sealed cracks,
 * worn white paint, concrete kerbs and sidewalks, and the street. The
 * canvas uses the map's coordinates, so the two line up at any size, and
 * it redraws whenever its box changes size.
 *
 * It also makes the small images the map places on top of the cars: tree
 * crowns with their shadows, the soft shadow under each kind of vehicle,
 * and worn paint for EV and accessible bays.
 *
 * Light comes from the north-west, so every shadow falls to the south-east.
 */
(function () {
  'use strict';
  const PS = window.PS;
  const U = PS.util;
  const L = PS.LOT;
  const SEED = 7331;
  const TAU = Math.PI * 2;

  const COL = {
    lawn: '#5a7442',
    asphalt: '#5c5f63',
    street: '#4d5054',
    patch: '#4b4e52',
    concrete: '#bbb8b0',
    kerb: '#c9c6be',
    mulch: '#5a3f2f',
    paint: '#f3f3ed',
  };
  const NUM_FONT = '700 15px "Barlow Condensed", "Roboto Condensed", "Arial Narrow", sans-serif';
  const WORD_FONT = '700 13px "Barlow Condensed", "Roboto Condensed", "Arial Narrow", sans-serif';

  const scene = (PS.scene = { canvas: null, box: null, ready: false });

  /* ---------- Noise ---------- */
  function makeNoise(seed, period) {
    const rnd = U.seeded(seed);
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const fade = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const u = fade(x - xi);
      const v = fade(y - yi);
      const x0 = ((xi % period) + period) % period;
      const y0 = ((yi % period) + period) % period;
      const x1 = (x0 + 1) % period;
      const y1 = (y0 + 1) % period;
      const a = g[y0 * period + x0];
      const b = g[y0 * period + x1];
      const c = g[y1 * period + x0];
      const d = g[y1 * period + x1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }

  function fbm(noise, x, y, octaves) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /* A stable value in [0, 1) for an integer, so a slab or a bay keeps its look. */
  function hash(n, seed = 0) {
    let h = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const strSeed = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  };

  /* ---------- Small helpers ---------- */
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  function pixelTile(size, fill) {
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    fill(img.data, size);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function rrect(ctx, x, y, w, h, r) {
    const q = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + q, y);
    ctx.arcTo(x + w, y, x + w, y + h, q);
    ctx.arcTo(x + w, y + h, x, y + h, q);
    ctx.arcTo(x, y + h, x, y, q);
    ctx.arcTo(x, y, x + w, y, q);
    ctx.closePath();
  }

  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    const f = pct / 100;
    const adj = (c) => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
    return `rgb(${adj(n >> 16)},${adj((n >> 8) & 255)},${adj(n & 255)})`;
  }

  /* A pattern drawn at one tile pixel per screen pixel, whatever the zoom. */
  function texture(ctx, img, k) {
    const p = ctx.createPattern(img, 'repeat');
    if (p && p.setTransform && typeof DOMMatrix === 'function') p.setTransform(new DOMMatrix([1 / k, 0, 0, 1 / k, 0, 0]));
    return p;
  }

  /* Soft shadow of a shape, offset in lot units, without needing ctx.filter:
   * the shape is drawn far off the canvas and only its blurred shadow is
   * brought back. */
  function softShadow(ctx, k, shape, dx, dy, blur, color) {
    const FAR = 40000;
    const m = ctx.getTransform();
    ctx.save();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e - FAR, m.f);
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * k;
    ctx.shadowOffsetX = FAR + dx * k;
    ctx.shadowOffsetY = dy * k;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    shape(ctx);
    ctx.fill();
    ctx.restore();
  }

  function mottleOver(ctx, m, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(m.img, m.x, m.y, m.w, m.h);
    ctx.restore();
  }

  function blob(ctx, x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.55, `rgba(${rgb},${a * 0.6})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  /* ---------- Textures, made once ---------- */
  function speckTile(seed, dark, light, opts = {}) {
    const rnd = U.seeded(seed);
    return pixelTile(256, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const r = rnd();
        if (opts.stones && r < opts.stones) {
          d[i] = d[i + 1] = d[i + 2] = 226;
          d[i + 3] = opts.stoneA || 140;
          continue;
        }
        if (opts.pits && r > 1 - opts.pits) {
          d[i] = d[i + 1] = d[i + 2] = 8;
          d[i + 3] = opts.pitA || 120;
          continue;
        }
        const t = rnd() - 0.5;
        const c = t < 0 ? dark : light;
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
        d[i + 3] = Math.abs(t) * 2 * c[3] * 255;
      }
    });
  }

  /* Erosion for paint: mostly light pitting with the odd bare speck. */
  function wearTile(seed) {
    const rnd = U.seeded(seed);
    return pixelTile(128, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const r = rnd();
        d[i] = d[i + 1] = d[i + 2] = 0;
        d[i + 3] = (r < 0.035 ? 0.92 : Math.pow(rnd(), 3) * 0.55) * 255;
      }
    });
  }

  /* Large, soft light and dark patches covering an area, drawn scaled up. */
  function mottle(seed, x, y, w, h, cell, octaves, gain) {
    const noise = makeNoise(seed, 256);
    const cw = Math.ceil(w / cell);
    const ch = Math.ceil(h / cell);
    const c = makeCanvas(cw, ch);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const d = img.data;
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const n = fbm(noise, i / 9, j / 9, octaves) - 0.5;
        const p = (j * cw + i) * 4;
        const v = n < 0 ? 0 : 255;
        d[p] = d[p + 1] = d[p + 2] = v;
        d[p + 3] = Math.min(0.5, Math.abs(n) * gain) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { img: c, x, y, w: cw * cell, h: ch * cell };
  }

  let tex = null;
  function textures() {
    if (tex) return tex;
    tex = {
      asphalt: speckTile(SEED + 1, [10, 10, 12, 0.12], [238, 238, 232, 0.085], { stones: 0.005, stoneA: 70, pits: 0.008, pitA: 60 }),
      concrete: speckTile(SEED + 2, [70, 66, 60, 0.14], [255, 255, 250, 0.12], { pits: 0.006 }),
      lawn: speckTile(SEED + 3, [14, 36, 8, 0.38], [178, 208, 114, 0.26]),
      mulch: speckTile(SEED + 4, [26, 12, 6, 0.55], [160, 112, 72, 0.4], { stones: 0.004 }),
      wear: wearTile(SEED + 5),
      coarse: mottle(SEED + 6, -900, -700, L.width + 1800, L.height + 1400, 7, 4, 1.5),
      fine: mottle(SEED + 7, -60, -60, L.width + 120, L.height + 120, 2.4, 3, 1.25),
    };
    return tex;
  }

  /* ---------- The street and sidewalks ---------- */
  function slabs(ctx, k, t, x0, w, y0, y1, size, seed) {
    const h = y1 - y0;
    const first = Math.floor(x0 / size);
    const last = Math.ceil((x0 + w) / size);
    for (let i = first; i <= last; i++) {
      ctx.fillStyle = shade(COL.concrete, (hash(i, seed) - 0.5) * 9);
      ctx.fillRect(i * size, y0, size, h);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    mottleOver(ctx, tex.fine, 0.16);
    ctx.fillStyle = texture(ctx, t.concrete, k);
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = 'rgba(70,66,60,0.4)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = first; i <= last; i++) {
      ctx.moveTo(i * size, y0);
      ctx.lineTo(i * size, y1);
    }
    ctx.stroke();
    // old chewing gum
    for (let i = first; i <= last; i++) {
      const n = Math.floor(hash(i, seed + 9) * 4);
      for (let j = 0; j < n; j++) {
        const gx = i * size + hash(i * 7 + j, seed + 11) * size;
        const gy = y0 + 3 + hash(i * 13 + j, seed + 12) * (h - 6);
        ctx.fillStyle = 'rgba(42,40,38,0.3)';
        ctx.beginPath();
        ctx.arc(gx, gy, 0.6 + hash(i + j * 31, seed) * 0.6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function street(ctx, k, t, x0, w) {
    const S = L.street;
    const W1 = L.sidewalk;
    const W2 = L.farWalk;
    slabs(ctx, k, t, x0, w, W1.y0, W1.y1, 36, 1);
    slabs(ctx, k, t, x0, w, W2.y0, W2.y1, 36, 2);
    ctx.fillStyle = COL.kerb;
    ctx.fillRect(x0, W1.y1, w, S.y0 - W1.y1);
    ctx.fillRect(x0, S.y1, w, W2.y0 - S.y1);
    // dropped kerbs where the driveways cross
    for (const d of [L.entry, L.exit]) {
      ctx.fillStyle = '#c1beb6';
      ctx.beginPath();
      ctx.moveTo(d.x0 - 10, W1.y1);
      ctx.lineTo(d.x1 + 10, W1.y1);
      ctx.lineTo(d.x1 + 4, S.y0 + 0.5);
      ctx.lineTo(d.x0 - 4, S.y0 + 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, S.y0, w, S.y1 - S.y0);
    ctx.clip();
    ctx.fillStyle = COL.street;
    ctx.fillRect(x0, S.y0, w, S.y1 - S.y0);
    mottleOver(ctx, t.coarse, 0.3);
    mottleOver(ctx, t.fine, 0.16);
    ctx.lineCap = 'butt';
    for (const [lw, a] of [[11, 0.06], [4, 0.05]]) {
      ctx.strokeStyle = `rgba(16,16,18,${a})`;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const dy of [-46, -16, 16, 46]) {
        ctx.moveTo(x0, L.streetMid + dy);
        ctx.lineTo(x0 + w, L.streetMid + dy);
      }
      ctx.stroke();
    }
    ctx.fillStyle = texture(ctx, t.asphalt, k);
    ctx.fillRect(x0, S.y0, w, S.y1 - S.y0);
    // concrete gutters along both kerbs, with drain grates and joints
    for (const [gy, gh] of [[S.y0, 7], [S.y1 - 7, 7]]) {
      ctx.fillStyle = '#8f8c86';
      ctx.fillRect(x0, gy, w, gh);
      ctx.fillStyle = texture(ctx, t.concrete, k);
      ctx.fillRect(x0, gy, w, gh);
      ctx.fillStyle = 'rgba(60,58,54,0.35)';
      for (let x = Math.floor(x0 / 54) * 54; x < x0 + w; x += 54) ctx.fillRect(x, gy, 0.7, gh);
      ctx.fillRect(x0, gy === S.y0 ? gy + gh - 0.5 : gy, w, 0.6);
    }
    for (let x = Math.floor((x0 - 120) / 432) * 432 + 120; x < x0 + w; x += 432) drain(ctx, x, S.y0 + 4.6, 0);
    for (let x = Math.floor((x0 - 336) / 432) * 432 + 336; x < x0 + w; x += 432) drain(ctx, x, S.y1 - 4.6, 0);
    manhole(ctx, 548, L.streetMid - 22, 7.4);
    // the near kerb shades a thin strip of the road
    const g = ctx.createLinearGradient(0, S.y0, 0, S.y0 + 4);
    g.addColorStop(0, 'rgba(0,0,0,0.38)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, S.y0, w, 4);
    ctx.restore();
    ctx.fillStyle = 'rgba(80,76,70,0.5)';
    ctx.fillRect(x0, W1.y1 - 0.4, w, 0.8);
    ctx.fillRect(x0, S.y1 - 0.4, w, 0.8);
    // tyre marks where cars cross the sidewalk at the driveways
    for (const d of [L.entry, L.exit]) {
      const cx = (d.x0 + d.x1) / 2;
      ctx.fillStyle = 'rgba(30,30,30,0.07)';
      for (const dx of [-15, 15]) ctx.fillRect(cx + dx - 4, W1.y0, 8, S.y0 - W1.y0);
    }
  }

  /* ---------- The paved lot ---------- */
  function pavedShape(ctx) {
    const P = L.paved;
    rrect(ctx, P.x, P.y, P.w, P.h, P.r);
    for (const d of [L.entry, L.exit]) ctx.rect(d.x0, P.y + P.h - 30, d.x1 - d.x0, L.sidewalk.y0 - (P.y + P.h) + 30);
  }

  const PATCHES = [
    { x: 486, y: 366, w: 96, h: 60 },
    { x: 612, y: 70, w: 74, h: 46 },
    { x: 870, y: 506, w: 58, h: 118 },
    { x: 346, y: 690, w: 118, h: 52 },
  ];

  function patches(ctx, t) {
    for (const p of PATCHES) {
      ctx.fillStyle = COL.patch;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, p.y, p.w, p.h);
      ctx.clip();
      mottleOver(ctx, t.fine, 0.1);
      ctx.restore();
      ctx.strokeStyle = 'rgba(14,14,16,0.1)';
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = 'rgba(14,14,16,0.3)';
      ctx.lineWidth = 0.9;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    }
  }

  /* Darker bands where wheels run, two to a lane. */
  function wheelTracks(ctx) {
    ctx.lineCap = 'round';
    for (const [lw, a] of [[11, 0.05], [4, 0.045]]) {
      ctx.strokeStyle = `rgba(16,16,18,${a})`;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const y of [L.yT, L.yM, L.yB]) {
        for (const dy of [-44, -16, 16, 44]) {
          ctx.moveTo(L.xL - 20, y + dy);
          ctx.lineTo(L.xR + 20, y + dy);
        }
      }
      for (const x of [L.xL, L.xR]) {
        for (const dx of [-44, -16, 16, 44]) {
          ctx.moveTo(x + dx, L.yT - 20);
          ctx.lineTo(x + dx, L.yB + 20);
        }
      }
      for (const d of [L.entry, L.exit]) {
        const cx = (d.x0 + d.x1) / 2;
        for (const dx of [-15, 15]) {
          ctx.moveTo(cx + dx, L.yB + 30);
          ctx.lineTo(cx + dx, L.sidewalk.y0);
        }
      }
      ctx.stroke();
    }
  }

  /* Oil drips where engines sit, heavier in the busy bays. */
  function stains(ctx) {
    for (const bay of PS.BAYS) {
      const rnd = U.seeded(strSeed(bay.id) + SEED);
      const use = 0.3 + rnd() * 0.7;
      const toHead = bay.backY > bay.edgeY ? 1 : -1;
      ctx.fillStyle = `rgba(16,15,14,${0.04 * use})`;
      ctx.beginPath();
      rrect(ctx, bay.cx - 16, bay.parkY - 41, 32, 82, 11);
      ctx.fill();
      const n = 3 + Math.floor(rnd() * 3);
      const dy = bay.backY - toHead * (22 + rnd() * 8);
      for (let i = 0; i < n; i++) {
        blob(ctx, bay.cx + (rnd() - 0.5) * 9, dy + (rnd() - 0.5) * 11, (3 + rnd() * 6) * (0.6 + use * 0.6), '14,12,10', (0.07 + rnd() * 0.13) * use);
      }
      if (rnd() < 0.6) blob(ctx, bay.cx + (rnd() - 0.5) * 8, bay.backY - toHead * (54 + rnd() * 12), 3 + use * 4, '14,12,10', 0.07 * use);
    }
    const rnd = U.seeded(SEED + 31);
    for (let i = 0; i < 28; i++) {
      const y = [L.yT, L.yM, L.yB][i % 3] + (rnd() - 0.5) * 84;
      blob(ctx, L.xL + rnd() * (L.xR - L.xL), y, 2 + rnd() * 4, '14,12,10', 0.05 + rnd() * 0.08);
    }
  }

  /* Cracks sealed with tar, the black squiggles of an old car park. */
  function cracks(ctx) {
    const rnd = U.seeded(SEED + 41);
    const list = [];
    const walk = (x, y, a, length, width, depth, wiggle) => {
      const pts = [[x, y]];
      for (let s = 0; s < length; s += 2.6) {
        a += (rnd() - 0.5) * wiggle;
        x += Math.cos(a) * 2.6;
        y += Math.sin(a) * 2.6;
        pts.push([x, y]);
        if (depth < 2 && rnd() < 0.028) {
          walk(x, y, a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.7), (length - s) * (0.2 + rnd() * 0.3), width * 0.7, depth + 1, wiggle * 1.2);
        }
      }
      list.push({ pts, width });
    };
    // construction joints down the middle of the aisles
    walk(L.xL + 70, L.yM + 1, 0, 300, 1.1, 0, 0.1);
    walk(L.xR - 60, L.yT - 2, Math.PI, 220, 1, 0, 0.1);
    walk(L.xL - 2, L.yT + 60, Math.PI / 2, 260, 1, 0, 0.1);
    walk(L.xR + 3, L.yM + 40, Math.PI / 2, 200, 0.9, 0, 0.1);
    walk(L.xL + 300, L.yB - 3, 0, 180, 1, 0, 0.1);
    for (let i = 0; i < 10; i++) {
      const aisle = i % 5;
      let x;
      let y;
      if (aisle < 3) {
        y = [L.yT, L.yM, L.yB][aisle] + (rnd() - 0.5) * 90;
        x = L.xL + rnd() * (L.xR - L.xL);
      } else {
        x = (aisle === 3 ? L.xL : L.xR) + (rnd() - 0.5) * 90;
        y = L.yT + rnd() * (L.yB - L.yT);
      }
      walk(x, y, rnd() * TAU, 20 + rnd() * 70, 0.7 + rnd() * 0.5, 0, 0.5);
    }
    for (let i = 0; i < 5; i++) {
      const b = PS.BAYS[Math.floor(rnd() * PS.BAYS.length)];
      walk(b.x + rnd() * b.w, b.y + rnd() * b.h, rnd() * TAU, 14 + rnd() * 34, 0.7, 1, 0.6);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [extra, color] of [[2, 'rgba(20,20,22,0.1)'], [0, 'rgba(14,14,16,0.42)']]) {
      ctx.strokeStyle = color;
      for (const c of list) {
        ctx.lineWidth = c.width + extra;
        ctx.beginPath();
        ctx.moveTo(c.pts[0][0], c.pts[0][1]);
        for (let i = 1; i < c.pts.length; i++) ctx.lineTo(c.pts[i][0], c.pts[i][1]);
        ctx.stroke();
      }
    }
  }

  function drain(ctx, x, y, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 17);
    g.addColorStop(0, 'rgba(10,10,12,0.32)');
    g.addColorStop(1, 'rgba(10,10,12,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 13, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#7b7d7e';
    ctx.fillRect(-8, -5, 16, 10);
    ctx.fillStyle = '#26282a';
    ctx.fillRect(-6.8, -3.8, 13.6, 7.6);
    ctx.fillStyle = '#55585a';
    for (let i = -5.6; i <= 5.7; i += 1.6) ctx.fillRect(i - 0.35, -3.4, 0.7, 6.8);
    ctx.restore();
  }

  function manhole(ctx, x, y, r) {
    blob(ctx, x, y, r * 1.7, '12,12,14', 0.22);
    ctx.fillStyle = '#6d6f70';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#3b3d3f';
    ctx.beginPath();
    ctx.arc(x, y, r - 1.1, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,152,150,0.35)';
    ctx.lineWidth = 0.5;
    for (let q = 1.5; q < r - 1.5; q += 1.4) {
      ctx.beginPath();
      ctx.arc(x, y, q, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(230,230,225,0.16)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, TAU);
    ctx.fill();
  }

  function lot(ctx, k, t) {
    const P = L.paved;
    const bottom = L.sidewalk.y0;
    ctx.save();
    ctx.beginPath();
    pavedShape(ctx);
    ctx.clip();
    ctx.fillStyle = COL.asphalt;
    ctx.fillRect(P.x - 2, P.y - 2, P.w + 4, bottom - P.y + 4);
    mottleOver(ctx, t.coarse, 0.4);
    mottleOver(ctx, t.fine, 0.2);
    patches(ctx, t);
    wheelTracks(ctx);
    stains(ctx);
    ctx.fillStyle = texture(ctx, t.asphalt, k);
    ctx.fillRect(P.x - 2, P.y - 2, P.w + 4, bottom - P.y + 4);
    cracks(ctx);
    drain(ctx, 452, L.yM + 4, 0);
    drain(ctx, 640, L.yB - 6, 0);
    drain(ctx, L.xR - 4, 250, Math.PI / 2);
    manhole(ctx, 742, L.yM - 10, 7.4);
    manhole(ctx, L.xL + 8, 560, 7.4);
    // the kerb along the north and west edges shades the asphalt beside it
    let g = ctx.createLinearGradient(0, P.y, 0, P.y + 5);
    g.addColorStop(0, 'rgba(0,0,0,0.32)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(P.x, P.y, P.w, 5);
    g = ctx.createLinearGradient(P.x, 0, P.x + 5, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.32)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(P.x, P.y, 5, P.h);
    ctx.restore();
  }

  /* ---------- Paint ---------- */
  function arrow(p, x, y, angle) {
    p.save();
    p.translate(x, y);
    p.rotate(angle);
    p.beginPath();
    p.moveTo(-1.8, 19);
    p.lineTo(-1.8, -3);
    p.lineTo(-7.5, -3);
    p.lineTo(0, -21);
    p.lineTo(7.5, -3);
    p.lineTo(1.8, -3);
    p.lineTo(1.8, 19);
    p.closePath();
    p.fill();
    p.restore();
  }

  function paintMarks(p, x0, w) {
    p.fillStyle = COL.paint;
    // bay lines: dividers through both rows, and the head line between them
    for (const b of Object.values(L.blocks)) {
      for (let c = 0; c <= L.cols; c++) {
        const x = L.bayX0 + c * L.bayW;
        p.fillRect(x - 1, b.y + 0.5, 2, b.h - 1);
      }
      p.fillRect(L.bayX0 - 1, b.y + b.h / 2 - 1, L.cols * L.bayW + 2, 2);
    }
    // bay numbers on the aisle in front of each bay, readable from the map
    p.font = NUM_FONT;
    p.textAlign = 'center';
    p.textBaseline = 'middle';
    for (const bay of PS.BAYS) p.fillText(bay.id, bay.cx, bay.edgeY + (bay.opensUp ? -19 : 19));
    // direction arrows: traffic keeps right, so eastbound runs south of each aisle centre
    const E = Math.PI / 2;
    const Wd = -Math.PI / 2;
    const S = Math.PI;
    const xa = L.blocks.A.x + L.island / 2;
    const xb = L.blocks.A.x + L.blocks.A.w - L.island / 2;
    const off = L.laneOffset;
    arrow(p, xa, L.yT + off, E);
    arrow(p, xb, L.yT - off, Wd);
    arrow(p, 470, L.yT - off, Wd);
    arrow(p, xa, L.yM + off, E);
    arrow(p, xb, L.yM - off, Wd);
    arrow(p, 300, L.yB + off, E);
    arrow(p, 610, L.yB + off, E);
    arrow(p, xb, L.yB - off, Wd);
    arrow(p, L.xL + off, 300, 0);
    arrow(p, L.xL - off, 230, S);
    arrow(p, L.xL - off, 540, S);
    arrow(p, L.xR + off, 300, 0);
    arrow(p, L.xR - off, 250, S);
    arrow(p, L.xR - off, 560, S);
    // zebra crossing from the footpath to the island
    const cw = L.walkway.x1 - L.walkway.x0;
    for (let y = L.blocks.B.y + L.blocks.B.h + 6; y < L.paved.y + L.paved.h - 8; y += 13) p.fillRect(L.walkway.x0, y, cw, 7);
    // stop line before the exit barrier, and a word for drivers coming in
    p.fillRect(L.exit.x0 + 3, L.gateY - 17, L.exit.x1 - L.exit.x0 - 6, 3.2);
    p.font = WORD_FONT;
    p.save();
    p.translate((L.entry.x0 + L.entry.x1) / 2, L.paved.y + L.paved.h - 22);
    p.scale(1.3, 2.2);
    p.fillText('IN', 0, 0);
    p.restore();
    // dashed centre line on the street
    const start = Math.floor(x0 / 128) * 128;
    for (let x = start; x < x0 + w; x += 128) p.fillRect(x, L.streetMid - 1.2, 56, 2.4);
  }

  /* Tyres scrub the paint where cars turn in, cross the zebra and run the arrows. */
  function scuffs(p) {
    const rnd = U.seeded(SEED + 51);
    const rub = (x, y, r, a) => blob(p, x, y, r, '0,0,0', a);
    for (const b of Object.values(L.blocks)) {
      for (let c = 0; c <= L.cols; c++) {
        const x = L.bayX0 + c * L.bayW;
        for (const y of [b.y, b.y + b.h]) {
          if (rnd() < 0.75) rub(x + (rnd() - 0.5) * 3, y + (y === b.y ? 1 : -1) * (3 + rnd() * 10), 5 + rnd() * 7, 0.4 + rnd() * 0.4);
        }
      }
    }
    for (let i = 0; i < 90; i++) rub(L.paved.x + rnd() * L.paved.w, L.paved.y + rnd() * L.paved.h, 4 + rnd() * 12, 0.2 + rnd() * 0.35);
    for (let i = 0; i < 36; i++) rub(L.walkway.x0 + rnd() * 24, 650 + rnd() * 100, 3 + rnd() * 5, 0.25 + rnd() * 0.3);
  }

  let paintCanvas = null;
  function paintLayer(ctx, k, t, frame, pw, ph, x0, y0, w, h) {
    if (!paintCanvas) paintCanvas = document.createElement('canvas');
    if (paintCanvas.width !== pw || paintCanvas.height !== ph) {
      paintCanvas.width = pw;
      paintCanvas.height = ph;
    }
    const p = paintCanvas.getContext('2d');
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, pw, ph);
    p.setTransform(...frame);
    paintMarks(p, x0, w);
    p.globalCompositeOperation = 'destination-out';
    p.fillStyle = texture(p, t.wear, k);
    p.fillRect(x0, y0, w, h);
    scuffs(p);
    p.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(paintCanvas, 0, 0);
    ctx.restore();
  }

  /* ---------- Kerbs, islands and things standing on the asphalt ---------- */
  function kerbs(ctx) {
    const P = L.paved;
    ctx.save();
    ctx.beginPath();
    ctx.rect(P.x - 20, P.y - 20, P.w + 40, P.h + 40);
    for (const g of [[L.entry.x0, L.entry.x1], [L.exit.x0, L.exit.x1], [L.walkway.x0, L.walkway.x1]]) {
      ctx.rect(g[0], P.y + P.h - 8, g[1] - g[0], 16);
    }
    ctx.clip('evenodd');
    ctx.beginPath();
    rrect(ctx, P.x, P.y, P.w, P.h, P.r);
    ctx.strokeStyle = 'rgba(60,56,50,0.5)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = COL.kerb;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();
    // kerbs along the sides of the driveways and the footpath
    ctx.fillStyle = COL.kerb;
    for (const x of [L.entry.x0, L.entry.x1, L.exit.x0, L.exit.x1]) {
      ctx.fillStyle = 'rgba(60,56,50,0.5)';
      ctx.fillRect(x - 3, P.y + P.h + 1, 6, L.sidewalk.y0 - P.y - P.h - 1);
      ctx.fillStyle = COL.kerb;
      ctx.fillRect(x - 2.5, P.y + P.h + 1, 5, L.sidewalk.y0 - P.y - P.h - 1);
    }
  }

  function shrub(ctx, k, x, y, r, rnd) {
    softShadow(ctx, k, (c) => c.arc(x, y, r, 0, TAU), r * 0.35, r * 0.45, r * 0.35, 'rgba(0,0,0,0.42)');
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#8fb26b');
    g.addColorStop(0.55, '#4e7337');
    g.addColorStop(1, '#2a441f');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 12; i++) {
      const a = rnd() * TAU;
      const d = rnd() * r * 0.8;
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(170,205,120,0.45)' : 'rgba(20,40,14,0.4)';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.12 + rnd() * 0.12), 0, TAU);
      ctx.fill();
    }
  }

  function bed(ctx, k, t, shape, bbox) {
    ctx.save();
    ctx.beginPath();
    shape(ctx);
    ctx.clip();
    ctx.fillStyle = COL.mulch;
    ctx.fillRect(bbox[0], bbox[1], bbox[2], bbox[3]);
    mottleOver(ctx, t.fine, 0.5);
    ctx.fillStyle = texture(ctx, t.mulch, k);
    ctx.fillRect(bbox[0], bbox[1], bbox[2], bbox[3]);
    ctx.restore();
  }

  function islands(ctx, k, t) {
    for (const b of Object.values(L.blocks)) {
      for (const ix of [b.x, b.x + b.w - L.island]) {
        const x = ix + 4;
        const y = b.y + 4;
        const w = L.island - 8;
        const h = b.h - 8;
        const r = w / 2;
        const outer = (c) => rrect(c, x, y, w, h, r);
        softShadow(ctx, k, outer, 1.3, 1.8, 2.4, 'rgba(0,0,0,0.42)');
        ctx.fillStyle = COL.kerb;
        ctx.beginPath();
        outer(ctx);
        ctx.fill();
        ctx.strokeStyle = 'rgba(70,66,60,0.45)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
        const c = 3.4;
        const inner = (cx) => rrect(cx, x + c, y + c, w - 2 * c, h - 2 * c, r - c);
        bed(ctx, k, t, inner, [x, y, w, h]);
        ctx.save();
        ctx.beginPath();
        inner(ctx);
        ctx.clip();
        ctx.strokeStyle = 'rgba(0,0,0,0.32)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        rrect(ctx, x + c + 0.7, y + c + 0.9, w - 2 * c, h - 2 * c, r - c);
        ctx.stroke();
        ctx.restore();
        const rnd = U.seeded(strSeed(`${ix}:${b.y}`));
        for (const sy of [y + 18, y + h / 2, y + h - 18]) {
          for (const sx of [x + w / 2 - 6, x + w / 2 + 6]) shrub(ctx, k, sx + (rnd() - 0.5) * 4, sy + (rnd() - 0.5) * 8, 3.8 + rnd() * 2.2, rnd);
        }
      }
    }
  }

  /* Concrete wheel stops near the head of every bay. */
  function wheelStops(ctx, k) {
    for (const bay of PS.BAYS) {
      const rnd = U.seeded(strSeed(bay.id) + 99);
      const toHead = bay.backY > bay.edgeY ? 1 : -1;
      ctx.save();
      ctx.translate(bay.cx + (rnd() - 0.5) * 1.6, bay.backY - toHead * 12);
      ctx.rotate((rnd() - 0.5) * 0.05);
      softShadow(ctx, k, (c) => rrect(c, -15, -1.8, 30, 3.6, 1.2), 0.9, 1.3, 1.2, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = shade('#a7a49c', (rnd() - 0.5) * 12);
      ctx.beginPath();
      rrect(ctx, -15, -1.8, 30, 3.6, 1.2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.fillRect(-14, -1.5, 28, 0.8);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(-14, 0.9, 28, 0.7);
      ctx.fillStyle = 'rgba(40,40,40,0.6)';
      for (const px of [-11, 11]) {
        ctx.beginPath();
        ctx.arc(px, 0, 0.7, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /* Light poles stand on concrete footings where four bays meet. */
  const POLES = [];
  for (const b of Object.values(L.blocks)) for (const c of [3, 10]) POLES.push([L.bayX0 + c * L.bayW, b.y + b.h / 2]);
  scene.poles = POLES;

  function footings(ctx, k) {
    for (const [x, y] of POLES) {
      softShadow(ctx, k, (c) => c.arc(x, y, 4.8, 0, TAU), 1.2, 1.6, 1.4, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = '#bcb9b1';
      ctx.beginPath();
      ctx.arc(x, y, 4.8, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(x - 1.2, y - 1.4, 2.4, 0, TAU);
      ctx.fill();
    }
  }

  function box(ctx, k, x, y, w, h, body, top, shadow) {
    softShadow(ctx, k, (c) => c.rect(x, y, w, h), shadow, shadow * 1.3, 1.6, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = body;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = top;
    ctx.fillRect(x + 0.8, y + 0.8, w - 1.6, h - 1.6);
  }

  /* The planted strip between the lot and the sidewalk. */
  function strip(ctx, k, t) {
    const S = L.strip;
    const wx = L.walkway.x0;
    const ww = L.walkway.x1 - L.walkway.x0;
    // footpath to the zebra crossing, with tactile paving at the kerb
    ctx.fillStyle = COL.concrete;
    ctx.fillRect(wx, S.y0 - 4, ww, L.sidewalk.y0 - S.y0 + 4);
    ctx.save();
    ctx.beginPath();
    ctx.rect(wx, S.y0 - 4, ww, L.sidewalk.y0 - S.y0 + 4);
    ctx.clip();
    ctx.fillStyle = texture(ctx, t.concrete, k);
    ctx.fillRect(wx, S.y0 - 4, ww, L.sidewalk.y0 - S.y0 + 4);
    ctx.strokeStyle = 'rgba(70,66,60,0.4)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let y = S.y0 + 10; y < L.sidewalk.y0; y += 12) {
      ctx.moveTo(wx, y);
      ctx.lineTo(wx + ww, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#d4ad2a';
    ctx.fillRect(wx + 1, S.y0 - 3, ww - 2, 7);
    ctx.fillStyle = 'rgba(110,80,8,0.5)';
    for (let i = wx + 2.4; i < wx + ww - 1; i += 2.4) {
      for (let j = S.y0 - 1.8; j < S.y0 + 4; j += 2.4) {
        ctx.beginPath();
        ctx.arc(i, j, 0.5, 0, TAU);
        ctx.fill();
      }
    }
    // hedge on a planted bed along the street
    const hx0 = 258;
    const hx1 = L.exit.x0 - 14;
    bed(ctx, k, t, (c) => rrect(c, hx0 - 4, 776, hx1 - hx0 + 8, 28, 6), [hx0 - 4, 776, hx1 - hx0 + 8, 28]);
    const hedge = (c) => rrect(c, hx0, 781, hx1 - hx0, 15, 7);
    softShadow(ctx, k, hedge, 2.4, 3.2, 2.6, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = '#3c5b32';
    ctx.beginPath();
    hedge(ctx);
    ctx.fill();
    const rnd = U.seeded(SEED + 81);
    ctx.save();
    ctx.beginPath();
    hedge(ctx);
    ctx.clip();
    for (let i = 0; i < (hx1 - hx0) * 1.4; i++) {
      const x = hx0 + rnd() * (hx1 - hx0);
      const y = 781 + rnd() * 15;
      const lit = 1 - (y - 781) / 15;
      ctx.fillStyle = rnd() < 0.35 + lit * 0.3 ? `rgba(150,190,100,${0.25 + lit * 0.25})` : 'rgba(18,36,12,0.35)';
      ctx.beginPath();
      ctx.arc(x, y, 1.6 + rnd() * 2.6, 0, TAU);
      ctx.fill();
    }
    const g = ctx.createLinearGradient(0, 781, 0, 796);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(hx0, 781, hx1 - hx0, 15);
    ctx.restore();
    // attendant booth: a flat roof with a small air-conditioning unit
    const B = L.booth;
    softShadow(ctx, k, (c) => c.rect(B.x, B.y, B.w, B.h), 7, 9, 3, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = '#8c9194';
    ctx.fillRect(B.x, B.y, B.w, B.h);
    ctx.fillStyle = '#c8cbcc';
    ctx.fillRect(B.x + 1.6, B.y + 1.6, B.w - 3.2, B.h - 3.2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(B.x + 1.6, B.y + 1.6, B.w - 3.2, B.h - 3.2);
    ctx.clip();
    ctx.fillStyle = texture(ctx, t.concrete, k);
    ctx.fillRect(B.x, B.y, B.w, B.h);
    ctx.strokeStyle = 'rgba(90,95,98,0.35)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = B.x + 8; x < B.x + B.w; x += 8) {
      ctx.moveTo(x, B.y);
      ctx.lineTo(x, B.y + B.h);
    }
    ctx.stroke();
    ctx.restore();
    box(ctx, k, B.x + 24, B.y + 6, 10, 8, '#8f9497', '#a9aeb1', 1.6);
    ctx.fillStyle = '#3a3f43';
    ctx.beginPath();
    ctx.arc(B.x + 29, B.y + 10, 2.8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#777d81';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let a = 0; a < TAU; a += TAU / 5) {
      ctx.moveTo(B.x + 29, B.y + 10);
      ctx.lineTo(B.x + 29 + Math.cos(a) * 2.6, B.y + 10 + Math.sin(a) * 2.6);
    }
    ctx.stroke();
    // bins beside the booth
    for (const bx of [216, 226]) {
      softShadow(ctx, k, (c) => c.arc(bx, 805, 3.2, 0, TAU), 1.4, 1.8, 1.4, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = '#2c4636';
      ctx.beginPath();
      ctx.arc(bx, 805, 3.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#3f6050';
      ctx.beginPath();
      ctx.arc(bx - 0.5, 804.5, 2.2, 0, TAU);
      ctx.fill();
    }
    // bollards where the footpath meets the lot
    for (const bx of [wx + 3, wx + ww - 3]) {
      softShadow(ctx, k, (c) => c.arc(bx, 752, 1.9, 0, TAU), 1.6, 2.1, 1.2, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = '#e1b324';
      ctx.beginPath();
      ctx.arc(bx, 752, 1.9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(bx - 0.5, 751.4, 0.8, 0, TAU);
      ctx.fill();
    }
    // kerbed islands for the ticket machine and the pay station
    for (const [ix, mx] of [[L.entry.x0 - 16, L.entry.x0 - 13], [L.exit.x1 + 2, L.exit.x1 + 5]]) {
      const isl = (c) => rrect(c, ix, 767, 14, 38, 6);
      softShadow(ctx, k, isl, 1, 1.4, 1.6, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = COL.kerb;
      ctx.beginPath();
      isl(ctx);
      ctx.fill();
      ctx.fillStyle = COL.concrete;
      ctx.beginPath();
      rrect(ctx, ix + 2.4, 769.4, 9.2, 33.2, 4);
      ctx.fill();
      box(ctx, k, mx, 771, 8, 9, '#2f3539', '#4b5257', 2);
      ctx.fillStyle = '#e0aa1c';
      ctx.fillRect(mx + 0.8, 771.8, 6.4, 1.6);
      ctx.fillStyle = '#5fb4e6';
      ctx.fillRect(mx + 2, 775, 4, 2.6);
    }
  }

  /* ---------- Drawing it all ---------- */
  function paint(ctx, k, v, frame, pw, ph) {
    const t = textures();
    const x0 = v.x0 - 4;
    const y0 = v.y0 - 4;
    const w = v.x1 - v.x0 + 8;
    const h = v.y1 - v.y0 + 8;
    ctx.fillStyle = COL.lawn;
    ctx.fillRect(x0, y0, w, h);
    mottleOver(ctx, t.coarse, 0.5);
    ctx.fillStyle = texture(ctx, t.lawn, k);
    ctx.fillRect(x0, y0, w, h);
    street(ctx, k, t, x0, w);
    lot(ctx, k, t);
    paintLayer(ctx, k, t, frame, pw, ph, x0, y0, w, h);
    kerbs(ctx);
    islands(ctx, k, t);
    wheelStops(ctx, k);
    footings(ctx, k);
    strip(ctx, k, t);
  }

  function render() {
    const box = scene.box;
    const cv = scene.canvas;
    if (!box || !cv) return;
    const cw = box.clientWidth;
    const ch = box.clientHeight;
    if (!cw || !ch) return;
    let ratio = Math.min(window.devicePixelRatio || 1, 2);
    const cap = 5.2e6; // keep the canvas under about five megapixels
    if (cw * ch * ratio * ratio > cap) ratio = Math.sqrt(cap / (cw * ch));
    const pw = Math.round(cw * ratio);
    const ph = Math.round(ch * ratio);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    const ctx = cv.getContext('2d');
    // the same fit as the SVG's preserveAspectRatio="xMidYMid meet"
    const s = Math.min(cw / L.width, ch / L.height);
    const ox = (cw - L.width * s) / 2;
    const oy = (ch - L.height * s) / 2;
    const k = s * ratio;
    const view = { x0: -ox / s, y0: -oy / s, x1: (cw - ox) / s, y1: (ch - oy) / s };
    const frame = [k, 0, 0, k, ox * ratio, oy * ratio];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(...frame);
    paint(ctx, k, view, frame, pw, ph);
    scene.ready = true;
    scene.size = `${cw}x${ch}`;
  }
  scene.render = render;

  /* Put the canvas behind the map and keep it in step. Returns false where canvas drawing is not available. */
  scene.mount = function (box, before) {
    let ctx = null;
    const cv = document.createElement('canvas');
    try {
      ctx = cv.getContext('2d');
    } catch (e) {
      ctx = null;
    }
    if (!ctx || typeof ctx.getTransform !== 'function') return false;
    cv.className = 'lot-ground';
    cv.setAttribute('aria-hidden', 'true');
    box.insertBefore(cv, before || box.firstChild);
    scene.canvas = cv;
    scene.box = box;
    try {
      render();
    } catch (err) {
      console.error(err);
      cv.remove();
      scene.canvas = null;
      return false;
    }
    const later = U.debounce(() => {
      if (scene.size !== `${box.clientWidth}x${box.clientHeight}`) render();
    }, 120);
    if ('ResizeObserver' in window) new ResizeObserver(later).observe(box);
    else window.addEventListener('resize', later);
    // bay numbers use Barlow Condensed: redraw once it has loaded
    const again = U.debounce(render, 60);
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(again);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', again);
    }
    return true;
  };

  /* ---------- Trees ---------- */
  const SPECIES = {
    oak: { base: '#486c2f', light: '#a6c76d', dark: '#21401a' },
    lime: { base: '#5b8035', light: '#bdd57c', dark: '#2b4a1b' },
    maple: { base: '#3e6435', light: '#90b974', dark: '#1e3b1b' },
    olive: { base: '#6e7b3b', light: '#c4c978', dark: '#3a4421' },
    plum: { base: '#6b3b3e', light: '#b77768', dark: '#331a1f' },
    pine: { base: '#2f4d3a', light: '#79a185', dark: '#152a1d', conifer: true },
  };
  // [species, crown radius in units]
  const TREES = [
    ['oak', 30], ['oak', 24], ['lime', 27], ['lime', 21], ['maple', 32], ['maple', 25],
    ['olive', 26], ['pine', 21], ['pine', 16], ['plum', 15], ['lime', 15], ['oak', 18],
  ];
  const MED = [1, 3, 5, 6];
  const BIG = [0, 2, 4, 7];
  const SMALL = [8, 9, 10, 11];

  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
  }

  function treeSprite(spec, r, seed) {
    const K = 2.4; // pixels per unit
    const sx = r * 0.36;
    const sy = r * 0.44;
    const pad = r * 0.3 + 3;
    const x0 = -r - pad;
    const y0 = -r - pad;
    const w = 2 * r + 2 * pad + sx;
    const h = 2 * r + 2 * pad + sy;
    const c = makeCanvas(w * K, h * K);
    const ctx = c.getContext('2d');
    ctx.setTransform(K, 0, 0, K, -x0 * K, -y0 * K);
    const rnd = U.seeded(seed);
    const base = hexRgb(spec.base);
    const light = hexRgb(spec.light);
    const dark = hexRgb(spec.dark);

    // A broadleaf crown seen from above is a cluster of rounded clumps of
    // leaves; a conifer is a star of branches.
    const clumps = [];
    const spikes = [];
    if (spec.conifer) {
      const n = 22;
      for (let i = 0; i < n * 2; i++) spikes.push({ a: (i / (n * 2)) * TAU + (rnd() - 0.5) * 0.08, d: r * (i % 2 ? 0.66 + rnd() * 0.08 : 0.92 + rnd() * 0.08) });
    } else {
      const n = 10 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + (rnd() - 0.5) * 0.45;
        const cr = r * (0.26 + rnd() * 0.12);
        const d = r - cr * (0.92 + rnd() * 0.12);
        clumps.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: cr });
      }
      const m = 4 + Math.floor(rnd() * 3);
      for (let i = 0; i < m; i++) {
        const a = rnd() * TAU;
        const d = rnd() * r * 0.32;
        clumps.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: r * (0.3 + rnd() * 0.14) });
      }
    }
    const outline = (cc) => {
      if (spec.conifer) {
        spikes.forEach((p, i) => (i ? cc.lineTo : cc.moveTo).call(cc, Math.cos(p.a) * p.d, Math.sin(p.a) * p.d));
        cc.closePath();
        return;
      }
      cc.moveTo(r * 0.62, 0);
      cc.arc(0, 0, r * 0.62, 0, TAU);
      for (const b of clumps) {
        cc.moveTo(b.x + b.r, b.y);
        cc.arc(b.x, b.y, b.r, 0, TAU);
      }
    };
    softShadow(ctx, K, outline, sx, sy, r * 0.16, 'rgba(8,18,6,0.46)');
    ctx.fillStyle = mix(dark, base, 0.45);
    ctx.beginPath();
    outline(ctx);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    outline(ctx);
    ctx.clip();

    // light on each clump, from the north-west
    for (const b of clumps) {
      const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.05, b.x, b.y, b.r);
      g.addColorStop(0, mix(base, light, 0.5));
      g.addColorStop(0.55, mix(base, light, 0.08));
      g.addColorStop(1, mix(dark, base, 0.3));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }
    if (spec.conifer) {
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 0, 0, 0, r);
      g.addColorStop(0, mix(base, light, 0.35));
      g.addColorStop(1, mix(dark, base, 0.5));
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, 2 * r, 2 * r);
    }

    // leaves: each speck takes its light from the clump it sits on
    const top = (x, y) => {
      for (let i = clumps.length - 1; i >= 0; i--) {
        const b = clumps[i];
        if ((x - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r) return b;
      }
      return { x: 0, y: 0, r };
    };
    const n = Math.round(260 + r * 18);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const d = Math.sqrt(rnd()) * r;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      const b = top(x, y);
      const u = ((x - b.x) * 0.7 + (y - b.y) * 0.8) / b.r;
      const lit = U.clamp(0.55 - u * 0.55 + (rnd() - 0.5) * 0.5, 0, 1);
      ctx.fillStyle = lit > 0.5 ? mix(base, light, (lit - 0.5) * 1.5) : mix(dark, base, 0.25 + lit * 1.5);
      ctx.globalAlpha = 0.55 + rnd() * 0.35;
      ctx.beginPath();
      ctx.arc(x, y, spec.conifer ? 0.4 + rnd() * 0.7 : 0.45 + rnd() * 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (spec.conifer) {
      ctx.strokeStyle = `rgba(${dark},0.45)`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (const p of spikes) {
        if (p.d < r * 0.8) continue;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(p.a) * p.d * 0.95, Math.sin(p.a) * p.d * 0.95);
      }
      ctx.stroke();
    }
    // the whole crown is a little darker on its shaded side
    const g = ctx.createLinearGradient(-r * 0.6, -r * 0.7, r * 0.6, r * 0.75);
    g.addColorStop(0, `rgba(${light},0.12)`);
    g.addColorStop(0.5, `rgba(${light},0)`);
    g.addColorStop(1, `rgba(${dark},0.3)`);
    ctx.fillStyle = g;
    ctx.fillRect(-r * 1.1, -r * 1.1, r * 2.2, r * 2.2);
    ctx.restore();
    return { url: c.toDataURL('image/png'), x: x0, y: y0, w, h };
  }

  function treePlan() {
    const rnd = U.seeded(SEED + 61);
    const out = [];
    const add = (x, y, r, kinds) => {
      const i = kinds[Math.floor(rnd() * kinds.length)];
      out.push({ x, y, i, s: r / TREES[i][1] });
    };
    for (const b of Object.values(L.blocks)) {
      for (const ix of [b.x + L.island / 2, b.x + b.w - L.island / 2]) {
        for (const ty of [b.y + 48, b.y + b.h - 48]) add(ix + (rnd() - 0.5) * 2, ty + (rnd() - 0.5) * 4, 18 + rnd() * 3, MED);
      }
    }
    for (let x = -30; x < L.width + 40; x += 58 + rnd() * 26) add(x, 12 + rnd() * 10, 24 + rnd() * 8, BIG);
    for (let y = 80; y < 740; y += 62 + rnd() * 24) {
      add(14 + rnd() * 8, y, 22 + rnd() * 6, BIG);
      add(L.width - 14 - rnd() * 8, y + 24, 22 + rnd() * 6, BIG);
    }
    for (const x of [330, 470, 610, 760]) add(x + (rnd() - 0.5) * 10, 789, 13 + rnd() * 3, SMALL);
    for (let x = -620; x < L.width + 620; x += 84 + rnd() * 30) add(x, 1044 + rnd() * 10, 22 + rnd() * 6, BIG);
    for (let i = 0; i < 90; i++) {
      const left = i % 2 === 0;
      const x = left ? -50 - rnd() * 650 : L.width + 50 + rnd() * 650;
      const y = -260 + rnd() * 1100;
      if (y > L.sidewalk.y0 - 30 && y < L.farWalk.y1 + 30) continue;
      add(x, y, 20 + rnd() * 14, BIG.concat(MED));
    }
    for (let x = -700; x < L.width + 700; x += 66 + rnd() * 36) add(x, -44 - rnd() * 80, 24 + rnd() * 10, BIG);
    out.sort((a, b) => a.y - b.y);
    return out;
  }

  let sprites = null;
  function treeSprites() {
    if (!sprites) sprites = TREES.map(([sp, r], i) => treeSprite(SPECIES[sp], r, SEED + 100 + i));
    return sprites;
  }

  /* ---------- SVG pieces for the map ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  function svgImage(id, url, x, y, w, h) {
    const im = document.createElementNS(NS, 'image');
    im.setAttribute('id', id);
    im.setAttribute('href', url);
    im.setAttribute('x', x.toFixed(2));
    im.setAttribute('y', y.toFixed(2));
    im.setAttribute('width', w.toFixed(2));
    im.setAttribute('height', h.toFixed(2));
    im.setAttribute('preserveAspectRatio', 'none');
    return im;
  }

  function paintTile(rgb, seed, a0, a1) {
    const noise = makeNoise(seed, 8);
    const rnd = U.seeded(seed + 7);
    const c = pixelTile(64, (d, n) => {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = (y * n + x) * 4;
          let a = a0 + (a1 - a0) * fbm(noise, x / 8, y / 8, 3);
          if (rnd() < 0.05) a *= 0.3;
          d[i] = rgb[0];
          d[i + 1] = rgb[1];
          d[i + 2] = rgb[2];
          d[i + 3] = a * 255;
        }
      }
    });
    return c.toDataURL('image/png');
  }

  function shadowSprite(hl, hw) {
    const K = 3;
    const pad = 8;
    const w = hw * 2 + pad * 2;
    const h = hl * 2 + pad * 2;
    const c = makeCanvas(w * K, h * K);
    const ctx = c.getContext('2d');
    ctx.setTransform(K, 0, 0, K, (hw + pad) * K, (hl + pad) * K);
    softShadow(ctx, K, (cc) => rrect(cc, -hw + 0.6, -hl + 0.6, hw * 2 - 1.2, hl * 2 - 1.2, 7), 0, 0, 3.2, 'rgba(0,0,0,0.6)');
    return { url: c.toDataURL('image/png'), x: -hw - pad, y: -hl - pad, w, h };
  }

  /* Adds the shared images and paint patterns to the map's <defs>. */
  scene.addDefs = function (defs) {
    treeSprites().forEach((s, i) => defs.appendChild(svgImage(`ps-tree-${i}`, s.url, s.x, s.y, s.w, s.h)));
    for (const [style, v] of Object.entries(PS.CAR_STYLES)) {
      const s = shadowSprite(v.hl, v.hw);
      defs.appendChild(svgImage(`ps-shadow-${style}`, s.url, s.x, s.y, s.w, s.h));
    }
    [
      ['white', [245, 245, 239], 0.6, 0.95],
      ['green', [30, 138, 92], 0.55, 0.85],
      ['blue', [36, 92, 192], 0.62, 0.92],
    ].forEach(([name, rgb, a0, a1], i) => {
      const pat = document.createElementNS(NS, 'pattern');
      pat.setAttribute('id', `ps-paint-${name}`);
      pat.setAttribute('patternUnits', 'userSpaceOnUse');
      pat.setAttribute('width', '48');
      pat.setAttribute('height', '48');
      pat.appendChild(svgImage(`ps-paint-${name}-img`, paintTile(rgb, SEED + 70 + i, a0, a1), 0, 0, 48, 48));
      defs.appendChild(pat);
    });
  };

  /* Tree crowns for the layer above the cars. */
  scene.treeMarkup = function () {
    treeSprites();
    return treePlan()
      .map((t) => `<use href="#ps-tree-${t.i}" transform="translate(${t.x.toFixed(1)} ${t.y.toFixed(1)}) scale(${t.s.toFixed(3)})"/>`)
      .join('');
  };
})();
