/* ParkSmart — configuration
 * Lot geometry, default settings and the vehicle catalogue.
 * Everything else in the app reads from PS.LOT / PS.BAYS, so the layout
 * of the lot is defined in exactly one place.
 */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});

  /* ---------- Lot geometry (SVG user units) ----------
   * Drawn to scale: 18.4 units to the metre, so a bay is 2.5 m by 5 m and
   * the two-way aisles are 6.3 m wide. The layout is the original
   * ParkSmart one: an aisle loop with a middle aisle, and two double rows
   * of bays (blocks A and B) with planted islands at each end.
   */
  const M = 18.4; // units per metre
  const BAY_W = 46; // 2.5 m
  const BAY_D = 92; // 5 m
  const COLS = 13;
  const ISLAND = 48; // 2.6 m planted island at each end of a double row
  const ROAD = 116; // 6.3 m two-way aisle

  const LOT = {
    width: 1014,
    height: 1000,
    unitsPerMeter: M,
    metersPerUnit: 1 / M,
    bayW: BAY_W,
    bayD: BAY_D,
    cols: COLS,
    island: ISLAND,
    roadW: ROAD,
    // Aisle centre lines
    xL: 102, // west aisle
    xR: 912, // east aisle
    yT: 102, // north aisle
    yM: 402, // middle aisle
    yB: 702, // south aisle
    // Paved area inside the kerb
    paved: { x: 44, y: 44, w: 926, h: 716, r: 34 },
    // Double rows of bays, islands included
    blocks: {
      A: { x: 160, y: 160, w: 694, h: 184 },
      B: { x: 160, y: 460, w: 694, h: 184 },
    },
    bayX0: 208, // left edge of the first bay column
    strip: { y0: 760, y1: 810 }, // planted strip with the booth and barriers
    sidewalk: { y0: 810, y1: 846 },
    street: { y0: 850, y1: 982 }, // public street, one lane each way
    farWalk: { y0: 986, y1: 1022 },
    gateY: 787, // barrier arms across the driveways
    entry: { x0: 92, x1: 172 }, // one-way entry driveway
    exit: { x0: 842, x1: 922 }, // one-way exit driveway
    walkway: { x0: 176, x1: 200 }, // footpath from the sidewalk to the crossing
    booth: { x: 208, y: 771, w: 40, h: 28 }, // attendant booth by the entrance
    laneOffset: 30, // traffic keeps to the right-hand lane
  };
  LOT.streetMid = (LOT.street.y0 + LOT.street.y1) / 2;
  LOT.roadY = { T: LOT.yT, M: LOT.yM, B: LOT.yB };
  PS.LOT = LOT;

  /* Rows of bays. `road` is the aisle each row opens onto. */
  const ROWS = [
    { block: 'A', y: 160, road: 'T', first: 1 }, // A1–A13 open onto the north aisle
    { block: 'A', y: 252, road: 'M', first: 14 }, // A14–A26 open onto the middle aisle
    { block: 'B', y: 460, road: 'M', first: 1 }, // B1–B13 open onto the middle aisle
    { block: 'B', y: 552, road: 'B', first: 14 }, // B14–B26 open onto the south aisle
  ];

  const PARK_SHIFT = 1; // parked cars pull up close to the wheel stop

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

  /* Vehicle kinds people pick at check-in, and the body shapes the map
   * draws for each. A car is drawn as a saloon or a hatchback. */
  PS.VEHICLES = {
    car: { name: 'Car', styles: ['sedan', 'hatch'] },
    suv: { name: 'SUV', styles: ['suv'] },
    van: { name: 'Van', styles: ['van'] },
  };

  /* Half length and half width in units: a saloon is 4.7 m by 1.85 m. */
  PS.CAR_STYLES = {
    sedan: { hl: 43, hw: 17 },
    hatch: { hl: 40, hw: 16.8 },
    suv: { hl: 44, hw: 18 },
    van: { hl: 45, hw: 18.5 },
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
