// The simulation: the player on foot and behind the wheel, traffic,
// pedestrians, the police and the wanted level, combat, pickups and
// particles. Nothing here draws anything and nothing here touches the
// browser — stepGame() moves the world one fixed tick and reports what
// happened as bit flags, so the caller can play sounds and show messages
// without this file knowing about screens or audio. The job chain itself
// lives in missions.js and is ticked from here.

import { CAR, CITY, COMBAT, MISSIONS, PED, PLAYER, WANTED, WORLD } from './config.js';
import { angleDiff, clamp, createRandom, dist } from './random.js';
import { PLACES, buildingHit, isWater, planRoute, randomRoadPoint, randomSidewalkPoint, resolveCircle } from './world.js';
import { updateMissions } from './missions.js';

export const EVENT_PICKUP = 1;
export const EVENT_CASH = 2;
export const EVENT_CRASH = 4;
export const EVENT_SHOT = 8;
export const EVENT_CRIME = 16;
export const EVENT_MISSION = 32;
export const EVENT_BUSTED = 64;
export const EVENT_WON = 128;
export const EVENT_HIT_PED = 256;

const CAR_COLORS = ['#d94f3d', '#3d7dd9', '#e8b73d', '#7a5fd0', '#3da67a', '#d9d9d9', '#2b2f36', '#c97b2e'];
const PED_COLORS = ['#e8a87c', '#8ecae6', '#ffb703', '#90be6d', '#f28482', '#b08968', '#84a98c', '#e07a5f'];

let nextCarId = 1;

/** Build a car. `driver` is traffic, park, police, courier or none. */
export function makeCar(x, y, angle, color, kind, driver, axis) {
  return {
    id: nextCarId,
    x, y, angle, speed: 0,
    visAngle: angle, // render-side smoothed heading, so turns look fluid
    color, kind, driver,
    axis: axis || 'x',
    dir: 1,
    lane: 14,
    health: 100,
    wrecked: false,
    turnCooldown: 0,
  };
}

/** A fresh run: player, traffic, pedestrians, pickups, first job open. */
export function createState(random, city) {
  nextCarId = 1;
  // A second RNG stream for purely visual jitter (exhaust, shells, the
  // extra muzzle flash, explosion spray, ped trouser colours). It is
  // seeded from the city geometry, so it never draws from the simulation
  // stream and can never change traffic, police or mission outcomes.
  const vrng = createRandom((((city.buildings.length * 2654435761) ^ (city.trees.length * 40503) ^ ((city.buildings[0] ? city.buildings[0].x : 0) * 97)) >>> 0) || 1);
  const state = {
    rng: random,
    vrng,
    city,
    time: 0,
    clock: 9 * 3600,
    day: 1,
    player: {
      x: PLACES.start.x, y: PLACES.start.y, angle: -Math.PI / 2,
      health: PLAYER.health, ammo: PLAYER.startAmmo, money: PLAYER.startMoney,
      car: null, invuln: 0, fireTimer: 0, speed: 0, phase: 0,
    },
    cars: [],
    peds: [],
    cops: [],
    bullets: [],
    particles: [],
    skids: [], // fading tyre marks left by drifts and hard stops
    rain: 0, // 0 = dry, 1 = heavy rain; the chase scene turns it on
    pickups: [],
    wanted: 0,
    quietTimer: 0,
    decayTimer: 0,
    shotCrimeTimer: 0,
    missionIndex: 0,
    mission: null,
    stats: { carsStolen: 0, pedsHit: 0, shotsFired: 0, missionsDone: 0, arrests: 0 },
    message: '',
    messageTimer: 0,
    shake: 0,
    over: false,
    busted: false,
    won: false,
    camera: { x: PLACES.start.x, y: PLACES.start.y },
  };
  spawnTraffic(state, 14);
  spawnParked(state, 8);
  spawnPeds(state, 22);
  spawnPickups(state);
  updateMissions(state, city, 0); // opens job 1 and fills state.mission
  return state;
}

