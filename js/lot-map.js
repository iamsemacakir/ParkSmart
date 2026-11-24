/* ParkSmart — lot map
 * The lot as it looks from the air. scene.js paints the ground (asphalt,
 * paint, kerbs, lawn and street) on a canvas; this SVG sits on top and
 * holds everything that changes or can be clicked: paint for EV and
 * accessible bays, sensor lights, cars and their shadows, the barriers,
 * trees and light poles, the heatmap and the bays themselves. Cars drive
 * in from the street, back out of bays and leave through the exit along
 * real routes.
 */
(function () {
  'use strict';
  const PS = window.PS;
  const U = PS.util;
  const L = PS.LOT;
  const R = PS.routing;
  const NS = 'http://www.w3.org/2000/svg';

  const C = {
    lawn: '#5a7442',
    asphalt: '#53565a',
    street: '#45484c',
    concrete: '#bbb8b0',
    kerb: '#c9c6be',
    mulch: '#5a3f2f',
    paint: '#f3f3ed',
    ev: '#1e8a5c',
    acc: '#245cc0',
  };
  const SUN = [3.4, 4.4]; // where a car's shadow falls, in lot units: light from the north-west
  const SPEED = 340; // lot units per second when driving forwards
  const REVERSE_SPEED = 130;

  const map = (PS.map = {
    svg: null,
    stage: null,
    layers: {},
    carEls: new Map(),
    bayEls: new Map(),
    ledEls: new Map(),
    selected: null,
    target: null,
    focusId: 'B14',
    filter: 'all',
    mode: 'normal', // normal | edit | move
    moveSource: null,
    heat: false,
    heatData: null,
    painted: false, // true when scene.js drew the ground on a canvas
    arriving: new Set(),
    moving: new Set(),
    busy: new Set(), // bays a car is still pulling out of or into
    held: new Map(), // checked-out cars waiting for the receipt to close
    onActivate: () => {},
    onHover: () => {},
  });

  /* ---------- Building blocks ---------- */
  const el = (name, attrs = {}) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const f1 = (n) => (Math.round(n * 10) / 10).toString();
  const f2 = (n) => (Math.round(n * 100) / 100).toString();

  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function defs() {
    return `<defs>
      <linearGradient id="ps-car-x" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".08" stop-color="#000" stop-opacity=".2"/>
        <stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".13"/>
        <stop offset=".6" stop-color="#fff" stop-opacity=".13"/><stop offset=".78" stop-color="#000" stop-opacity="0"/>
        <stop offset=".92" stop-color="#000" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity=".55"/>
      </linearGradient>
      <linearGradient id="ps-car-y" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity=".34"/><stop offset=".05" stop-color="#000" stop-opacity=".06"/>
        <stop offset=".16" stop-color="#fff" stop-opacity=".08"/><stop offset=".84" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".95" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".34"/>
      </linearGradient>
      <linearGradient id="ps-car-glass" x1="0" x2=".35" y1="0" y2="1">
        <stop offset="0" stop-color="#46535d"/><stop offset=".5" stop-color="#222b32"/><stop offset="1" stop-color="#0e1317"/>
      </linearGradient>
      <linearGradient id="ps-car-roof" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".45" stop-color="#fff" stop-opacity=".05"/>
        <stop offset="1" stop-color="#000" stop-opacity=".12"/>
      </linearGradient>
    </defs>`;
  }

  /* ---------- Cars ----------
   * Drawn from above at true size, with the front towards -y. Each body
   * style has its own outline and glasshouse. */
  const SHAPES = {
    // corner radii front (x, y) and rear, bumper bulge front and rear,
    // windshield base and top, rear window top and base, half widths of
    // the roof and of the waistline
    sedan: { rf: [6, 9], rr: [5.5, 7.5], bulge: [1.6, 1.2], ws: [-19, -7.5], rw: [15, 25.5], gw: 12.2, bw: 14.6, hood: true, pillar: true },
    hatch: { rf: [6, 9], rr: [4.5, 5.5], bulge: [1.6, 0.8], ws: [-16.5, -5.5], rw: [23, 31.5], gw: 12, bw: 14.4, hood: true, pillar: true, spoiler: true },
    suv: { rf: [5.5, 7], rr: [4, 5], bulge: [1.2, 0.8], ws: [-21, -11], rw: [30, 37], gw: 13.4, bw: 15.6, hood: true, pillar: true, rails: true, spoiler: true },
    van: { rf: [7, 10], rr: [3, 3.5], bulge: [1.8, 0.4], ws: [-34, -25], rw: [44.4, 44.4], gw: 15.2, bw: 16.8, ribs: true, cab: true },
  };

  function outline(hl, hw, sh) {
    const [fx, fy] = sh.rf;
    const [rx, ry] = sh.rr;
    const [bf, br] = sh.bulge;
    const yf = -hl + bf / 2;
    const yr = hl - br / 2;
    return (
      `M${f2(-hw + fx)} ${f2(yf)}Q0 ${f2(-hl - bf / 2)} ${f2(hw - fx)} ${f2(yf)}` +
      `C${f2(hw - fx * 0.35)} ${f2(yf)} ${f2(hw)} ${f2(-hl + fy * 0.35)} ${f2(hw)} ${f2(-hl + fy)}` +
      `L${f2(hw)} ${f2(hl - ry)}C${f2(hw)} ${f2(hl - ry * 0.35)} ${f2(hw - rx * 0.35)} ${f2(yr)} ${f2(hw - rx)} ${f2(yr)}` +
      `Q0 ${f2(hl + br / 2)} ${f2(-hw + rx)} ${f2(yr)}` +
      `C${f2(-hw + rx * 0.35)} ${f2(yr)} ${f2(-hw)} ${f2(hl - ry * 0.35)} ${f2(-hw)} ${f2(hl - ry)}` +
      `L${f2(-hw)} ${f2(-hl + fy)}C${f2(-hw)} ${f2(-hl + fy * 0.35)} ${f2(-hw + fx * 0.35)} ${f2(yf)} ${f2(-hw + fx)} ${f2(yf)}Z`
    );
  }

  function carMarkup(kindOrStyle, color, opt = {}) {
    const style = SHAPES[kindOrStyle] ? kindOrStyle : kindOrStyle === 'car' ? 'sedan' : (PS.VEHICLES[kindOrStyle] || PS.VEHICLES.car).styles[0];
    const sh = SHAPES[style];
    const { hl, hw } = PS.CAR_STYLES[style];
    const [ws0, ws1] = sh.ws;
    const [rw0, rw1] = sh.rw;
    const { gw, bw } = sh;
    const body = outline(hl, hw, sh);
    const glass = 'url(#ps-car-glass)';
    const roofFill = opt.darkRoof ? '#1e2226' : color;
    let s = `<path d="${body}" fill="${color}"/>`;
    s += `<path d="${body}" fill="url(#ps-car-x)"/><path d="${body}" fill="url(#ps-car-y)"/>`;
    // creases down the bonnet catch the light
    if (sh.hood) {
      const y0 = -hl + 4;
      const y1 = ws0 + 0.6;
      const ym = (y0 + y1) / 2;
      s += `<path d="M-6.4 ${f1(y0)}Q-7.4 ${f1(ym)} -8.8 ${f1(y1)}M6.4 ${f1(y0)}Q7.4 ${f1(ym)} 8.8 ${f1(y1)}" fill="none" stroke="#000" stroke-opacity=".16" stroke-width=".7"/>`;
      s += `<path d="M-5.4 ${f1(y0)}Q-6.4 ${f1(ym)} -7.7 ${f1(y1)}M5.4 ${f1(y0)}Q6.4 ${f1(ym)} 7.7 ${f1(y1)}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width=".6"/>`;
    }
    // windscreen, rear window and side glass
    s += `<path d="M${f1(-bw + 0.4)} ${f1(ws0 + 1.2)}Q0 ${f1(ws0 - 2)} ${f1(bw - 0.4)} ${f1(ws0 + 1.2)}L${f1(gw)} ${f1(ws1)}Q0 ${f1(ws1 - 1.3)} ${f1(-gw)} ${f1(ws1)}Z" fill="${glass}"/>`;
    s += `<path d="M${f1(-bw * 0.42)} ${f1(ws0 + 0.2)}L${f1(-bw * 0.16)} ${f1(ws0 - 0.1)}L${f1(-gw * 0.42)} ${f1(ws1 - 0.9)}L${f1(-gw * 0.7)} ${f1(ws1 - 0.6)}Z" fill="#fff" opacity=".13"/>`;
    if (rw1 > rw0) {
      s += `<path d="M${f1(-gw)} ${f1(rw0)}Q0 ${f1(rw0 + 1.3)} ${f1(gw)} ${f1(rw0)}L${f1(bw - 0.6)} ${f1(rw1 - 1)}Q0 ${f1(rw1 + 1.6)} ${f1(-bw + 0.6)} ${f1(rw1 - 1)}Z" fill="${glass}"/>`;
      s += `<path d="M${f1(gw * 0.2)} ${f1(rw0 + 0.9)}L${f1(gw * 0.5)} ${f1(rw0 + 0.8)}L${f1(bw * 0.36)} ${f1(rw1 - 0.6)}L${f1(bw * 0.06)} ${f1(rw1 - 0.4)}Z" fill="#fff" opacity=".1"/>`;
    }
    const sideEnd = sh.cab ? ws1 + 11 : rw1 - 3;
    const sideTop = sh.cab ? ws1 + 11 : rw0 - 0.6;
    for (const k of [-1, 1]) {
      s += `<path d="M${f1(k * bw)} ${f1(ws0 + 3)}L${f1(k * (gw + 0.2))} ${f1(ws1 + 0.6)}L${f1(k * (gw + 0.2))} ${f1(sideTop)}L${f1(k * (bw - 0.2))} ${f1(sideEnd)}Z" fill="${glass}"/>`;
    }
    // the roof, with a pillar between the doors
    s += `<rect x="${f1(-gw - 0.3)}" y="${f1(ws1 - 0.4)}" width="${f1(2 * gw + 0.6)}" height="${f1(rw0 - ws1 + 0.8)}" rx="3.2" fill="${roofFill}"/>`;
    s += `<rect x="${f1(-gw - 0.3)}" y="${f1(ws1 - 0.4)}" width="${f1(2 * gw + 0.6)}" height="${f1(rw0 - ws1 + 0.8)}" rx="3.2" fill="url(#ps-car-roof)"/>`;
    if (sh.pillar) {
      const py = ws1 + (rw0 - ws1) * 0.42;
      s += `<path d="M${f1(-bw)} ${f1(py)}H${f1(-gw)}M${f1(gw)} ${f1(py)}H${f1(bw)}" stroke="${color}" stroke-width="1.8"/>`;
    }
    if (opt.sunroof) {
      const len = Math.min(sh.rails ? 22 : 13, rw0 - ws1 - 6);
      s += `<rect x="${f1(-gw + 3)}" y="${f1(ws1 + 2.6)}" width="${f1(2 * gw - 6)}" height="${f1(len)}" rx="2" fill="${glass}"/>`;
      s += `<rect x="${f1(-gw + 3)}" y="${f1(ws1 + 2.6)}" width="${f1(2 * gw - 6)}" height="${f1(len)}" rx="2" fill="none" stroke="#000" stroke-opacity=".45" stroke-width=".5"/>`;
    }
    if (sh.rails) {
      for (const k of [-1, 1]) {
        const x = k * (gw - 2.4);
        s += `<rect x="${f1(x - 0.8)}" y="${f1(ws1 + 2.4)}" width="1.6" height="${f1(rw0 - ws1 - 4.8)}" rx=".8" fill="#2c3135"/>`;
        s += `<rect x="${f1(x - 0.8)}" y="${f1(ws1 + 2.4)}" width=".7" height="${f1(rw0 - ws1 - 4.8)}" rx=".35" fill="#9aa1a6"/>`;
      }
    }
    if (sh.ribs) {
      let d = '';
      let d2 = '';
      for (let y = ws1 + 9; y < rw0 - 6; y += 11) {
        d += `M${f1(-gw + 1.5)} ${f1(y)}H${f1(gw - 1.5)}`;
        d2 += `M${f1(-gw + 1.5)} ${f1(y + 1.1)}H${f1(gw - 1.5)}`;
      }
      s += `<path d="${d}" stroke="#000" stroke-opacity=".16" stroke-width=".9"/><path d="${d2}" stroke="#fff" stroke-opacity=".16" stroke-width=".7"/>`;
      s += `<rect x="-3" y="${f1(hl - 2.2)}" width="6" height="1.2" rx=".5" fill="#c4271f"/>`;
    }
    if (sh.spoiler) s += `<path d="M${f1(-gw + 1)} ${f1(rw0 + 0.4)}Q0 ${f1(rw0 + 1.7)} ${f1(gw - 1)} ${f1(rw0 + 0.4)}" fill="none" stroke="#000" stroke-opacity=".32" stroke-width=".9"/>`;
    if (!sh.ribs) s += `<path d="M-1 ${f1(rw0 - 1.4)}Q0 ${f1(rw0 - 4.4)} 1 ${f1(rw0 - 1.4)}Z" fill="#15191c"/>`;
    // wipers
    s += `<path d="M${f1(-bw + 4)} ${f1(ws0 + 1.6)}L-1.5 ${f1(ws0 + 0.5)}M2 ${f1(ws0 + 0.5)}L${f1(bw - 3.6)} ${f1(ws0 + 1.4)}" stroke="#0b0e10" stroke-width=".55" stroke-linecap="round"/>`;
    // mirrors
    const my = ws0 + (sh.cab ? 5 : 3.2);
    const ml = sh.cab ? 4.8 : 3.6;
    for (const k of [-1, 1]) {
      s += `<path d="M${f1(k * (bw - 0.4))} ${f1(my - 1.8)}L${f1(k * (hw + ml - 0.8))} ${f1(my - 1.2)}Q${f1(k * (hw + ml))} ${f1(my + 0.3)} ${f1(k * (hw + ml - 0.8))} ${f1(my + 1.7)}L${f1(k * (bw - 0.4))} ${f1(my + 2.1)}Z" fill="${color}" stroke="#000" stroke-opacity=".4" stroke-width=".5"/>`;
    }
    // lamps on the corners
    const [fx, fy] = sh.rf;
    const [rx, ry] = sh.rr;
    for (const k of [-1, 1]) {
      s += `<rect x="-1.1" y="-3.3" width="2.2" height="6.6" rx="1.1" fill="#e6edf0" stroke="#000" stroke-opacity=".35" stroke-width=".45" transform="translate(${f1(k * (hw - fx * 0.62))} ${f1(-hl + fy * 0.36)}) rotate(${-k * 58})"/>`;
      s += `<rect x="-1" y="-2.8" width="2" height="5.6" rx="1" fill="#b3241e" stroke="#000" stroke-opacity=".3" stroke-width=".4" transform="translate(${f1(k * (hw - rx * 0.62))} ${f1(hl - ry * 0.38)}) rotate(${k * 58})"/>`;
    }
    s += `<path d="${body}" fill="none" stroke="#000" stroke-opacity=".42" stroke-width=".6"/>`;
    return s;
  }
  map.carMarkup = carMarkup;

  /* A body style and options that stay the same for a car's whole visit. */
  function variant(session) {
    const h = hashStr(String(session.id || session.plate || ''));
    const styles = (PS.VEHICLES[session.kind] || PS.VEHICLES.car).styles;
    const style = styles[h % styles.length];
    return {
      style,
      sunroof: style !== 'van' && style !== 'hatch' && (h >>> 8) % 100 < 24,
      darkRoof: style === 'suv' && (h >>> 16) % 100 < 22,
    };
  }

  function makeCar(session) {
    const v = variant(session);
    const hex = (PS.CAR_COLORS[session.color] || PS.CAR_COLORS.silver).hex;
    const g = el('g', { class: 'car' });
    g.dataset.sid = session.id;
    g.innerHTML = `<use class="car-shadow" href="#ps-shadow-${v.style}"/><g class="car-body">${carMarkup(v.style, hex, v)}</g>`;
    g._shadow = g.querySelector('.car-shadow');
    g._body = g.querySelector('.car-body');
    return g;
  }

  function parkedPose(spot, s) {
    const b = PS.BAY_BY_ID[spot];
    return { x: b.cx + (s.jitter ? s.jitter.dx : 0), y: b.parkY, rot: b.noseRot + (s.jitter ? s.jitter.rot : 0) };
  }

  /* The body turns with the car; its shadow keeps falling the same way. */
  function setPose(node, p) {
    const rot = `rotate(${p.rot.toFixed(2)})`;
    node.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
    if (node._body) node._body.setAttribute('transform', rot);
    if (node._shadow) node._shadow.setAttribute('transform', `translate(${SUN[0]} ${SUN[1]}) ${rot}`);
  }

  /* ---------- Things standing above the cars ---------- */
  function poleMarkup(x, y) {
    // a 9 m pole throws a long thin shadow, with its lamp arms as a T at the end
    const len = 54;
    const ex = x + 0.611 * len;
    const ey = y + 0.791 * len;
    let s = `<path d="M${x + 1} ${y + 1.3}L${f1(ex)} ${f1(ey)}" stroke="#000" stroke-opacity=".26" stroke-width="2.2" stroke-linecap="round"/>`;
    s += `<path d="M${f1(ex - 12)} ${f1(ey)}H${f1(ex + 12)}" stroke="#000" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/>`;
    s += `<rect x="${f1(ex - 15.5)}" y="${f1(ey - 2.4)}" width="7" height="4.8" rx="2" fill="#000" opacity=".2"/><rect x="${f1(ex + 8.5)}" y="${f1(ey - 2.4)}" width="7" height="4.8" rx="2" fill="#000" opacity=".2"/>`;
    s += `<g transform="translate(${x} ${y})">
      <rect x="-12" y="-.9" width="24" height="1.8" rx=".9" fill="#3b4146"/>
      <rect x="-15.5" y="-2.5" width="7.5" height="5" rx="1.6" fill="#d9d6cd" stroke="#4a4f53" stroke-width=".6"/>
      <rect x="8" y="-2.5" width="7.5" height="5" rx="1.6" fill="#d9d6cd" stroke="#4a4f53" stroke-width=".6"/>
      <circle r="2.4" fill="#4a5055" stroke="#25292c" stroke-width=".6"/><circle cx="-.7" cy="-.7" r=".9" fill="#fff" opacity=".35"/>
    </g>`;
    return s;
  }

  function canopy() {
    const scene = PS.scene || {};
    let s = '';
    for (const [x, y] of scene.poles || []) s += poleMarkup(x, y);
    if (scene.treeMarkup) {
      try {
        s += scene.treeMarkup();
      } catch (err) {
        console.error(err);
      }
    }
    return s;
  }

  /* Barrier arms across the driveways. Raised, an arm is seen end-on from
   * above, so opening shortens it to a stub by its post. */
  function gates() {
    const y = L.gateY;
    const gate = (name, px, x0, x1) => {
      const x = Math.min(x0, x1);
      const w = Math.abs(x1 - x0);
      return `<g class="gate gate-${name}" data-gate="${name}">
        <g class="gate-arm" style="transform-origin:${px}px ${y}px">
          <rect x="${x + 1.6}" y="${y + 0.6}" width="${w}" height="3.2" rx="1.6" fill="#000" opacity=".28"/>
          <rect x="${x}" y="${y - 1.6}" width="${w}" height="3.2" rx="1.6" fill="#f4f4f1" stroke="#000" stroke-opacity=".3" stroke-width=".4"/>
          <path d="M${x + 4} ${y}H${x + w - 3}" stroke="#d2342c" stroke-width="3.2" stroke-dasharray="7 7"/>
        </g>
        <rect x="${px - 3.4}" y="${y - 3}" width="10" height="9" rx="1.5" fill="#000" opacity=".3"/>
        <rect x="${px - 5}" y="${y - 4.5}" width="10" height="9" rx="1.5" fill="#e3ad1f" stroke="#2a2f33" stroke-width=".8"/>
        <rect x="${px - 3.4}" y="${y - 3}" width="6.8" height="2" rx=".8" fill="#fff" opacity=".35"/>
      </g>`;
    };
    const epx = L.entry.x0 - 9;
    const xpx = L.exit.x1 + 9;
    return gate('entry', epx, epx + 5, L.entry.x1 - 4) + gate('exit', xpx, xpx - 5, L.exit.x0 + 4);
  }

  /* ---------- Paint for special bays (changes when bays are repainted) ---------- */
  const BOLT = 'M2.2 -9.5 L-6 1.6 H-0.6 L-2.4 9.5 L6 -1.8 H0.6 Z';
  const WHITE = 'url(#ps-paint-white) #f1f1ec';

  function wheelchair() {
    return `<g fill="none" stroke="${WHITE}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="-0.5" cy="-9.5" r="2.4" fill="${WHITE}" stroke="none"/>
      <path d="M-1.6 -5.6 V2 H5.2 L7.8 8"/><path d="M-1.6 -2 H4.2"/>
      <path d="M-4.4 -0.6 A6.4 6.4 0 1 0 4 7.2"/>
    </g>`;
  }

  /* Poles stand where four bays meet; a charger goes on a free corner. */
  const POLE_KEYS = new Set(((PS.scene && PS.scene.poles) || []).map(([x, y]) => `${x},${y}`));
  function chargerSpot(bay) {
    const right = bay.x + bay.w;
    return POLE_KEYS.has(`${right},${bay.backY}`) ? [bay.x, bay.backY] : [right, bay.backY];
  }

  function charger(x, y) {
    return `<g transform="translate(${x} ${y})">
      <circle cx="1.2" cy="1.6" r="5" fill="#000" opacity=".22"/>
      <circle r="5" fill="#c3c0b8"/><circle r="5" fill="none" stroke="#000" stroke-opacity=".18" stroke-width=".5"/>
      <rect x="-1.3" y="-1.1" width="5.6" height="4.2" rx="1" fill="#000" opacity=".3"/>
      <rect x="-2.8" y="-2.2" width="5.6" height="4.4" rx="1" fill="#eef0ee" stroke="#3d4448" stroke-width=".5"/>
      <rect x="-2.8" y="-2.2" width="5.6" height="1.3" rx=".6" fill="#22a06b"/>
      <rect x="-1.5" y="-.4" width="3" height="1.8" rx=".4" fill="#24313a"/>
    </g>`;
  }

  function typePaint() {
    let s = '';
    const posts = new Map();
    for (const bay of PS.BAYS) {
      const type = PS.store.typeOf(bay.id);
      if (type === 'standard') continue;
      const color = type === 'ev' ? `url(#ps-paint-green) ${C.ev}` : `url(#ps-paint-blue) ${C.acc}`;
      const back = bay.opensUp ? 1.6 : 1.4; // keep clear of the line at the head of the bay
      const y = bay.opensUp ? bay.y + 0.4 : bay.y + back;
      s += `<rect x="${bay.x + 2.2}" y="${y}" width="${bay.w - 4.4}" height="${bay.h - back - 0.4}" fill="${color}"/>`;
      // symbols read the right way up for a driver pulling in
      const turn = bay.opensUp ? 180 : 0;
      const toHead = bay.opensUp ? 1 : -1;
      const sy = bay.cy + toHead * 8;
      if (type === 'ev') {
        s += `<path d="${BOLT}" transform="translate(${bay.cx} ${sy}) rotate(${turn}) scale(1.7)" fill="${WHITE}"/>`;
        // the word stays upright on the map, by the aisle end of the bay
        s += `<text x="0" y="0" class="bay-word" transform="translate(${bay.cx} ${bay.opensUp ? bay.edgeY + 22 : bay.edgeY - 6}) scale(1 1.8)">EV</text>`;
        const [px, py] = chargerSpot(bay);
        posts.set(`${px},${py}`, [px, py]);
      } else {
        s += `<g transform="translate(${bay.cx} ${sy}) rotate(${turn}) scale(1.45)">${wheelchair()}</g>`;
      }
    }
    for (const [x, y] of posts.values()) s += charger(x, y);
    return s;
  }

  /* ---------- A plain ground for browsers without canvas drawing ---------- */
  function plainGround() {
    const P = L.paved;
    const W = 4200;
    let s = `<rect x="-1600" y="-1200" width="${W}" height="3400" fill="${C.lawn}"/>`;
    for (const band of [L.sidewalk, L.farWalk]) s += `<rect x="-1600" y="${band.y0}" width="${W}" height="${band.y1 - band.y0}" fill="${C.concrete}"/>`;
    s += `<rect x="-1600" y="${L.street.y0}" width="${W}" height="${L.street.y1 - L.street.y0}" fill="${C.street}"/>`;
    s += `<path d="M-1600 ${L.streetMid}H2600" stroke="${C.paint}" stroke-width="2.4" stroke-dasharray="56 72"/>`;
    for (const d of [L.entry, L.exit]) s += `<rect x="${d.x0}" y="${P.y + P.h - 30}" width="${d.x1 - d.x0}" height="${L.sidewalk.y1 - (P.y + P.h) + 34}" fill="${C.asphalt}"/>`;
    s += `<rect x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" rx="${P.r}" fill="${C.asphalt}" stroke="${C.kerb}" stroke-width="5"/>`;
    for (const b of Object.values(L.blocks)) {
      for (const ix of [b.x, b.x + b.w - L.island]) {
        s += `<rect x="${ix + 4}" y="${b.y + 4}" width="${L.island - 8}" height="${b.h - 8}" rx="${(L.island - 8) / 2}" fill="${C.mulch}" stroke="${C.kerb}" stroke-width="3.4"/>`;
      }
      let d = `M${L.bayX0} ${b.y + b.h / 2}H${L.bayX0 + L.cols * L.bayW}`;
      for (let c = 0; c <= L.cols; c++) d += `M${L.bayX0 + c * L.bayW} ${b.y + 1}V${b.y + b.h - 1}`;
      s += `<path d="${d}" stroke="${C.paint}" stroke-width="2" opacity=".9"/>`;
    }
    for (const bay of PS.BAYS) s += `<text x="${bay.cx}" y="${bay.edgeY + (bay.opensUp ? -14 : 24)}" class="bay-num">${bay.id}</text>`;
    s += `<rect x="${L.booth.x}" y="${L.booth.y}" width="${L.booth.w}" height="${L.booth.h}" fill="#c8cbcc" stroke="#8c9194"/>`;
    return s;
  }

  /* ---------- Mount ---------- */
  map.mount = function (container) {
    map.stage = container;
    const svg = el('svg', {
      viewBox: `0 0 ${L.width} ${L.height}`,
      preserveAspectRatio: 'xMidYMid meet',
      class: 'lot-svg',
      role: 'group',
      'aria-label': `Parking lot map with ${PS.BAYS.length} bays. Use the arrow keys to move between bays and Enter to open one.`,
    });
    svg.innerHTML = defs();
    try {
      PS.scene.addDefs(svg.querySelector('defs'));
    } catch (err) {
      console.error(err);
    }
    const names = ['ground', 'types', 'route', 'leds', 'cars', 'moving', 'gates', 'canopy', 'heat', 'marks', 'hit', 'measure'];
    for (const n of names) {
      const g = el('g', { class: `layer layer-${n}` });
      if (n !== 'hit') g.setAttribute('aria-hidden', 'true');
      svg.appendChild(g);
      map.layers[n] = g;
    }
    map.layers.measure.setAttribute('visibility', 'hidden');
    map.svg = svg;
    container.appendChild(svg);
    map.painted = !!(PS.scene && PS.scene.mount(container, svg));
    if (!map.painted) map.layers.ground.innerHTML = plainGround();
    map.layers.canopy.innerHTML = canopy();
    map.layers.gates.innerHTML = gates();
    map.layers.marks.innerHTML = `<rect class="target-ring" x="0" y="0" width="${L.bayW - 4}" height="${L.bayD - 4}" rx="5" visibility="hidden"/>`;
    buildBays();
    paintTypes();
    attachEvents();
    map.render();
  };

  function buildBays() {
    let leds = '';
    for (const bay of PS.BAYS) {
      const g = el('g', { class: 'bay', role: 'button', tabindex: bay.id === map.focusId ? '0' : '-1' });
      g.dataset.id = bay.id;
      g.innerHTML =
        `<rect class="bay-hit" x="${bay.x + 1}" y="${bay.y + 1}" width="${bay.w - 2}" height="${bay.h - 2}" rx="3"/>` +
        `<rect class="bay-flag" x="${bay.x + 3}" y="${bay.y + 3}" width="${bay.w - 6}" height="${bay.h - 6}" rx="3"/>` +
        `<rect class="bay-ring" x="${bay.x + 2.5}" y="${bay.y + 2.5}" width="${bay.w - 5}" height="${bay.h - 5}" rx="4"/>`;
      map.layers.hit.appendChild(g);
      map.bayEls.set(bay.id, g);
      // the sensor light sits on the aisle just outside the bay, where a parked car can't hide it
      const ly = bay.edgeY + (bay.opensUp ? -7 : 7);
      leds += `<g class="led" data-id="${bay.id}"><circle class="led-halo" cx="${bay.cx}" cy="${ly}" r="6.5"/><circle class="led-base" cx="${bay.cx}" cy="${ly}" r="3.4"/><circle class="led-core" cx="${bay.cx}" cy="${ly}" r="2.1"/></g>`;
    }
    map.layers.leds.innerHTML = leds;
    map.ledEls = new Map(U.$$('.led', map.layers.leds).map((n) => [n.dataset.id, n]));
  }

  function paintTypes() {
    map.layers.types.innerHTML = typePaint();
  }

  /* ---------- Rendering state ---------- */
  map.render = function () {
    syncCars();
    renderBays();
    if (map.heat) renderHeat();
  };

  map.repaintTypes = function () {
    paintTypes();
    renderBays();
  };

  function syncCars() {
    const st = PS.store.state;
    const want = new Map();
    for (const [spot, s] of Object.entries(st.sessions)) {
      if (!map.arriving.has(spot) && !map.moving.has(spot)) want.set(spot, s);
    }
    for (const [spot, s] of map.held) want.set(spot, s);
    for (const [spot, node] of map.carEls) {
      const w = want.get(spot);
      if (!w || node.dataset.sid !== w.id) {
        node.remove();
        map.carEls.delete(spot);
      }
    }
    for (const [spot, s] of want) {
      if (map.carEls.has(spot)) continue;
      const node = makeCar(s);
      setPose(node, parkedPose(spot, s));
      map.layers.cars.appendChild(node);
      map.carEls.set(spot, node);
    }
  }

  function renderBays() {
    const st = PS.store.state;
    const now = Date.now();
    for (const bay of PS.BAYS) {
      const g = map.bayEls.get(bay.id);
      const s = st.sessions[bay.id];
      const shown = s || map.held.get(bay.id);
      const type = st.bayTypes[bay.id];
      const late = !!s && PS.store.isOverstay(s, now);
      const cls = ['bay', `t-${type}`, shown ? 'is-busy' : 'is-free'];
      if (late) cls.push('is-late');
      if (map.selected === bay.id) cls.push('is-selected');
      if (map.target === bay.id) cls.push('is-target');
      if (map.moveSource === bay.id) cls.push('is-source');
      if (g.classList.contains('is-pulse')) cls.push('is-pulse');
      g.setAttribute('class', cls.join(' '));
      let label = `${bay.id}, ${U.lower(PS.BAY_TYPES[type].bay)}, `;
      if (s) label += `${s.plate}, parked ${U.durationLong(now - s.entered)}${late ? ', over the time limit' : ''}`;
      else label += 'free';
      g.setAttribute('aria-label', label);
      if (map.selected === bay.id) g.setAttribute('aria-current', 'true');
      else g.removeAttribute('aria-current');
      const led = map.ledEls.get(bay.id);
      led.setAttribute('class', `led ${late ? 'led-late' : shown ? 'led-busy' : 'led-free'}`);
    }
  }
  map.renderBays = renderBays;

  /* Sequential heat scale: pale concrete for quiet bays, line-paint yellow, brake-light red for the busiest. */
  const HEAT_STOPS = [[0, [213, 225, 234]], [0.5, [244, 198, 61]], [1, [232, 100, 63]]];
  function heatColor(t) {
    for (let i = 1; i < HEAT_STOPS.length; i++) {
      const [t1, c1] = HEAT_STOPS[i];
      if (t <= t1 || i === HEAT_STOPS.length - 1) {
        const [t0, c0] = HEAT_STOPS[i - 1];
        const u = U.clamp((t - t0) / (t1 - t0), 0, 1);
        return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * u)).join(' ')})`;
      }
    }
    return 'rgb(213 225 234)';
  }

  function renderHeat() {
    const util = PS.stats.utilization();
    let s = '';
    for (const bay of PS.BAYS) {
      const share = util[bay.id].share;
      s += `<rect x="${bay.x + 2}" y="${bay.y + 2}" width="${bay.w - 4}" height="${bay.h - 4}" rx="3" fill="${heatColor(share)}" opacity=".95"/>`;
      s += `<text x="${bay.cx}" y="${bay.cy + 5}" class="heat-label">${Math.round(share * 100)}%</text>`;
    }
    map.layers.heat.innerHTML = s;
    map.heatData = util;
  }

  /* ---------- Modes ---------- */
  map.setFilter = function (f) {
    map.filter = f;
    map.svg.dataset.filter = f;
  };

  map.setMode = function (mode, source) {
    map.mode = mode;
    map.moveSource = mode === 'move' ? source : null;
    map.svg.classList.toggle('is-edit', mode === 'edit');
    map.svg.classList.toggle('is-move', mode === 'move');
    renderBays();
  };

  map.setHeat = function (on) {
    map.heat = on;
    map.svg.classList.toggle('is-heat', on);
    if (on) renderHeat();
    else {
      map.layers.heat.innerHTML = '';
      map.heatData = null;
    }
  };

  map.select = function (id) {
    map.selected = id;
    if (id) setFocusBay(id, false);
    renderBays();
  };

  map.pulse = function (id) {
    const g = map.bayEls.get(id);
    if (!g) return;
    g.classList.remove('is-pulse');
    void g.getBBox();
    g.classList.add('is-pulse');
    clearTimeout(g._pulse);
    g._pulse = setTimeout(() => g.classList.remove('is-pulse'), 2400);
  };

  /* On small screens, scroll so a bay is in view: sideways inside the map,
   * and up the page so it sits above the bottom sheet. */
  map.reveal = function (id) {
    const g = map.bayEls.get(id);
    if (!g) return;
    const behavior = U.reducedMotion() ? 'auto' : 'smooth';
    const scroller = map.stage && map.stage.closest('.map-scroll');
    if (scroller && scroller.scrollWidth > scroller.clientWidth + 2) {
      const r = g.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      scroller.scrollTo({ left: scroller.scrollLeft + (r.left - sr.left) - sr.width / 2 + r.width / 2, behavior });
    }
    const main = document.getElementById('main');
    const sheet = document.getElementById('panel');
    if (!main || !sheet || sheet.hidden || getComputedStyle(sheet).position !== 'fixed') return;
    const r = g.getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    const sheetTop = window.innerHeight - sheet.offsetHeight - (window.innerHeight - mr.bottom);
    let dy = 0;
    if (r.bottom > sheetTop - 12) dy = r.bottom - (sheetTop - 12);
    else if (r.top < mr.top + 8) dy = r.top - (mr.top + 8);
    if (dy) main.scrollBy({ top: dy, behavior });
  };

  map.bayRect = (id) => {
    const g = map.bayEls.get(id);
    return g ? g.querySelector('.bay-hit').getBoundingClientRect() : null;
  };

  /* ---------- Route guidance ---------- */
  map.showRoute = function (spot) {
    map.target = spot || null;
    const layer = map.layers.route;
    const ring = map.layers.marks.querySelector('.target-ring');
    if (!spot) {
      layer.innerHTML = '';
      ring.setAttribute('visibility', 'hidden');
      renderBays();
      return;
    }
    const r = R.route({ entry: true }, { bay: spot });
    if (!r) return;
    // Start the guidance line at the barrier instead of out on the street.
    const start = [L.xL + L.laneOffset, L.gateY + 22];
    const pts = [start, ...r.forward.filter((p) => p[1] < L.gateY)];
    const d = R.roundedPath(pts);
    layer.innerHTML = `<path class="route-casing" d="${d}"/><path class="route-line" d="${d}"/>
      <circle class="route-start" cx="${start[0]}" cy="${start[1]}" r="6"/>`;
    const b = PS.BAY_BY_ID[spot];
    ring.setAttribute('x', b.x + 2);
    ring.setAttribute('y', b.y + 2);
    ring.setAttribute('visibility', 'visible');
    renderBays();
  };

  /* ---------- Driving ---------- */
  function streetBounds() {
    const r = map.svg.getBoundingClientRect();
    if (!r.width || !r.height) return {};
    const scale = Math.min(r.width / L.width, r.height / L.height);
    const visW = r.width / scale;
    const x0 = (L.width - visW) / 2;
    return { streetStart: Math.min(-80, x0 - 60), streetEnd: Math.max(L.width + 80, L.width - x0 + 60) };
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const gateUsers = { entry: new Set(), exit: new Set() };
  const GATE_LANES = { entry: L.xL + L.laneOffset, exit: L.xR - L.laneOffset };
  function setGate(name, open) {
    const g = map.layers.gates.querySelector(`[data-gate="${name}"]`);
    if (g) g.classList.toggle('is-open', open);
  }
  function trackGates(id, pt) {
    for (const [name, gx] of Object.entries(GATE_LANES)) {
      const near = Math.hypot(pt.x - gx, pt.y - L.gateY) < 120;
      const users = gateUsers[name];
      if (near && !users.has(id)) {
        users.add(id);
        setGate(name, true);
      } else if (!near && users.has(id)) {
        users.delete(id);
        setTimeout(() => !gateUsers[name].size && setGate(name, false), 380);
      }
    }
  }

  let animSeq = 0;
  function drive(node, legs) {
    const id = ++animSeq;
    const parts = legs
      .filter((l) => l.pts && l.pts.length > 1)
      .map((l) => {
        const p = el('path', { d: R.roundedPath(l.pts) });
        map.layers.measure.appendChild(p);
        return { p, len: p.getTotalLength(), reverse: !!l.reverse };
      })
      .filter((x) => x.len > 0.5);
    const cleanup = () => {
      parts.forEach((x) => x.p.remove());
      trackGates(id, { x: -9999, y: -9999 });
    };
    if (!node || U.reducedMotion() || document.hidden || !parts.length) {
      cleanup();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let i = 0;
      let t0 = 0;
      const run = (now) => {
        const part = parts[i];
        if (!t0) t0 = now;
        const speed = part.reverse ? REVERSE_SPEED : SPEED;
        const dur = U.clamp((part.len / speed) * 1000, part.reverse ? 650 : 800, 5200);
        const t = Math.min(1, (now - t0) / dur);
        const s = ease(t) * part.len;
        const pt = part.p.getPointAtLength(s);
        const a = part.p.getPointAtLength(Math.max(0, s - 0.6));
        const b = part.p.getPointAtLength(Math.min(part.len, s + 0.6));
        let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
        if (part.reverse) ang += 180;
        setPose(node, { x: pt.x, y: pt.y, rot: ang });
        trackGates(id, pt);
        if (t < 1) return requestAnimationFrame(run);
        i += 1;
        t0 = 0;
        if (i < parts.length) return setTimeout(() => requestAnimationFrame(run), 140);
        cleanup();
        resolve();
      };
      requestAnimationFrame(run);
    });
  }

  function park(spot, node, sessionId) {
    const s = PS.store.session(spot);
    if (s && s.id === sessionId && !map.carEls.has(spot)) {
      setPose(node, parkedPose(spot, s));
      map.layers.cars.appendChild(node);
      map.carEls.set(spot, node);
    } else {
      node.remove();
    }
  }

  function detach(spot) {
    let node = map.carEls.get(spot);
    if (!node) {
      const s = PS.store.session(spot) || map.held.get(spot);
      if (!s) return null;
      node = makeCar(s);
      setPose(node, parkedPose(spot, s));
    }
    map.carEls.delete(spot);
    map.layers.moving.appendChild(node);
    return node;
  }

  /* Check a car in and drive it from the street into its bay. */
  map.checkIn = function (data) {
    map.arriving.add(data.spot);
    let session;
    try {
      session = PS.store.checkIn(data);
    } catch (err) {
      map.arriving.delete(data.spot);
      throw err;
    }
    const node = makeCar(session);
    map.layers.moving.appendChild(node);
    map.busy.add(data.spot);
    const r = R.route({ entry: true }, { bay: data.spot }, streetBounds());
    const end = parkedPose(data.spot, session);
    if (r) r.forward[r.forward.length - 1] = [end.x, end.y];
    setPose(node, r ? { x: r.forward[0][0], y: r.forward[0][1], rot: 90 } : end);
    drive(node, r ? [{ pts: r.forward }] : []).then(() => {
      map.arriving.delete(data.spot);
      map.busy.delete(data.spot);
      park(data.spot, node, session.id);
      map.render();
    });
    return session;
  };

  function driveAway(spot, node) {
    map.busy.add(spot);
    const r = R.route({ bay: spot }, { exit: true }, streetBounds());
    return drive(node, r ? [{ pts: r.reverse, reverse: true }, { pts: r.forward }] : []).then(() => {
      node.remove();
      map.busy.delete(spot);
    });
  }

  /* Check a car out. With `hold`, the car stays in its bay until release(). */
  map.checkOut = function (spot, opts, { hold = false } = {}) {
    const session = PS.store.session(spot);
    if (!session) return PS.store.checkOut(spot, opts); // throws a helpful error
    if (hold) {
      map.held.set(spot, session);
      try {
        return PS.store.checkOut(spot, opts);
      } catch (err) {
        map.held.delete(spot);
        throw err;
      }
    }
    const node = detach(spot);
    const record = PS.store.checkOut(spot, opts);
    if (node) driveAway(spot, node);
    return record;
  };

  map.release = function (spot) {
    if (!map.held.has(spot)) return;
    const node = detach(spot);
    map.held.delete(spot);
    renderBays();
    if (node) driveAway(spot, node);
  };

  /* Move a parked car to another free bay. */
  map.move = function (from, to) {
    const node = detach(from);
    map.moving.add(to);
    let session;
    try {
      session = PS.store.move(from, to);
    } catch (err) {
      map.moving.delete(to);
      if (node) node.remove();
      syncCars();
      throw err;
    }
    map.busy.add(from);
    map.busy.add(to);
    const r = R.route({ bay: from }, { bay: to }, streetBounds());
    if (r) {
      const end = parkedPose(to, session);
      r.forward[r.forward.length - 1] = [end.x, end.y];
    }
    drive(node, r ? [{ pts: r.reverse, reverse: true }, { pts: r.forward }] : []).then(() => {
      map.moving.delete(to);
      map.busy.delete(from);
      map.busy.delete(to);
      if (node) park(to, node, session.id);
      map.render();
    });
    return session;
  };

  /* ---------- Interaction ---------- */
  function setFocusBay(id, focus = true) {
    const prev = map.bayEls.get(map.focusId);
    if (prev) prev.setAttribute('tabindex', '-1');
    map.focusId = id;
    const g = map.bayEls.get(id);
    if (!g) return;
    g.setAttribute('tabindex', '0');
    if (focus) g.focus({ preventScroll: true });
  }
  map.focusBay = (id) => {
    setFocusBay(id, true);
    map.reveal(id);
  };

  function neighbour(id, key) {
    const b = PS.BAY_BY_ID[id];
    let { row, col } = b;
    if (key === 'ArrowLeft') col = Math.max(0, col - 1);
    if (key === 'ArrowRight') col = Math.min(L.cols - 1, col + 1);
    if (key === 'ArrowUp') row = Math.max(0, row - 1);
    if (key === 'ArrowDown') row = Math.min(PS.BAY_GRID.length - 1, row + 1);
    if (key === 'Home') col = 0;
    if (key === 'End') col = L.cols - 1;
    return PS.BAY_GRID[row][col].id;
  }

  function attachEvents() {
    const hit = map.layers.hit;
    hit.addEventListener('click', (e) => {
      const g = e.target.closest('.bay');
      if (!g) return;
      setFocusBay(g.dataset.id, false);
      map.onActivate(g.dataset.id);
    });
    hit.addEventListener('keydown', (e) => {
      const g = e.target.closest('.bay');
      if (!g) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        map.focusBay(neighbour(g.dataset.id, e.key));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        map.onActivate(g.dataset.id);
      }
    });
    hit.addEventListener('pointerover', (e) => {
      const g = e.target.closest('.bay');
      if (g && e.pointerType !== 'touch') map.onHover(g.dataset.id);
    });
    hit.addEventListener('pointerout', (e) => {
      if (!e.relatedTarget || !hit.contains(e.relatedTarget)) map.onHover(null);
    });
  }
})();
