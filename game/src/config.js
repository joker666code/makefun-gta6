// Solmar Heat — all tuning lives here and nowhere else.
//
// The city is 2880 x 2160, the camera chases the player, and the renderer
// fits a 1280 x 720 view onto the window. Nothing below cares about the
// actual window size, so the same numbers drive both the game and the
// staged screenshot scenes.

export const VIEW = { width: 1280, height: 720 };
export const WORLD = { width: 2880, height: 2160 };

/** One simulation tick, in seconds (the game runs at 60 ticks a second). */
export const STEP = 1 / 60;

/** Streets are laid out on a grid: a road every BLOCK pixels. */
export const CITY = {
  block: 360,
  roadWidth: 64,
  sidewalk: 12,
  beachWidth: 260,
  parkAt: { x: 1112, y: 752, w: 296, h: 296 },
};

export const PLAYER = {
  radius: 13,
  walkSpeed: 210,
  runSpeed: 300,
  health: 100,
  startMoney: 120,
  startAmmo: 24,
  enterRange: 70,
};

export const CAR = {
  length: 54,
  width: 26,
  radius: 20,
  accel: 420,
  brake: 700,
  reverse: 180,
  maxSpeed: 560,
  maxReverse: 160,
  turnRate: 2.6,
  drag: 0.55,
  // Holding Shift while driving is the handbrake: steering bites harder
  // (driftTurn), speed scrubs off faster (driftDrag), rear tyres smoke.
  driftTurn: 1.7,
  driftDrag: 140,
  trafficSpeed: 150,
  policeSpeed: 520,
};

export const PED = { radius: 10, walkSpeed: 55, fleeSpeed: 170 };

/**
 * Top-down body specs per vehicle kind. Collision still uses CAR.length /
 * CAR.width, but each kind draws its own silhouette, glass, lights and trim
 * inside that box, so a cruiser, a cab and a sports car read differently
 * at a glance. `trim` is the accent stripe / roof colour, `glass` the
 * window tint, `wheels` the tyre inset from the body edge.
 */
export const CAR_MODELS = {
  sedan: { body: null, trim: '#22262c', glass: '#22303e', roof: null, spoiler: false, stripe: false, sign: false, wheels: 4 },
  sports: { body: null, trim: '#1a1d22', glass: '#101c26', roof: null, spoiler: true, stripe: true, sign: false, wheels: 6 },
  taxi: { body: '#e8b73d', trim: '#151515', glass: '#22303e', roof: '#e8b73d', spoiler: false, stripe: false, sign: true, wheels: 4 },
  cop: { body: '#f4f6f8', trim: '#2f6df6', glass: '#1d2733', roof: '#f4f6f8', spoiler: false, stripe: true, sign: false, wheels: 4 },
  van: { body: null, trim: '#22262c', glass: '#2b3a48', roof: null, spoiler: false, stripe: false, sign: false, wheels: 2 },
  courier: { body: '#c9a24a', trim: '#3a2f10', glass: '#22303e', roof: '#c9a24a', spoiler: false, stripe: false, sign: false, wheels: 2 },
};

export const COMBAT = {
  bulletSpeed: 950,
  bulletLife: 0.7,
  fireDelay: 0.22,
  copFireDelay: 0.9,
  copDamage: 7,
  playerDamage: 34,
  carRamDamage: 18,
  meleeRange: 34,
  meleeDamage: 20,
};

export const WANTED = {
  max: 5,
  steal: 1,
  hitPed: 1,
  shoot: 1,
  decayQuiet: 22,
  decayStep: 9,
};

/** How many jobs the story chain holds (the HUD prints JOB n/<this>). */
export const JOB_COUNT = 7;

/**
 * The seven jobs, in story order. Mara Voss hands out the odd ones,
 * Dario Kent the even ones; the last job pays the big money and ends the game.
 */