function spawnTraffic(state, count) {
  for (let i = 0; i < count; i += 1) {
    const p = randomRoadPoint(state.city, state.rng);
    const angle = p.axis === 'x' ? (state.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (state.rng.chance(0.5) ? 0 : Math.PI);
    const car = makeCar(p.x, p.y, angle, state.rng.pick(CAR_COLORS), state.rng.pick(['sedan', 'sedan', 'taxi', 'van', 'sports']), 'traffic', p.axis);
    car.dir = state.rng.chance(0.5) ? 1 : -1;
    car.speed = CAR.trafficSpeed * state.rng.range(0.8, 1.1);
    state.cars.push(car);
  }
}

function spawnParked(state, count) {
  for (let i = 0; i < count; i += 1) {
    const p = randomRoadPoint(state.city, state.rng);
    const along = p.axis === 'x';
    const x = along ? p.x + (state.rng.chance(0.5) ? 1 : -1) * 44 : p.x + state.rng.range(-120, 120);
    const y = along ? p.y + state.rng.range(-120, 120) : p.y + (state.rng.chance(0.5) ? 1 : -1) * 44;
    const angle = along ? (state.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (state.rng.chance(0.5) ? 0 : Math.PI);
    const car = makeCar(x, y, angle, state.rng.pick(CAR_COLORS), state.rng.pick(['sedan', 'sedan', 'taxi', 'sports']), 'park', p.axis);
    state.cars.push(car);
  }
}

function spawnPeds(state, count) {
  for (let i = 0; i < count; i += 1) {
    const p = randomSidewalkPoint(state.city, state.rng);
    state.peds.push({
      x: p.x, y: p.y, angle: state.rng.range(0, Math.PI * 2),
      speed: PED.walkSpeed * state.rng.range(0.7, 1.3),
      color: state.rng.pick(PED_COLORS),
      pants: state.vrng.pick(['#2b3a55', '#4a3b2a', '#333333', '#5a6b7a']),
      phase: state.vrng.range(0, Math.PI * 2),
      mode: 'walk', tx: p.x, ty: p.y, wait: 0, down: 0,
    });
  }
}

function spawnPickups(state) {
  const spots = [
    { x: 700, y: 700, kind: 'health' }, { x: 1620, y: 540, kind: 'ammo' },
    { x: 2340, y: 1440, kind: 'health' }, { x: 900, y: 1800, kind: 'ammo' },
    { x: 1980, y: 900, kind: 'cash' }, { x: 1260, y: 1620, kind: 'cash' },
    { x: 540, y: 1260, kind: 'health' }, { x: 2700, y: 540, kind: 'ammo' },
  ];
  for (const s of spots) state.pickups.push({ ...s, active: true, bob: state.rng.range(0, 6) });
}

export function addWanted(state, amount) {
  const before = state.wanted;
  state.wanted = clamp(state.wanted + amount, 0, WANTED.max);
  state.quietTimer = 0;
  state.decayTimer = 0;
  return state.wanted > before ? EVENT_CRIME : 0;
}

/** A short-lived spray of particles, for smoke, sparks and blood. */
function burst(state, x, y, color, count, speed, glow, rng) {
  const r = rng || state.rng;
  for (let i = 0; i < count; i += 1) {
    const a = r.range(0, Math.PI * 2);
    const s = r.range(speed * 0.3, speed);
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: r.range(0.3, 0.8), max: 0.8, color, size: r.range(2, 5), glow: Boolean(glow) });
  }
}

/** A wreck going up: orange flash, fire, smoke and flying debris. */
function explode(state, x, y) {
  burst(state, x, y, '#ffb03d', 10, 260, true, state.vrng);
  burst(state, x, y, '#ff5a2d', 8, 200, true, state.vrng);
  burst(state, x, y, '#ffdd66', 6, 160, true, state.vrng);
  burst(state, x, y, '#555550', 14, 130, false, state.vrng);
  burst(state, x, y, '#2b2b2b', 10, 90, false, state.vrng);
  state.shake = Math.min(1, (state.shake || 0) + 0.7);
}

/** One spent brass case, kicked out sideways with a little spin. */
function ejectShell(state, x, y, angle) {
  const a = angle + Math.PI / 2 + state.vrng.range(-0.4, 0.4);
  state.particles.push({
    x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40,
    life: 0.55, max: 0.55, color: '#d9a441', size: 2, shell: true, glow: false,
  });
}

/** A tyre mark segment, left where a rear wheel scrubbed the road. */
function addSkid(state, car) {
  const bx = car.x - Math.cos(car.angle) * 20;
  const by = car.y - Math.sin(car.angle) * 20;
  const perp = car.angle + Math.PI / 2;
  for (const side of [-1, 1]) {
    state.skids.push({ x: bx + Math.cos(perp) * side * 9, y: by + Math.sin(perp) * side * 9, angle: car.angle, life: 5, max: 5 });
  }
  if (state.skids.length > 240) state.skids.splice(0, state.skids.length - 240);
}

