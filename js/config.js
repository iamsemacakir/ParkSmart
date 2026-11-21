/* ParkSmart — configuration
 * Lot geometry, default settings and the vehicle catalogue.
 * Everything else in the app reads from PS.LOT / PS.BAYS, so the layout
 * of the lot is defined in exactly one place.
 */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});

  /* ---------- Lot geometry (SVG user units) ----------
   * The lot keeps the original ParkSmart layout: a road loop with a
   * middle road, and two double-row blocks (A and B) of 26 bays each.
   */
  const BAY_W = 46;
  const BAY_D = 84;
  const COLS = 13;

  const LOT = {
    width: 900,
    height: 690,
    bayW: BAY_W,
    bayD: BAY_D,
    cols: COLS,
    roadW: 64,
    // Road centre lines
    xL: 72, // left road
    xR: 822, // right road
    yT: 68, // top road
    yM: 300, // middle road
    yB: 532, // bottom road
    // Paved outer edge of the road loop
    paved: { x: 40, y: 36, w: 814, h: 528 },
    // Parking blocks (between the roads)
    blocks: {
      A: { x: 104, y: 100, w: 686, h: 168 },
      B: { x: 104, y: 332, w: 686, h: 168 },
    },
    bayX0: 148, // left edge of the first bay column
    street: { y0: 600, y1: 662 }, // public street below the lot
    gateY: 568, // barrier gates sit where the driveways meet the lot
    booth: { x: 112, y: 570, w: 30, h: 24 }, // attendant booth by the entrance
    laneOffset: 14, // cars drive on the right-hand side of each road
    metersPerUnit: 2.5 / BAY_W, // a bay is 2.5 m wide
  };
  LOT.streetMid = (LOT.street.y0 + LOT.street.y1) / 2;
  LOT.roadY = { T: LOT.yT, M: LOT.yM, B: LOT.yB };
  PS.LOT = LOT;

  /* Rows of bays. `road` is the aisle each row opens onto. */
  const ROWS = [
    { block: 'A', y: 100, road: 'T', first: 1 }, // A1–A13 open up to the top road
    { block: 'A', y: 184, road: 'M', first: 14 }, // A14–A26 open down to the middle road
    { block: 'B', y: 332, road: 'M', first: 1 }, // B1–B13 open up to the middle road
    { block: 'B', y: 416, road: 'B', first: 14 }, // B14–B26 open down to the bottom road
  ];

  const PARK_SHIFT = 3; // parked cars sit slightly towards the back of the bay

  PS.BAYS = [];
  PS.BAY_BY_ID = {};
  ROWS.forEach((row, r) => {
    for (let c = 0; c < COLS; c++) {
      const x = LOT.bayX0 + c * BAY_W;
      const roadY = LOT.roadY[row.road];
      const opensUp = roadY < row.y; // the aisle is above the bay
      const cy = row.y + BAY_D / 2;
      const bay = {
        id: row.block + (row.first + c),
        block: row.block,
        row: r,
        col: c,
        x,
        y: row.y,
        w: BAY_W,
        h: BAY_D,
        cx: x + BAY_W / 2,
        cy,
        road: row.road,
        roadY,
        opensUp,
        edgeY: opensUp ? row.y : row.y + BAY_D, // edge that meets the aisle
        backY: opensUp ? row.y + BAY_D : row.y, // edge at the back of the bay
        parkY: opensUp ? cy + PARK_SHIFT : cy - PARK_SHIFT,
        noseRot: opensUp ? 180 : 0, // cars pull in nose first
      };
      PS.BAYS.push(bay);
      PS.BAY_BY_ID[bay.id] = bay;
    }
  });
  PS.BAY_GRID = ROWS.map((_, r) => PS.BAYS.filter((b) => b.row === r));

  /* Bays painted for special use when the lot is first set up. */
  PS.DEFAULT_BAY_TYPES = {
    A14: 'ev', A15: 'ev', B1: 'ev', B2: 'ev',
    B14: 'accessible', B15: 'accessible', B16: 'accessible',
  };

  PS.BAY_TYPES = {
    standard: { name: 'Standard', bay: 'Standard bay' },
    ev: { name: 'EV charging', bay: 'EV charging bay' },
    accessible: { name: 'Accessible', bay: 'Accessible bay' },
  };
  PS.BAY_TYPE_ORDER = ['standard', 'ev', 'accessible'];

  PS.DEFAULT_SETTINGS = {
    lotName: 'Central Lot',
    currency: 'USD',
    graceMinutes: 10,
    firstHour: 3,
    extraHour: 2,
    dailyMax: 20,
    maxStayHours: 4,
    theme: 'system',
  };

  PS.CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'TRY', 'PLN', 'RON', 'CAD', 'AUD', 'JPY', 'INR'];

  PS.VEHICLES = {
    car: { name: 'Car', hl: 28, hw: 13 },
    suv: { name: 'SUV', hl: 30, hw: 14 },
    van: { name: 'Van', hl: 31, hw: 14 },
  };

  PS.CAR_COLORS = {
    white: { name: 'White', hex: '#ECEEEC' },
    black: { name: 'Black', hex: '#1F2327' },
    silver: { name: 'Silver', hex: '#B7BDC2' },
    gray: { name: 'Gray', hex: '#686F76' },
    blue: { name: 'Blue', hex: '#2F5DA6' },
    red: { name: 'Red', hex: '#B3332E' },
    green: { name: 'Green', hex: '#2E6A50' },
    sand: { name: 'Sand', hex: '#C8B48F' },
  };

  PS.PAYMENT_METHODS = { card: 'Card', cash: 'Cash', app: 'App' };

  PS.CHARGER_KW = 7.4; // AC charge points on the EV bays
})();