export const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    giver: 'Mara Voss',
    briefing: 'You are new in Port Solmar and broke. Borrow a car — any car — and bring it to the marina marker.',
    objective: 'Steal a car and drive to the marina marker',
    reward: 250,
  },
  {
    id: 'package-run',
    title: 'Package Run',
    giver: 'Mara Voss',
    briefing: 'A parcel is waiting at the docks. Pick it up on foot, then drive it to Solmar Plaza before the buyer walks.',
    objective: 'Collect the package at the docks, deliver it to Solmar Plaza',
    reward: 400,
  },
  {
    id: 'tail-the-courier',
    title: 'Tail the Courier',
    giver: 'Dario Kent',
    briefing: 'A courier van is carrying rival cash across town. Stay close behind it until it stops — do not lose it.',
    objective: 'Tail the courier van until it stops',
    reward: 600,
  },
  {
    id: 'heat-escape',
    title: 'Heat Escape',
    giver: 'Mara Voss',
    briefing: 'The Solmar police are on you now. Lose the heat, then reach the hideout in the old town.',
    objective: 'Lose the police, then reach the hideout',
    reward: 800,
  },
  {
    id: 'taxi-fare',
    title: 'Taxi Fare',
    giver: 'Dario Kent',
    briefing: 'A high-roller is waiting at Solmar Plaza and pays for a smooth ride. Pick them up in a car and drop them at the marina — no cops, no crashes.',
    objective: 'Pick up the passenger at Solmar Plaza, drop them at the Marina',
    reward: 700,
  },
  {
    id: 'smugglers-run',
    title: "Smuggler's Run",
    giver: 'Mara Voss',
    briefing: 'Three drops, one clock: the docks, then Solmar Plaza, then the marina — in that order, before the timer runs out.',
    objective: 'Hit all three drop points in order before the timer ends',
    reward: 900,
  },
  {
    id: 'the-big-score',
    title: 'The Big Score',
    giver: 'Dario Kent',
    briefing: 'One last job: the Solmar Trust vault. Grab the cash on foot and run it to the hideout. Every cop in town will come.',
    objective: 'Grab the vault cash and escape to the hideout',
    reward: 1500,
  },
];

export const PALETTE = {
  grass: '#7fae5a',
  grassDark: '#74a24f',
  grassLight: '#8abd68',
  sand: '#e8d29a',
  sandDark: '#dcc184',
  water: '#2f7fb8',
  waterDeep: '#1d5a8a',
  waterShallow: '#57a8d4',
  road: '#3a3f46',
  roadDark: '#2f3339',
  roadLine: '#e8d44d',
  sidewalk: '#9aa0a8',
  sidewalkDark: '#878d96',
  park: '#5d9c4a',
  parkPath: '#cbb98a',
  building: ['#c98f5f', '#b57a6a', '#8fa3b8', '#a8a58e', '#c2a15a', '#7d8ba0', '#b08d7e'],
  roof: '#5c5148',
  roofLight: '#6e6258',
  roofDark: '#463d36',
  sign: ['#e5534b', '#2f6df6', '#7ed957', '#f2c94c', '#e07a9b', '#3da67a'],
  panel: '#14181fd9',
  panelSolid: '#14181f',
  panelEdge: '#f2c94c',
  text: '#f2f4f0',
  muted: '#b9c0c8',
  gold: '#f2c94c',
  goldDark: '#b98f1d',
  red: '#e5534b',
  blue: '#4fc3f7',
  green: '#7ed957',
  copBlue: '#2f6df6',
  copWhite: '#f4f6f8',
  lampGlow: '#ffd98a',
  headlight: '#fff3c4',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/** Display face for titles and big numbers: heavy, condensed, no webfont. */
export const FONT_DISPLAY = '"Arial Narrow", "Helvetica Neue", Arial, system-ui, sans-serif';

/** localStorage keys for the save and the best haul (this browser only). */
export const SAVE_KEY = 'solmar-heat.save.v1';
export const BEST_KEY = 'solmar-heat.best.v1';