function nearestCar(state, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of state.cars) {
    if (car.wrecked || car.driver === 'police') continue;
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

function enterCar(state, car) {
  const player = state.player;
  if (car.driver === 'traffic') {
    // The driver bails out and runs away on foot.
    state.peds.push({
      x: car.x + 30, y: car.y + 30, angle: state.rng.range(0, Math.PI * 2),
      speed: PED.fleeSpeed, color: state.rng.pick(PED_COLORS), mode: 'flee', tx: car.x + 300, ty: car.y + 300, wait: 0, down: 0,
    });
  }
  car.driver = 'player';
  car.parked = false;
  player.car = car;
  player.x = car.x;
  player.y = car.y;
  player.speed = 0;
  state.stats.carsStolen += 1;
  return addWanted(state, WANTED.steal);
}

function exitCar(state) {
  const player = state.player;
  const car = player.car;
  if (!car) return 0;
  car.driver = 'park';
  car.speed = 0;
  const side = player.angle + Math.PI / 2;
  const pos = resolveCircle(state.city, car.x + Math.cos(side) * 34, car.y + Math.sin(side) * 34, PLAYER.radius);
  player.x = pos.x;
  player.y = pos.y;
  player.car = null;
  return 0;
}

function spawnPoliceCar(state) {
  const p = randomRoadPoint(state.city, state.rng);
  const dx = state.player.x - p.x;
  const dy = state.player.y - p.y;
  if (Math.hypot(dx, dy) < 420) return; // too close to appear out of nowhere
  const car = makeCar(p.x, p.y, Math.atan2(dy, dx), '#f4f6f8', 'cop', 'police', p.axis);
  car.speed = CAR.policeSpeed * 0.7;
  state.cars.push(car);
}

function spawnFootCop(state) {
  const a = state.rng.range(0, Math.PI * 2);
  const pos = resolveCircle(state.city, state.player.x + Math.cos(a) * 260, state.player.y + Math.sin(a) * 260, PED.radius);
  state.cops.push({ x: pos.x, y: pos.y, angle: a, health: 60, speed: 235, fireTimer: state.rng.range(0.4, 1) });
}

function updatePolice(state, dt) {
  const wantCars = state.wanted >= 3 ? Math.min(3, state.wanted - 1) : state.wanted >= 1 ? 1 : 0;
  const policeCars = state.cars.filter((c) => c.driver === 'police' && !c.wrecked);
  if (policeCars.length < wantCars && state.rng.chance(dt * 0.8)) spawnPoliceCar(state);
  if (state.wanted >= 2 && !state.player.car && state.cops.length < Math.min(2, state.wanted - 1) && state.rng.chance(dt * 0.5)) {
    spawnFootCop(state);
  }
  // The heat only cools while the player is quiet and no police are near.
  const nearPolice = policeCars.some((c) => dist(c.x, c.y, state.player.x, state.player.y) < 520)
    || state.cops.some((c) => dist(c.x, c.y, state.player.x, state.player.y) < 420);
  if (state.wanted > 0 && !nearPolice) {
    state.quietTimer += dt;
    if (state.quietTimer > WANTED.decayQuiet) {
      state.decayTimer += dt;
      if (state.decayTimer > WANTED.decayStep) {
        state.wanted -= 1;
        state.decayTimer = 0;
        state.quietTimer = 0;
        setMessage(state, state.wanted === 0 ? 'You lost the heat.' : `Wanted level down: ${state.wanted} star${state.wanted === 1 ? '' : 's'}.`);
      }
    }
  } else {
    state.quietTimer = 0;
    state.decayTimer = 0;
  }
}

export function setMessage(state, text) {
  state.message = text;
  state.messageTimer = 4;
}

function stepPlayerOnFoot(state, ctl, dt) {
  const player = state.player;
  const speed = ctl.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const mx = ctl.mx;
  const my = ctl.my;
  const len = Math.hypot(mx, my) || 1;
  let nx = player.x + (mx / len) * speed * dt;
  let ny = player.y + (my / len) * speed * dt;
  if (mx === 0 && my === 0) {
    nx = player.x;
    ny = player.y;
  }
  const pos = resolveCircle(state.city, nx, ny, PLAYER.radius);
  player.x = pos.x;
  player.y = pos.y;
  player.speed = mx === 0 && my === 0 ? 0 : speed;
  // Walk cycle: the phase drives the leg swing in the renderer.
  if (player.speed > 0) player.phase = (player.phase || 0) + dt * speed * 0.055;
  if (ctl.aimX !== undefined) player.angle = Math.atan2(ctl.aimY - player.y, ctl.aimX - player.x);
  if (player.invuln > 0) player.invuln -= dt;
  if (player.fireTimer > 0) player.fireTimer -= dt;
  if (state.shotCrimeTimer > 0) state.shotCrimeTimer -= dt;
  if (ctl.firing && player.fireTimer <= 0 && player.ammo > 0) {
    player.fireTimer = COMBAT.fireDelay;
    player.ammo -= 1;
    state.stats.shotsFired += 1;
    const a = player.angle + state.rng.range(-0.03, 0.03);
    // Muzzle flash: a few bright sparks at the end of the barrel.
    burst(state, player.x + Math.cos(a) * 24, player.y + Math.sin(a) * 24, '#ffe66d', 3, 60, true);
    burst(state, player.x + Math.cos(a) * 26, player.y + Math.sin(a) * 26, '#ff9a3d', 2, 40, true, state.vrng);
    ejectShell(state, player.x, player.y, a);
    state.bullets.push({
      x: player.x + Math.cos(a) * 20, y: player.y + Math.sin(a) * 20,
      vx: Math.cos(a) * COMBAT.bulletSpeed, vy: Math.sin(a) * COMBAT.bulletSpeed,
      life: COMBAT.bulletLife, from: 'player',
    });
    // Firing in public is a crime, but one burst counts once, not per shot.
    if (state.shotCrimeTimer <= 0) {
      state.shotCrimeTimer = 2;
      return EVENT_SHOT | addWanted(state, WANTED.shoot);
    }
    return EVENT_SHOT;
  }
  if (ctl.melee) {
    for (const cop of state.cops) {
      if (dist(player.x, player.y, cop.x, cop.y) < COMBAT.meleeRange + PED.radius) {
        cop.health -= COMBAT.meleeDamage;
        burst(state, cop.x, cop.y, '#e5534b', 6, 120);
      }
    }
    for (const ped of state.peds) {
      if (ped.down <= 0 && dist(player.x, player.y, ped.x, ped.y) < COMBAT.meleeRange + PED.radius) {
        ped.mode = 'flee';
        ped.tx = ped.x + (ped.x - player.x) * 4;
        ped.ty = ped.y + (ped.y - player.y) * 4;
      }
    }
  }
  return 0;
}

/**
 * Move a car, sliding along a building face when the full move is
 * blocked instead of stopping dead in the corner. True if it moved at all.
 */
function moveCarWithSlide(state, car, dt) {
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  if (!buildingHit(state.city, nx, ny, CAR.radius) && !isWater(nx)) {
    car.x = nx;
    car.y = ny;
    return true;
  }
  if (!buildingHit(state.city, nx, car.y, CAR.radius) && !isWater(nx)) {
    car.x = nx;
    return true;
  }
  if (!buildingHit(state.city, car.x, ny, CAR.radius) && !isWater(car.x)) {
    car.y = ny;
    return true;
  }
  // Wedged: the car already overlaps a building (shoved into a corner by
  // traffic, or parked on a road edge). Every candidate move still
  // overlaps, so sliding cannot free it — push it out to the nearest
  // free spot instead of leaving it stuck there forever.
  const pos = resolveCircle(state.city, car.x, car.y, CAR.radius);
  if (pos.x !== car.x || pos.y !== car.y) {
    car.x = pos.x;
    car.y = pos.y;
    return true;
  }
  return false;
}

function stepDriving(state, ctl, dt) {
  const player = state.player;
  const car = player.car;
  if (!car) return 0;
  let events = 0;
  // W/S or Up/Down: throttle and brake. A/D: steering (reversed in reverse).
  const throttle = ctl.my < 0 ? 1 : ctl.my > 0 ? -0.6 : 0;
  const steer = ctl.mx;
  if (throttle > 0) car.speed += CAR.accel * throttle * dt;
  else if (throttle < 0) car.speed += CAR.brake * throttle * dt;
  else car.speed -= Math.sign(car.speed) * CAR.drag * Math.abs(car.speed) * dt * 2;
  if (Math.abs(car.speed) < 8 && throttle === 0) car.speed = 0;
  car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
  // Handbrake (Shift): at speed it is a drift — steering bites 1.7x,
  // speed scrubs off, the rear tyres smoke. At a crawl it is a hard stop.
  const drifting = ctl.run && Math.abs(car.speed) > 120;
  const grip = clamp(Math.abs(car.speed) / 120, 0.3, 1);
  const turn = steer * CAR.turnRate * dt * (car.speed >= 0 ? 1 : -1) * grip * (drifting ? CAR.driftTurn : 1);
  if (drifting) {
    car.speed -= Math.sign(car.speed) * CAR.driftDrag * dt;
    addSkid(state, car);
    if (state.rng.chance(dt * 22)) {
      const bx = car.x - Math.cos(car.angle) * 22;
      const by = car.y - Math.sin(car.angle) * 22;
      state.particles.push({ x: bx, y: by, vx: state.rng.range(-20, 20), vy: state.rng.range(-20, 20), life: 0.5, max: 0.5, color: '#cfcfcf', size: state.rng.range(4, 7) });
    }
  } else if (ctl.run && Math.abs(car.speed) > 0) {
    car.speed -= Math.sign(car.speed) * CAR.driftDrag * 2 * dt;
  }
  // Exhaust: a faint puff from the tailpipe while the engine pulls.
  if (throttle > 0 && Math.abs(car.speed) > 60 && state.vrng.chance(dt * 14)) {
    const ex = car.x - Math.cos(car.angle) * (CAR.length / 2 + 2);
    const ey = car.y - Math.sin(car.angle) * (CAR.length / 2 + 2);
    state.particles.push({ x: ex, y: ey, vx: -Math.cos(car.angle) * 40 + state.vrng.range(-12, 12), vy: -Math.sin(car.angle) * 40 + state.vrng.range(-12, 12), life: 0.7, max: 0.7, color: 'rgba(180,180,180,0.55)', size: state.vrng.range(3, 6) });
  }
  car.angle += turn;
  if (!moveCarWithSlide(state, car, dt)) {
    if (Math.abs(car.speed) > 200) {
      events |= EVENT_CRASH;
      state.shake = Math.min(1, (state.shake || 0) + 0.5);
      burst(state, car.x, car.y, '#c9c9c9', 10, 160);
      car.health -= 12;
    }
    car.speed *= -0.25;
  }
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.speed = Math.abs(car.speed);
  // Running over pedestrians is a crime, and the crowd notices.
  for (const ped of state.peds) {
    if (ped.down > 0) continue;
    if (dist(car.x, car.y, ped.x, ped.y) < CAR.radius + PED.radius && Math.abs(car.speed) > 120) {
      ped.down = 4;
      ped.mode = 'down';
      state.stats.pedsHit += 1;
      events |= EVENT_HIT_PED | EVENT_CRASH;
      burst(state, ped.x, ped.y, '#e5534b', 8, 140);
      events |= addWanted(state, WANTED.hitPed);
    }
  }
  // Ramming a cruiser damages it; ramming traffic slows both cars and
  // shoves the other one aside, so a jam can always be pushed through.
  for (const other of state.cars) {
    if (other === car || other.wrecked) continue;
    const d = dist(car.x, car.y, other.x, other.y);
    if (d < CAR.radius * 2 - 4) {
      if (Math.abs(car.speed) > 140) {
        other.health -= COMBAT.carRamDamage;
        other.speed *= 0.4;
        car.speed *= 0.55;
        events |= EVENT_CRASH;
        state.shake = Math.min(1, (state.shake || 0) + 0.3);
        burst(state, other.x, other.y, '#f2c94c', 8, 150);
        if (other.health <= 0 && !other.wrecked) {
          other.wrecked = true;
          other.driver = 'none';
          explode(state, other.x, other.y);
        }
        if (other.driver === 'police') events |= addWanted(state, 1);
      }
      // Shove the other car out of the overlap, GTA-style.
      const push = (CAR.radius * 2 - 4 - d) / 2 + 1;
      const pa = Math.atan2(other.y - car.y, other.x - car.x);
      other.x += Math.cos(pa) * push;
      other.y += Math.sin(pa) * push;
    }
  }
  if (car.health <= 0 && !car.wrecked) {
    car.wrecked = true;
    explode(state, car.x, car.y);
    exitCar(state);
    setMessage(state, 'Your car is wrecked. Find another ride.');
  }
  return events;
}

function stepTraffic(state, dt) {
  for (const car of state.cars) {
    if (car.driver !== 'traffic' && car.driver !== 'courier') continue;
    if (car.wrecked) continue;
    car.turnCooldown -= dt;
    if (car.driver === 'courier') {
      stepCourier(state, car, dt);
      continue;
    }
    // Ease off for the car ahead on the same road.
    let ahead = null;
    for (const other of state.cars) {
      if (other === car || other.wrecked) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const forward = Math.cos(car.angle) * dx + Math.sin(car.angle) * dy;
      const side = Math.abs(-Math.sin(car.angle) * dx + Math.cos(car.angle) * dy);
      if (forward > 0 && forward < 80 && side < 30) ahead = other;
    }
    const target = ahead ? Math.min(CAR.trafficSpeed, Math.max(0, ahead.speed)) : CAR.trafficSpeed;
    car.speed += clamp(target - car.speed, -260 * dt, 180 * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    // At an intersection (on both a vertical and a horizontal road),
    // sometimes turn onto the cross street.
    const nearV = state.city.vertical.some((line) => Math.abs(car.x - line) < 8);
    const nearH = state.city.horizontal.some((line) => Math.abs(car.y - line) < 8);
    if (nearV && nearH && car.turnCooldown <= 0 && state.rng.chance(dt * 1.2)) {
      const turnLeft = state.rng.chance(0.5);
      car.angle += turnLeft ? -Math.PI / 2 : Math.PI / 2;
      car.axis = car.axis === 'x' ? 'y' : 'x';
      car.turnCooldown = 2;
    }
    // Wrap around the far edge so traffic never runs out.
    if (car.x < CITY.beachWidth + 40) car.x = WORLD.width - 80;
    if (car.x > WORLD.width - 40) car.x = CITY.beachWidth + 80;
    if (car.y < 40) car.y = WORLD.height - 80;
    if (car.y > WORLD.height - 40) car.y = 80;
  }
  // Traffic cars nudge each other apart instead of stacking up.
  const movers = state.cars.filter((c) => (c.driver === 'traffic' || c.driver === 'courier') && !c.wrecked);
  for (let i = 0; i < movers.length; i += 1) {
    for (let j = i + 1; j < movers.length; j += 1) {
      const a = movers[i];
      const b = movers[j];
      const d = dist(a.x, a.y, b.x, b.y);
      if (d > 0.1 && d < CAR.radius * 2 - 6) {
        const push = (CAR.radius * 2 - 6 - d) / 2;
        const pa = Math.atan2(b.y - a.y, b.x - a.x);
        a.x -= Math.cos(pa) * push;
        a.y -= Math.sin(pa) * push;
        b.x += Math.cos(pa) * push;
        b.y += Math.sin(pa) * push;
      }
    }
  }
}

function stepCourier(state, car, dt) {
  const route = state.mission && state.mission.route ? state.mission.route : null;
  if (!route) {
    car.speed = 0;
    return;
  }
  const wp = route[car.wpIndex || 0];
  if (!wp) {
    car.speed = 0;
    return;
  }
  const d = dist(car.x, car.y, wp.x, wp.y);
  if (d < 60) {
    car.wpIndex = (car.wpIndex || 0) + 1;
    if (car.wpIndex >= route.length) {
      car.speed = 0;
      return;
    }
  }
  const want = Math.atan2(wp.y - car.y, wp.x - car.x);
  car.angle += clamp(angleDiff(car.angle, want), -1.8 * dt, 1.8 * dt);
  car.speed = clamp(car.speed + 200 * dt, 0, CAR.trafficSpeed * 1.15);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  const pos = resolveCircle(state.city, car.x, car.y, CAR.radius);
  car.x = pos.x;
  car.y = pos.y;
}

function stepPeds(state, dt) {
  const player = state.player;
  for (const ped of state.peds) {
    if (ped.down > 0) {
      ped.down -= dt;
      if (ped.down <= 0) {
        ped.mode = 'walk';
        const p = randomSidewalkPoint(state.city, state.rng);
        ped.tx = p.x;
        ped.ty = p.y;
      }
      continue;
    }
    // 'wait' is the taxi fare: they stand on the plaza until picked up.
    if (ped.mode === 'wait') continue;
    const danger = state.bullets.some((b) => b.from === 'player' && dist(b.x, b.y, ped.x, ped.y) < 90)
      || (player.car && dist(player.x, player.y, ped.x, ped.y) < 130 && Math.abs(player.speed) > 150)
      || (state.wanted >= 3 && dist(player.x, player.y, ped.x, ped.y) < 160);
    if (danger && ped.mode !== 'flee') {
      ped.mode = 'flee';
      const away = Math.atan2(ped.y - player.y, ped.x - player.x);
      ped.tx = ped.x + Math.cos(away) * 320;
      ped.ty = ped.y + Math.sin(away) * 320;
    }
    if (ped.mode === 'flee' && dist(player.x, player.y, ped.x, ped.y) > 420) {
      ped.mode = 'walk';
      const p = randomSidewalkPoint(state.city, state.rng);
      ped.tx = p.x;
      ped.ty = p.y;
    }
    if (ped.mode === 'walk' && ped.wait > 0) {
      ped.wait -= dt;
      continue;
    }
    const d = dist(ped.x, ped.y, ped.tx, ped.ty);
    if (d < 24) {
      if (ped.mode === 'walk') {
        const p = randomSidewalkPoint(state.city, state.rng);
        ped.tx = p.x;
        ped.ty = p.y;
        ped.wait = state.rng.range(0, 3);
      } else {
        ped.mode = 'walk';
        const p = randomSidewalkPoint(state.city, state.rng);
        ped.tx = p.x;
        ped.ty = p.y;
      }
      continue;
    }
    const speed = ped.mode === 'flee' ? PED.fleeSpeed : ped.speed;
    const a = Math.atan2(ped.ty - ped.y, ped.tx - ped.x);
    ped.angle = a;
    ped.phase = (ped.phase || 0) + dt * speed * 0.075;
    const pos = resolveCircle(state.city, ped.x + Math.cos(a) * speed * dt, ped.y + Math.sin(a) * speed * dt, PED.radius);
    ped.x = pos.x;
    ped.y = pos.y;
  }
    // Keep the streets busy: replace peds who wandered far off.
  if (state.peds.length < 18 && state.rng.chance(dt * 0.4)) {
    const p = randomSidewalkPoint(state.city, state.rng);
    state.peds.push({
      x: p.x, y: p.y, angle: 0, speed: PED.walkSpeed, color: state.rng.pick(PED_COLORS),
      pants: state.vrng.pick(['#2b3a55', '#4a3b2a', '#333333', '#5a6b7a']),
      phase: state.vrng.range(0, Math.PI * 2),
      mode: 'walk', tx: p.x, ty: p.y, wait: 0, down: 0,
    });
  }
}

function stepPoliceCars(state, dt) {
  const player = state.player;
  for (const car of state.cars) {
    if (car.driver !== 'police' || car.wrecked) continue;
    if (car.ramTimer > 0) car.ramTimer -= dt;
    const d = dist(car.x, car.y, player.x, player.y);
    // Chase along the roads, re-planning every couple of seconds: driving
    // straight at the player cuts through buildings and gets cruisers stuck.
    car.routeTimer = (car.routeTimer ?? 0) - dt;
    if (car.routeTimer <= 0 || !car.route) {
      car.route = planRoute(state.city, car.x, car.y, player.x, player.y);
      car.routeIndex = 0;
      car.routeTimer = 2;
    }
    let wp = car.route[car.routeIndex];
    if (wp && Math.hypot(car.x - wp.x, car.y - wp.y) < 70 && car.routeIndex < car.route.length - 1) {
      car.routeIndex += 1;
      wp = car.route[car.routeIndex];
    }
    if (d < 220) wp = { x: player.x, y: player.y }; // close in: straight at them
    const want = Math.atan2(wp.y - car.y, wp.x - car.x);
    const diff = angleDiff(car.angle, want);
    car.angle += clamp(diff, -2.4 * dt, 2.4 * dt);
    // Brake into sharp turns so the cruiser makes the corner.
    const target = d > 90 ? CAR.policeSpeed * (Math.abs(diff) > 0.8 ? 0.45 : 1) : CAR.policeSpeed * 0.45;
    car.speed += clamp(target - car.speed, -500 * dt, 420 * dt);
    if (!moveCarWithSlide(state, car, dt)) {
      car.angle += 1.2 * dt;
      car.speed *= 0.8;
    }
    // A cruiser ramming the player hurts: on foot it is an arrest attempt.
    // The ram only lands about once a second, so a cruiser glued to the
    // player cannot pin the car in place step after step.
    if (d < CAR.radius + PLAYER.radius + 6 && car.ramTimer <= 0) {
      car.ramTimer = 0.9;
      state.shake = Math.min(1, (state.shake || 0) + 0.35);
      if (player.car) {
        player.car.health -= 8;
        car.speed *= 0.7;
        burst(state, car.x, car.y, '#f2c94c', 4, 120);
      } else if (player.invuln <= 0) {
        player.health -= 10;
        player.invuln = 0.4;
      }
    }
    // Cruisers far behind give up and despawn when the heat is gone.
    if (state.wanted === 0 && d > 900) {
      car.driver = 'none';
      car.wrecked = true;
    }
  }
  state.cars = state.cars.filter((c) => !(c.driver === 'none' && c.wrecked && c.kind === 'cop'));
}

function stepFootCops(state, dt) {
  const player = state.player;
  for (const cop of state.cops) {
    const d = dist(cop.x, cop.y, player.x, player.y);
    const a = Math.atan2(player.y - cop.y, player.x - cop.x);
    cop.angle = a;
    if (d > 46) {
      cop.phase = (cop.phase || 0) + dt * cop.speed * 0.075;
      const pos = resolveCircle(state.city, cop.x + Math.cos(a) * cop.speed * dt, cop.y + Math.sin(a) * cop.speed * dt, PED.radius);
      cop.x = pos.x;
      cop.y = pos.y;
    } else if (player.invuln <= 0) {
      player.health -= 16 * dt;
      player.invuln = 0.3;
    }
    cop.fireTimer -= dt;
    if (cop.fireTimer <= 0 && d < 340 && d > 60 && !player.car) {
      cop.fireTimer = COMBAT.copFireDelay + state.rng.range(0, 0.5);
      const spread = state.rng.range(-0.14, 0.14);
      burst(state, cop.x + Math.cos(a) * 20, cop.y + Math.sin(a) * 20, '#ffe66d', 3, 60, true, state.vrng);
      ejectShell(state, cop.x, cop.y, a);
      state.bullets.push({
        x: cop.x + Math.cos(a) * 18, y: cop.y + Math.sin(a) * 18,
        vx: Math.cos(a + spread) * COMBAT.bulletSpeed * 0.85, vy: Math.sin(a + spread) * COMBAT.bulletSpeed * 0.85,
        life: COMBAT.bulletLife, from: 'cop',
      });
    }
  }
  state.cops = state.cops.filter((c) => c.health > 0);
}

function stepBullets(state, dt) {
  const player = state.player;
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0) continue;
    if (buildingHit(state.city, b.x, b.y, 2)) {
      b.life = 0;
      burst(state, b.x, b.y, '#c9c9c9', 3, 90);
      continue;
    }
    if (b.from === 'player') {
      for (const cop of state.cops) {
        if (dist(b.x, b.y, cop.x, cop.y) < PED.radius + 4) {
          cop.health -= COMBAT.playerDamage;
          b.life = 0;
          burst(state, cop.x, cop.y, '#e5534b', 6, 130);
          break;
        }
      }
      if (b.life <= 0) continue;
      for (const ped of state.peds) {
        if (ped.down <= 0 && dist(b.x, b.y, ped.x, ped.y) < PED.radius + 4) {
          ped.down = 5;
          ped.mode = 'down';
          state.stats.pedsHit += 1;
          b.life = 0;
          burst(state, ped.x, ped.y, '#e5534b', 6, 130);
          addWanted(state, WANTED.hitPed);
          break;
        }
      }
      if (b.life <= 0) continue;
      for (const car of state.cars) {
        if (car.driver === 'player' || car.wrecked) continue;
        if (dist(b.x, b.y, car.x, car.y) < CAR.radius) {
          car.health -= COMBAT.playerDamage;
          b.life = 0;
          burst(state, b.x, b.y, '#f2c94c', 5, 120);
          if (car.health <= 0) {
            car.wrecked = true;
            car.driver = 'none';
            explode(state, car.x, car.y);
          }
          break;
        }
      }
    } else if (player.car === null && player.invuln <= 0 && dist(b.x, b.y, player.x, player.y) < PLAYER.radius + 3) {
      player.health -= COMBAT.copDamage;
      player.invuln = 0.5;
      b.life = 0;
      burst(state, player.x, player.y, '#e5534b', 5, 120);
    }
  }
  state.bullets = state.bullets.filter((b) => b.life > 0);
}

