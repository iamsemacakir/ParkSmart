/* ParkSmart — lot map
 * Draws the lot as one SVG: landscaping, roads, painted bays, sensor
 * lights, cars and trees. Cars drive in from the street, back out of
 * bays and leave through the exit gate along real routes.
 */
(function () {
  'use strict';
  const PS = window.PS;
  const U = PS.util;
  const L = PS.LOT;
  const R = PS.routing;
  const NS = 'http://www.w3.org/2000/svg';

  const C = {
    grass: '#4E6C50',
    hedge: '#3C5B3F',
    road: '#353A3F',
    block: '#454A50',
    street: '#2F3438',
    curb: '#8E969C',
    sidewalk: '#A3A9AC',
    yellow: '#F2C230',
    paint: '#EEF1EC',
    ev: '#1C9A6B',
    acc: '#2560C6',
  };
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

  function grainURL() {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(128, 128);
      const rnd = U.seeded(11);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = rnd();
        const shade = v > 0.5 ? 255 : 0;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = shade;
        img.data[i + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 30);
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    } catch (e) {
      return '';
    }
  }

  function defs() {
    const grain = grainURL();
    return `
    <defs>
      ${grain ? `<pattern id="ps-grain" patternUnits="userSpaceOnUse" width="128" height="128"><image href="${grain}" width="128" height="128"/></pattern>` : ''}
      <linearGradient id="ps-carShade" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity=".34"/><stop offset=".22" stop-color="#000" stop-opacity=".05"/>
        <stop offset=".5" stop-color="#fff" stop-opacity=".16"/><stop offset=".78" stop-color="#000" stop-opacity=".05"/>
        <stop offset="1" stop-color="#000" stop-opacity=".34"/>
      </linearGradient>
      <linearGradient id="ps-glass" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#3a4b59"/><stop offset="1" stop-color="#141c23"/>
      </linearGradient>
      <linearGradient id="ps-roofShine" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="ps-canopy" cx=".38" cy=".34" r=".75">
        <stop offset="0" stop-color="#7FA463"/><stop offset=".55" stop-color="#557F45"/><stop offset="1" stop-color="#2F5229"/>
      </radialGradient>
      <radialGradient id="ps-canopyDark" cx=".4" cy=".36" r=".8">
        <stop offset="0" stop-color="#6A9455"/><stop offset=".6" stop-color="#456F3A"/><stop offset="1" stop-color="#284824"/>
      </radialGradient>
      <filter id="ps-carShadow" x="-40%" y="-25%" width="180%" height="150%">
        <feDropShadow dx="1.6" dy="2.6" stdDeviation="1.6" flood-color="#000" flood-opacity=".55"/>
      </filter>
      <pattern id="ps-slabs" patternUnits="userSpaceOnUse" width="36" height="40">
        <rect width="36" height="40" fill="${C.sidewalk}"/><path d="M0 0V40" stroke="#80878B" stroke-width="1"/>
      </pattern>
    </defs>`;
  }

  /* ---------- Static scene ---------- */
  function ground() {
    const P = L.paved;
    let s = `<rect x="-1600" y="-1200" width="4100" height="3100" fill="${C.grass}"/>`;
    // street and far sidewalk
    s += `<rect x="-1600" y="${L.street.y0}" width="4100" height="${L.street.y1 - L.street.y0}" fill="${C.street}"/>`;
    s += `<rect x="-1600" y="${L.street.y1}" width="4100" height="44" fill="url(#ps-slabs)"/>`;
    s += `<path d="M-1600 ${L.street.y1 + 0.5}H2500" stroke="#C9CDCF" stroke-width="2"/>`;
    // paved road loop with curb
    s += `<rect x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" rx="26" fill="${C.road}" stroke="${C.curb}" stroke-width="2.5"/>`;
    // driveways down to the street, with rounded curb returns
    const y0 = L.street.y0;
    const rr = 14;
    for (const x of [P.x, L.xR - 32]) {
      const x1 = x + 64;
      s += `<rect x="${x}" y="${P.y + P.h - 30}" width="64" height="${y0 - (P.y + P.h) + 34}" fill="${C.road}"/>`;
      s += `<path d="M${x - rr} ${y0 + 1} L${x} ${y0 + 1} L${x} ${y0 - rr} A${rr} ${rr} 0 0 1 ${x - rr} ${y0 + 1} Z" fill="${C.road}"/>`;
      s += `<path d="M${x1 + rr} ${y0 + 1} L${x1} ${y0 + 1} L${x1} ${y0 - rr} A${rr} ${rr} 0 0 0 ${x1 + rr} ${y0 + 1} Z" fill="${C.road}"/>`;
      s += `<path d="M${x} ${P.y + P.h + 1}V${y0 - rr} A${rr} ${rr} 0 0 1 ${x - rr} ${y0} M${x1} ${P.y + P.h + 1}V${y0 - rr} A${rr} ${rr} 0 0 0 ${x1 + rr} ${y0}" fill="none" stroke="${C.curb}" stroke-width="2.5"/>`;
    }
    // hedge along the street between the driveways
    const hx = L.booth.x + L.booth.w + 18;
    s += `<rect x="${hx}" y="574" width="${L.xR - 32 - hx - 34}" height="17" rx="8.5" fill="${C.hedge}"/>`;
    // parking blocks and their planted end islands
    for (const b of Object.values(L.blocks)) {
      s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${C.block}"/>`;
      for (const ix of [b.x + 5, b.x + b.w - 41]) {
        s += `<rect x="${ix}" y="${b.y + 7}" width="36" height="${b.h - 14}" rx="15" fill="${C.grass}" stroke="${C.curb}" stroke-width="2.5"/>`;
      }
    }
    // texture over everything
    s += `<rect x="-1600" y="-1200" width="4100" height="3100" fill="url(#ps-grain)" pointer-events="none"/>`;
    return s;
  }

  function staticPaint() {
    let s = '';
    const dash = `stroke="${C.paint}" stroke-width="2" stroke-dasharray="14 12" stroke-opacity=".78"`;
    const bx0 = L.blocks.A.x + 10;
    const bx1 = L.blocks.A.x + L.blocks.A.w - 10;
    for (const y of [L.yT, L.yM, L.yB]) s += `<path d="M${bx0} ${y}H${bx1}" ${dash}/>`;
    for (const x of [L.xL, L.xR]) {
      for (const b of Object.values(L.blocks)) s += `<path d="M${x} ${b.y + 10}V${b.y + b.h - 10}" ${dash}/>`;
    }
    // street centre line and edge lines
    s += `<path d="M-1600 ${L.streetMid}H2500" stroke="${C.paint}" stroke-width="2" stroke-dasharray="22 18" stroke-opacity=".8"/>`;
    s += `<path d="M-1600 ${L.street.y0 + 4}H2500 M-1600 ${L.street.y1 - 4}H2500" stroke="${C.paint}" stroke-width="1.4" stroke-opacity=".45"/>`;
    // driveway arrows and words
    const arrow = (x, y, up) => {
      const d = up ? -1 : 1;
      return `<path d="M${x} ${y - d * 10}V${y + d * 8} M${x - 6} ${y + d * 2}L${x} ${y + d * 9}L${x + 6} ${y + d * 2}" fill="none" stroke="${C.paint}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`;
    };
    s += arrow(L.xL + 14, 586, true) + arrow(L.xR - 14, 586, false);
    s += `<text x="${L.xL - 13}" y="590" class="lot-word">IN</text><text x="${L.xR + 13}" y="590" class="lot-word">OUT</text>`;
    // bay lines: dividers, centre line and end ticks, as in the original artwork
    for (const b of Object.values(L.blocks)) {
      const top = b.y + 3;
      const bot = b.y + b.h - 3;
      const mid = b.y + b.h / 2;
      let d = `M${L.bayX0} ${mid}H${L.bayX0 + L.cols * L.bayW}`;
      for (let c = 0; c <= L.cols; c++) {
        const x = L.bayX0 + c * L.bayW;
        d += ` M${x} ${top}V${bot} M${x - 5} ${top}H${x + 5} M${x - 5} ${bot}H${x + 5}`;
      }
      s += `<path d="${d}" stroke="${C.yellow}" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".95"/>`;
    }
    return s;
  }

  function tree(x, y, r, rnd, dark) {
    const fill = dark ? 'url(#ps-canopyDark)' : 'url(#ps-canopy)';
    let s = `<circle cx="${f1(x + r * 0.28)}" cy="${f1(y + r * 0.36)}" r="${f1(r * 1.02)}" fill="#000" opacity=".26"/>`;
    s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${fill}"/>`;
    const lobes = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + rnd();
      const d = r * (0.45 + rnd() * 0.2);
      s += `<circle cx="${f1(x + Math.cos(a) * d)}" cy="${f1(y + Math.sin(a) * d)}" r="${f1(r * (0.42 + rnd() * 0.16))}" fill="${fill}" opacity=".9"/>`;
    }
    s += `<circle cx="${f1(x - r * 0.25)}" cy="${f1(y - r * 0.28)}" r="${f1(r * 0.32)}" fill="#A8C98A" opacity=".22"/>`;
    return s;
  }

  function canopy() {
    const rnd = U.seeded(42);
    let s = '';
    // light poles on the centre line of each block
    for (const b of Object.values(L.blocks)) {
      const y = b.y + b.h / 2;
      for (const c of [3, 10]) {
        const x = L.bayX0 + c * L.bayW;
        s += `<path d="M${x - 8} ${y + 4}H${x + 14}" stroke="#000" stroke-opacity=".28" stroke-width="3" stroke-linecap="round"/>`;
        s += `<path d="M${x - 11} ${y}H${x + 11}" stroke="#2A2F33" stroke-width="2.2" stroke-linecap="round"/>`;
        s += `<rect x="${x - 15}" y="${y - 2.2}" width="7" height="4.4" rx="1.4" fill="#E9E3C9"/><rect x="${x + 8}" y="${y - 2.2}" width="7" height="4.4" rx="1.4" fill="#E9E3C9"/>`;
        s += `<circle cx="${x}" cy="${y}" r="3.4" fill="#2A2F33"/>`;
      }
    }
    // trees on the islands
    for (const b of Object.values(L.blocks)) {
      for (const ix of [b.x + 23, b.x + b.w - 23]) {
        s += tree(ix, b.y + 46, 15, rnd);
        s += tree(ix, b.y + b.h - 46, 14, rnd, true);
      }
    }
    // perimeter planting
    for (let x = 30; x < 880; x += 62 + rnd() * 22) s += tree(x, 10 + rnd() * 8, 15 + rnd() * 5, rnd, rnd() > 0.5);
    for (let y = 70; y < 560; y += 70 + rnd() * 20) {
      s += tree(12 + rnd() * 8, y, 14 + rnd() * 4, rnd, rnd() > 0.5);
      s += tree(886 + rnd() * 8, y + 20, 14 + rnd() * 4, rnd, rnd() > 0.5);
    }
    for (let x = 190; x < 740; x += 92 + rnd() * 20) s += tree(x, 583, 12 + rnd() * 3, rnd, true);
    // planting beyond the frame, seen on wide screens
    for (let i = 0; i < 70; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side < 0 ? -40 - rnd() * 600 : L.width + 40 + rnd() * 600;
      const y = -60 + rnd() * 660;
      s += tree(x, y, 14 + rnd() * 10, rnd, rnd() > 0.5);
    }
    for (let x = -600; x < L.width + 600; x += 70 + rnd() * 40) s += tree(x, 724 + rnd() * 18, 16 + rnd() * 8, rnd, rnd() > 0.5);

    // attendant booth and P sign by the entry
    const B = L.booth;
    s += `<rect x="${B.x + 3}" y="${B.y + 4}" width="${B.w}" height="${B.h}" rx="3" fill="#000" opacity=".3"/>`;
    s += `<rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" rx="3" fill="#C9CFD3" stroke="#8E979D" stroke-width="1"/>`;
    s += `<rect x="${B.x + 3}" y="${B.y + 3}" width="${B.w - 6}" height="${B.h - 6}" rx="1.5" fill="#E4E8EA"/>`;
    s += `<rect x="${B.x + 3}" y="${B.y + 3}" width="${B.w - 6}" height="4" rx="1" fill="#6FA9D6" opacity=".85"/>`;
    s += `<g transform="translate(${L.paved.x - 27} 571)"><rect x="1.5" y="2" width="15" height="15" rx="2.5" fill="#000" opacity=".3"/><rect width="15" height="15" rx="2.5" fill="#1B5FC1" stroke="#fff" stroke-width="1.2"/><text x="7.5" y="11.6" class="lot-sign">P</text></g>`;
    // pay terminal by the exit
    s += `<rect x="${L.xR - 52}" y="574" width="12" height="16" rx="2" fill="#2A2F33" stroke="#11161A" stroke-width="1"/><rect x="${L.xR - 50}" y="577" width="8" height="5" rx="1" fill="#57B6F2"/>`;
    return s;
  }

  function gates() {
    const arm = (x0, x1) => {
      const x = Math.min(x0, x1);
      const w = Math.abs(x1 - x0);
      return `<rect x="${x}" y="${L.gateY - 1.8}" width="${w}" height="3.6" rx="1.8" fill="#F4F4F2"/>
        <path d="M${x + 3} ${L.gateY}H${x + w - 3}" stroke="#D2342C" stroke-width="3.6" stroke-dasharray="6 6"/>`;
    };
    const px0 = L.paved.x + 5;
    const px1 = L.xR + 27;
    return `
      <g class="gate gate-entry" data-gate="entry">
        <g class="gate-arm" style="transform-origin:${px0}px ${L.gateY}px">${arm(px0, L.xL + 30)}</g>
        <circle cx="${px0}" cy="${L.gateY}" r="4.2" fill="#2A2F33" stroke="#F2C230" stroke-width="1.4"/>
      </g>
      <g class="gate gate-exit" data-gate="exit">
        <g class="gate-arm" style="transform-origin:${px1}px ${L.gateY}px">${arm(L.xR - 30, px1)}</g>
        <circle cx="${px1}" cy="${L.gateY}" r="4.2" fill="#2A2F33" stroke="#F2C230" stroke-width="1.4"/>
      </g>`;
  }

  /* ---------- Bay type paint (changes when bays are repainted) ---------- */
  const BOLT = 'M2.2 -9.5 L-6 1.6 H-0.6 L-2.4 9.5 L6 -1.8 H0.6 Z';
  function wheelchair(x, y) {
    return `<g transform="translate(${x} ${y})" fill="none" stroke="${C.paint}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".9">
      <circle cx="-0.5" cy="-9.5" r="2.3" fill="${C.paint}" stroke="none"/>
      <path d="M-1.6 -5.6 V2 H5.2 L7.8 8"/><path d="M-1.6 -2 H4.2"/>
      <path d="M-4.4 -0.6 A6.4 6.4 0 1 0 4 7.2"/>
    </g>`;
  }

  function typePaint() {
    let s = '';
    for (const bay of PS.BAYS) {
      const type = PS.store.typeOf(bay.id);
      const labelY = bay.opensUp ? bay.y + 14 : bay.y + bay.h - 6;
      const symY = bay.cy + (bay.opensUp ? 6 : -6);
      if (type === 'ev') {
        s += `<rect x="${bay.x + 3.5}" y="${bay.y + 3.5}" width="${bay.w - 7}" height="${bay.h - 7}" rx="2" fill="${C.ev}" opacity=".5"/>`;
        s += `<path d="${BOLT}" transform="translate(${bay.cx} ${symY}) scale(1.25)" fill="${C.paint}" opacity=".9"/>`;
        // charge post at the head of the bay
        const py = bay.opensUp ? bay.backY - 6 : bay.backY + 6;
        s += `<rect x="${bay.cx + 13}" y="${py - 3}" width="6" height="6" rx="1.2" fill="#E8ECEE" stroke="#1C9A6B" stroke-width="1.4"/>`;
      } else if (type === 'accessible') {
        s += `<rect x="${bay.x + 3.5}" y="${bay.y + 3.5}" width="${bay.w - 7}" height="${bay.h - 7}" rx="2" fill="${C.acc}" opacity=".55"/>`;
        s += wheelchair(bay.cx, symY);
      }
      s += `<text x="${bay.cx}" y="${labelY}" class="bay-label${type === 'standard' ? '' : ' bay-label-light'}">${bay.id}</text>`;
    }
    return s;
  }

  /* ---------- Cars ---------- */
  function carMarkup(kind, c) {
    const v = PS.VEHICLES[kind] || PS.VEHICLES.car;
    const { hl, hw } = v;
    const W = hw * 2;
    const H = hl * 2;
    const mirror = (y, w, h) =>
      `<rect x="${-hw - w + 0.6}" y="${y}" width="${w}" height="${h}" rx="1.1" fill="${c}" stroke="#000" stroke-opacity=".35" stroke-width=".5"/>` +
      `<rect x="${hw - 0.6}" y="${y}" width="${w}" height="${h}" rx="1.1" fill="${c}" stroke="#000" stroke-opacity=".35" stroke-width=".5"/>`;
    const body = (rx, ry) =>
      `<rect x="${-hw}" y="${-hl}" width="${W}" height="${H}" rx="${rx}" ry="${ry}" fill="${c}"/>` +
      `<rect x="${-hw}" y="${-hl}" width="${W}" height="${H}" rx="${rx}" ry="${ry}" fill="url(#ps-carShade)"/>`;
    const outline = (rx, ry) =>
      `<rect x="${-hw}" y="${-hl}" width="${W}" height="${H}" rx="${rx}" ry="${ry}" fill="none" stroke="#000" stroke-opacity=".38" stroke-width=".7"/>`;
    const lights = (w, tw) =>
      `<rect x="${-hw + 2}" y="${-hl + 0.6}" width="${w}" height="2.1" rx="1" fill="#FFF4CF"/><rect x="${hw - 2 - w}" y="${-hl + 0.6}" width="${w}" height="2.1" rx="1" fill="#FFF4CF"/>` +
      `<rect x="${-hw + 1.6}" y="${hl - 2.5}" width="${tw}" height="1.9" rx=".9" fill="#D2342C"/><rect x="${hw - 1.6 - tw}" y="${hl - 2.5}" width="${tw}" height="1.9" rx=".9" fill="#D2342C"/>`;

    let s = '';
    if (kind === 'suv') {
      s += body(6, 8);
      s += `<path d="M-12 -14.5 Q0 -17.5 12 -14.5 L11 -7 Q0 -8.2 -11 -7 Z" fill="url(#ps-glass)"/>`;
      s += `<path d="M-12.8 -12.5 L-11.2 -6.6 L-11.2 21 L-12.8 23.5 Z M12.8 -12.5 L11.2 -6.6 L11.2 21 L12.8 23.5 Z" fill="url(#ps-glass)" opacity=".9"/>`;
      s += `<rect x="-11" y="-7.4" width="22" height="28.4" rx="2.5" fill="${c}"/><rect x="-11" y="-7.4" width="22" height="28.4" rx="2.5" fill="url(#ps-roofShine)"/>`;
      s += `<path d="M-8.6 -5 L-8.6 18.5 M8.6 -5 L8.6 18.5" stroke="#1d2327" stroke-opacity=".55" stroke-width="1.1" stroke-linecap="round"/>`;
      s += `<path d="M-11 21 L11 21 L11.6 25.4 Q0 26.8 -11.6 25.4 Z" fill="url(#ps-glass)"/>`;
      s += mirror(-12, 3.4, 2.6) + lights(6, 4) + outline(6, 8);
    } else if (kind === 'van') {
      s += body(5, 6);
      s += `<path d="M-12.4 -24.5 Q0 -27.5 12.4 -24.5 L11.8 -18.4 Q0 -19.6 -11.8 -18.4 Z" fill="url(#ps-glass)"/>`;
      s += `<path d="M-13.2 -22 L-12.2 -18 L-12.2 -6 L-13.2 -5 Z M13.2 -22 L12.2 -18 L12.2 -6 L13.2 -5 Z" fill="url(#ps-glass)" opacity=".9"/>`;
      s += `<rect x="-12" y="-18.6" width="24" height="48.4" rx="2" fill="${c}"/><rect x="-12" y="-18.6" width="24" height="48.4" rx="2" fill="url(#ps-roofShine)"/>`;
      s += `<path d="M-12 -6 L12 -6 M-12 6 L12 6 M-12 18 L12 18" stroke="#000" stroke-opacity=".16" stroke-width=".8"/>`;
      s += mirror(-21, 3.4, 2.8) + lights(6, 3) + outline(5, 6);
    } else {
      s += body(8.5, 11);
      s += `<path d="M-6 -26 Q0 -27.2 6 -26" stroke="#000" stroke-opacity=".18" fill="none" stroke-width=".8"/>`;
      s += `<path d="M-11 -12.5 Q0 -16 11 -12.5 L9.6 -4 Q0 -5.4 -9.6 -4 Z" fill="url(#ps-glass)"/>`;
      s += `<path d="M-11.6 -10.5 L-10 -3.6 L-10 11.5 L-11.6 16.5 Z M11.6 -10.5 L10 -3.6 L10 11.5 L11.6 16.5 Z" fill="url(#ps-glass)" opacity=".9"/>`;
      s += `<rect x="-9.6" y="-4.4" width="19.2" height="16.6" rx="3" fill="${c}"/><rect x="-9.6" y="-4.4" width="19.2" height="16.6" rx="3" fill="url(#ps-roofShine)"/>`;
      s += `<path d="M-9.6 12.2 Q0 13.4 9.6 12.2 L10.8 18.6 Q0 21 -10.8 18.6 Z" fill="url(#ps-glass)"/>`;
      s += mirror(-10, 3.2, 2.4) + lights(5.5, 5) + outline(8.5, 11);
    }
    return `<g filter="url(#ps-carShadow)">${s}</g>`;
  }
  map.carMarkup = carMarkup;

  function makeCar(session) {
    const g = el('g', { class: 'car' });
    g.dataset.sid = session.id;
    g.innerHTML = carMarkup(session.kind, (PS.CAR_COLORS[session.color] || PS.CAR_COLORS.silver).hex);
    return g;
  }

  function parkedPose(spot, s) {
    const b = PS.BAY_BY_ID[spot];
    return { x: b.cx + (s.jitter ? s.jitter.dx : 0), y: b.parkY, rot: b.noseRot + (s.jitter ? s.jitter.rot : 0) };
  }

  const setPose = (node, p) => node.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.rot.toFixed(2)})`);

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
    const names = ['ground', 'paint', 'types', 'route', 'leds', 'cars', 'moving', 'canopy', 'gates', 'heat', 'marks', 'hit', 'measure'];
    for (const n of names) {
      const g = el('g', { class: `layer layer-${n}` });
      if (n !== 'hit') g.setAttribute('aria-hidden', 'true');
      svg.appendChild(g);
      map.layers[n] = g;
    }
    map.layers.measure.setAttribute('visibility', 'hidden');
    map.layers.ground.innerHTML = ground();
    map.layers.paint.innerHTML = staticPaint();
    map.layers.canopy.innerHTML = canopy();
    map.layers.gates.innerHTML = gates();
    map.layers.marks.innerHTML = `<rect class="target-ring" x="0" y="0" width="${L.bayW - 4}" height="${L.bayD - 4}" rx="5" visibility="hidden"/>`;
    map.svg = svg;
    container.appendChild(svg);
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
      const ly = bay.opensUp ? bay.backY - 4.6 : bay.backY + 4.6;
      leds += `<g class="led" data-id="${bay.id}"><circle class="led-halo" cx="${bay.cx}" cy="${ly}" r="5"/><circle class="led-core" cx="${bay.cx}" cy="${ly}" r="2.3"/></g>`;
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
      s += `<text x="${bay.cx}" y="${bay.cy + 4}" class="heat-label">${Math.round(share * 100)}%</text>`;
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
      <circle class="route-start" cx="${start[0]}" cy="${start[1]}" r="5"/>`;
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
  function setGate(name, open) {
    const g = map.layers.gates.querySelector(`[data-gate="${name}"]`);
    if (g) g.classList.toggle('is-open', open);
  }
  function trackGates(id, pt) {
    for (const [name, gx] of [['entry', L.xL], ['exit', L.xR]]) {
      const near = Math.hypot(pt.x - gx, pt.y - L.gateY) < 118;
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
