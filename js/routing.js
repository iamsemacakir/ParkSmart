/* ParkSmart — routing and smart bay assignment
 * The lot's roads form a small graph. Routes are found with Dijkstra,
 * shifted into the right-hand lane, and handed to the map as polylines
 * for drawing and for driving the cars. The entry and exit driveways
 * are one-way.
 */
(function () {
  'use strict';
  const PS = window.PS;
  const L = PS.LOT;

  const JUNCTIONS = {
    LT: [L.xL, L.yT], RT: [L.xR, L.yT],
    LM: [L.xL, L.yM], RM: [L.xR, L.yM],
    LB: [L.xL, L.yB], RB: [L.xR, L.yB],
    EN: [L.xL, L.streetMid], // entry driveway meets the street
    EX: [L.xR, L.streetMid], // exit driveway meets the street
  };
  const ROAD_ENDS = { T: ['LT', 'RT'], M: ['LM', 'RM'], B: ['LB', 'RB'] };

  function buildGraph(extras, streetStart, streetEnd) {
    const nodes = { ...JUNCTIONS, S0: [streetStart, L.streetMid], S1: [streetEnd, L.streetMid] };
    const adj = {};
    const link = (a, b, oneWay) => {
      const [ax, ay] = nodes[a];
      const [bx, by] = nodes[b];
      const w = Math.abs(ax - bx) + Math.abs(ay - by);
      (adj[a] = adj[a] || []).push([b, w]);
      if (!oneWay) (adj[b] = adj[b] || []).push([a, w]);
    };
    for (const road of ['T', 'M', 'B']) {
      const chain = [ROAD_ENDS[road][0]];
      extras
        .filter((e) => e.road === road)
        .sort((a, b) => a.x - b.x)
        .forEach((e) => {
          nodes[e.id] = [e.x, e.y];
          chain.push(e.id);
        });
      chain.push(ROAD_ENDS[road][1]);
      for (let i = 0; i < chain.length - 1; i++) link(chain[i], chain[i + 1]);
    }
    link('LT', 'LM');
    link('LM', 'LB');
    link('RT', 'RM');
    link('RM', 'RB');
    link('S0', 'EN', true);
    link('EN', 'LB', true);
    link('RB', 'EX', true);
    link('EX', 'S1', true);
    return { nodes, adj };
  }

  function dijkstra(graph, src, dst) {
    const dist = { [src]: 0 };
    const prev = {};
    const open = new Set([src]);
    while (open.size) {
      let u = null;
      for (const n of open) if (u === null || dist[n] < dist[u]) u = n;
      open.delete(u);
      if (u === dst) break;
      for (const [v, w] of graph.adj[u] || []) {
        const nd = dist[u] + w;
        if (dist[v] === undefined || nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          open.add(v);
        }
      }
    }
    if (dist[dst] === undefined) return null;
    const path = [dst];
    while (path[0] !== src) path.unshift(prev[path[0]]);
    return { path: path.map((n) => graph.nodes[n]), length: dist[dst] };
  }

  /* ---------- Polyline helpers ---------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const len = (v) => Math.hypot(v[0], v[1]);
  const norm = (v) => {
    const l = len(v) || 1;
    return [v[0] / l, v[1] / l];
  };
  const rightOf = (d) => [-d[1], d[0]]; // SVG y points down

  function dedupe(pts) {
    return pts.filter((p, i) => i === 0 || len(sub(p, pts[i - 1])) > 0.01);
  }

  /* Shift a centre-line polyline into the right-hand lane. */
  function laneOffset(pts, off) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const dIn = i > 0 ? norm(sub(pts[i], pts[i - 1])) : null;
      const dOut = i < pts.length - 1 ? norm(sub(pts[i + 1], pts[i])) : null;
      let o;
      if (dIn && dOut) {
        const dot = dIn[0] * dOut[0] + dIn[1] * dOut[1];
        const nIn = rightOf(dIn);
        const nOut = rightOf(dOut);
        o = Math.abs(dot) < 0.5 ? [nIn[0] + nOut[0], nIn[1] + nOut[1]] : nIn;
      } else {
        o = rightOf(dIn || dOut);
      }
      out.push([pts[i][0] + o[0] * off, pts[i][1] + o[1] * off]);
    }
    return out;
  }

  /* Polyline with rounded corners as an SVG path string. A point may carry
   * its own corner radius as a third value. */
  function roundedPath(pts, radius = 24) {
    pts = dedupe(pts);
    if (pts.length < 2) return '';
    const f = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    let d = `M${f(pts[0])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const l1 = len(sub(b, a));
      const l2 = len(sub(c, b));
      const r = Math.min(b[2] || radius, l1 / 2, l2 / 2);
      const p1 = [b[0] + ((a[0] - b[0]) * r) / l1, b[1] + ((a[1] - b[1]) * r) / l1];
      const p2 = [b[0] + ((c[0] - b[0]) * r) / l2, b[1] + ((c[1] - b[1]) * r) / l2];
      d += ` L${f(p1)} Q${f(b)} ${f(p2)}`;
    }
    return d + ` L${f(pts[pts.length - 1])}`;
  }

  /* ---------- Routes ----------
   * from: { bay: 'A7' } or { entry: true }
   * to:   { bay: 'B3' } or { exit: true }
   * Returns { reverse, forward, length }: reverse is the backing-out
   * manoeuvre (or null), forward the drive, length the road distance.
   */
  function route(from, to, opts = {}) {
    const streetStart = opts.streetStart ?? -80;
    const streetEnd = opts.streetEnd ?? L.width + 80;
    const extras = [];
    const fromBay = from.bay ? PS.BAY_BY_ID[from.bay] : null;
    const toBay = to.bay ? PS.BAY_BY_ID[to.bay] : null;
    if (fromBay) extras.push({ id: 'P0', road: fromBay.road, x: fromBay.cx, y: fromBay.roadY });
    if (toBay) {
      const same = fromBay && toBay.cx === fromBay.cx && toBay.road === fromBay.road;
      extras.push({ id: 'P1', road: toBay.road, x: toBay.cx + (same ? 0.01 : 0), y: toBay.roadY });
    }

    const graph = buildGraph(extras, streetStart, streetEnd);
    const found = dijkstra(graph, fromBay ? 'P0' : 'S0', toBay ? 'P1' : 'S1');
    if (!found) return null;

    const off = L.laneOffset;
    let road = dedupe(found.path);
    let reverse = null;

    if (fromBay) {
      // Back straight out until the nose clears the neighbours, then swing
      // the tail round towards the direction of travel.
      const dir = road.length > 1 ? Math.sign(road[1][0] - road[0][0]) || 1 : 1;
      const side = fromBay.opensUp ? -1 : 1; // from the bay into its aisle
      const outY = fromBay.edgeY + side * 64;
      const laneY = fromBay.roadY + (dir > 0 ? off : -off);
      const start = [fromBay.cx, fromBay.parkY];
      const out = [fromBay.cx, outY];
      const backed = [fromBay.cx - dir * 34, outY];
      reverse = [start, out, backed];
      const lanePts = road.length > 1 ? laneOffset(road, off).slice(1) : [];
      road = [backed, [fromBay.cx + dir * 30, laneY], ...lanePts];
    } else {
      road = laneOffset(road, off);
    }

    if (toBay) {
      // Turn in from the far side of the aisle, so the car is straight by
      // the time its nose reaches the bay, as a driver would.
      const side = toBay.opensUp ? -1 : 1;
      const approachY = toBay.edgeY + side * 78;
      const last = road[road.length - 1];
      const prev = road[road.length - 2];
      const nearHalf = Math.abs(last[1] - toBay.edgeY) < L.roadW / 2;
      if (nearHalf && prev) {
        const dir = Math.sign(last[0] - prev[0]) || 1;
        const run = Math.max(0, Math.min(66, Math.abs(last[0] - prev[0]) - 6));
        road[road.length - 1] = [toBay.cx - dir * run, last[1]];
        road.push([toBay.cx, approachY, 40]);
      } else {
        road[road.length - 1] = [toBay.cx, approachY, 40];
      }
      road.push([toBay.cx, toBay.parkY]);
    }
    return { reverse, forward: dedupe(road), length: found.length };
  }

  /* Driving distance from the entry barrier to a bay, in metres. */
  const driveCache = {};
  function driveMeters(bayId) {
    if (driveCache[bayId] === undefined) {
      const r = route({ entry: true }, { bay: bayId });
      const toGate = L.xL + 80 + (L.streetMid - L.gateY); // street start to the barrier
      driveCache[bayId] = r ? Math.max(0, r.length - toGate) * L.metersPerUnit : Infinity;
    }
    return driveCache[bayId];
  }

  /* Walking distance from a bay to the booth by the entrance, in metres. */
  function walkMeters(bayId) {
    const b = PS.BAY_BY_ID[bayId];
    const bx = L.booth.x + L.booth.w / 2;
    const by = L.booth.y;
    return Math.hypot(b.cx - bx, b.cy - by) * L.metersPerUnit;
  }

  /* ---------- Smart assignment ----------
   * Accessible permit holders get the accessible bay nearest the booth.
   * Electric vehicles get the nearest free charging bay. Everyone else
   * gets the nearest standard bay, keeping special bays free.
   */
  function pickBay(needs, opts = {}) {
    const store = PS.store;
    const exclude = new Set(opts.exclude || []);
    const free = PS.BAYS.filter((b) => store.isFree(b.id) && !exclude.has(b.id)).map((b) => b.id);
    if (!free.length) return { bay: null, reason: 'The lot is full.' };
    const ofType = (t) => free.filter((id) => store.typeOf(id) === t);
    const nearestDrive = (ids) => ids.slice().sort((a, b) => driveMeters(a) - driveMeters(b))[0];
    const nearestWalk = (ids) => ids.slice().sort((a, b) => walkMeters(a) - walkMeters(b))[0];
    const m = (id, walk) => Math.round(walk ? walkMeters(id) : driveMeters(id));

    if (needs.accessible) {
      const acc = ofType('accessible');
      if (acc.length) {
        const id = nearestWalk(acc);
        return { bay: id, reason: `Accessible bay closest to the booth, about ${m(id, true)} m walk.` };
      }
      const std = ofType('standard').concat(needs.ev ? ofType('ev') : []);
      if (std.length) {
        const id = nearestWalk(std);
        return { bay: id, reason: 'No accessible bays are free. This is the closest bay to the booth.', fallback: true };
      }
    }
    if (needs.ev) {
      const ev = ofType('ev');
      if (ev.length) {
        const id = nearestDrive(ev);
        return { bay: id, reason: `Nearest free charging bay, ${m(id)} m from the gate.` };
      }
      const std = ofType('standard');
      if (std.length) {
        const id = nearestDrive(std);
        return { bay: id, reason: 'All charging bays are taken. Nearest standard bay instead.', fallback: true };
      }
    }
    const std = ofType('standard');
    if (std.length) {
      const id = nearestDrive(std);
      return { bay: id, reason: `Nearest free bay, ${m(id)} m from the gate.` };
    }
    const any = nearestDrive(free);
    return {
      bay: any,
      reason: `Only ${PS.util.lower(PS.BAY_TYPES[store.typeOf(any)].name)} bays are left.`,
      fallback: true,
    };
  }

  PS.routing = { route, roundedPath, driveMeters, walkMeters, pickBay, laneOffset };
})();