function stepPickups(state, dt) {
  const player = state.player;
  for (const p of state.pickups) {
    p.bob += dt;
    if (!p.active) continue;
    if (dist(player.x, player.y, p.x, p.y) < PLAYER.radius + 16) {
      p.active = false;
      if (p.kind === 'health') player.health = clamp(player.health + 40, 0, PLAYER.health);
      else if (p.kind === 'ammo') player.ammo += 18;
      else if (p.kind === 'cash') player.money += 60;
      setMessage(state, p.kind === 'health' ? '+40 health' : p.kind === 'ammo' ? '+18 ammo' : '+$60 found cash');
      state.pickupEvent = true;
    }
  }
  if (state.rng.chance(dt * 0.05)) {
    const inactive = state.pickups.filter((p) => !p.active);
    if (inactive.length > 0) inactive[0].active = true;
  }
}

function stepParticles(state, dt) {
  for (const p of state.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const s of state.skids) s.life -= dt;
  state.skids = state.skids.filter((s) => s.life > 0);
}

/** One fixed step of the whole game. `ctl` carries the frame's input. */
export function stepGame(state, ctl, dt) {
  let events = 0;
  const player = state.player;
  state.time += dt;
  state.clock += dt * 14;
  if (state.clock >= 24 * 3600) {
    state.clock -= 24 * 3600;
    state.day += 1;
  }
  if (state.messageTimer > 0) state.messageTimer -= dt;
  // Crash shake fades out steadily (1.8 per second) until it reaches zero.
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 1.8);
  if (state.over) return events;

  if (ctl.enter && !player.car) {
    const car = nearestCar(state, player.x, player.y, PLAYER.enterRange);
    if (car) events |= enterCar(state, car);
  } else if (ctl.enter && player.car) {
    events |= exitCar(state);
  }

  events |= player.car ? stepDriving(state, ctl, dt) : stepPlayerOnFoot(state, ctl, dt);
  stepTraffic(state, dt);
  stepPeds(state, dt);
  updatePolice(state, dt);
  stepPoliceCars(state, dt);
  stepFootCops(state, dt);
  stepBullets(state, dt);
  stepPickups(state, dt);
  stepParticles(state, dt);
  if (state.pickupEvent) {
    events |= EVENT_PICKUP;
    state.pickupEvent = false;
  }

  // Jobs advance here: they read the world and pay out on completion.
  const missionEvents = updateMissions(state, state.city, dt);
  events |= missionEvents;
  if (missionEvents & EVENT_MISSION) {
    state.stats.missionsDone += 1;
  }

  // Camera follows the player, eased.
  const cam = state.camera;
  cam.x += (player.x - cam.x) * Math.min(1, dt * 5);
  cam.y += (player.y - cam.y) * Math.min(1, dt * 5);

  if (player.health <= 0) {
    state.over = true;
    state.busted = true;
    state.stats.arrests += 1;
    events |= EVENT_BUSTED;
  }
  if (state.won) {
    state.over = true;
    events |= EVENT_WON;
  }
  return events;
}

/** Reset the run but keep the city: used for restart. */
export function resetRun(state) {
  const fresh = createState(state.rng, state.city);
  for (const key of Object.keys(fresh)) state[key] = fresh[key];
}
