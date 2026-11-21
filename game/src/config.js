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
  sand: '#e8d29a',
  water: '#2f7fb8',
  waterDeep: '#256a9e',
  road: '#3a3f46',
  roadLine: '#e8d44d',
  sidewalk: '#9aa0a8',
  park: '#5d9c4a',
  building: ['#c98f5f', '#b57a6a', '#8fa3b8', '#a8a58e', '#c2a15a', '#7d8ba0', '#b08d7e'],
  roof: '#5c5148',
  panel: '#14181fd9',
  panelSolid: '#14181f',
  text: '#f2f4f0',
  muted: '#b9c0c8',
  gold: '#f2c94c',
  red: '#e5534b',
  blue: '#4fc3f7',
  green: '#7ed957',
  copBlue: '#2f6df6',
  copWhite: '#f4f6f8',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** localStorage keys for the save and the best haul (this browser only). */
export const SAVE_KEY = 'solmar-heat.save.v1';
export const BEST_KEY = 'solmar-heat.best.v1';
