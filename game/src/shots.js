// The screenshot scenes behind ?shot=start|play|chase|mission. Each one
// plays the real rules forward from a fresh world for a fixed number of
// steps, steered by a simple autopilot (drive toward the objective, back
// up when stuck), so the frame is what a short game really looks like
// and the same seed always gives the same frame.

import { CAR, STEP } from './config.js';
import { angleDiff, clamp } from './random.js';
import { makeCar, resetRun } from './entities.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { PLACES, nearestRoadPoint, planRoute } from './world.js';

const SAMPLE = STEP;

/** Put the player in the nearest car, on the spot, for a staged scene. */
function putPlayerInCar(state) {
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (car.wrecked || car.driver === 'police') continue;
    const d = Math.hypot(car.x - state.player.x, car.y - state.player.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  if (!best) return;
  state.player.x = best.x;
  state.player.y = best.y;
  best.driver = 'player';
  best.parked = false;
  state.player.car = best;
}

/** A police cruiser on the road nearest the player, already in pursuit. */
function addPoliceCruiser(state, dx, dy) {
  const spot = nearestRoadPoint(state.city, state.player.x + dx, state.player.y + dy);
  const car = makeCar(spot.x, spot.y, Math.atan2(-dy, -dx), '#f4f6f8', 'cop', 'police', spot.axis);
  car.speed = CAR.policeSpeed * 0.8;
  state.cars.push(car);
}

/** Drive toward a point: forward throttle, steer by the angle to it. */
function driveCtl(state, tx, ty, stuck, route) {
  const car = state.player.car;
  if (!car) {
    const dx = tx - state.player.x;
    const dy = ty - state.player.y;
    const len = Math.hypot(dx, dy) || 1;
    return { mx: dx / len, my: dy / len, run: false, enter: false, melee: false, firing: false };
  }
  const wp = route.points[route.index];
  const want = Math.atan2(wp.y - car.y, wp.x - car.x);
  const diff = angleDiff(car.angle, want);
  const steer = clamp(diff * 1.8, -1, 1);
  if (stuck.time > 1.2) {
    return { mx: -steer, my: 1, run: false, enter: false, melee: false, firing: false };
  }
  // Brake into a sharp turn so the car makes the corner instead of
  // overshooting into the building on the far side.
  const throttle = Math.abs(diff) > 0.7 && Math.abs(car.speed) > 150 ? 0.5 : -1;
  return { mx: steer, my: throttle, run: false, enter: false, melee: false, firing: false };
}

/** Step the world for `seconds`, steering the player along the road route. */
function simulate(state, step, seconds, tx, ty) {
  const stuck = { time: 0 };
  // planRoute lives in world.js and is also what the police use to chase:
  // one route, planned once, so the car never re-snaps at an intersection.
  const route = { points: planRoute(state.city, state.player.x, state.player.y, tx, ty), index: 0 };
  for (let t = 0; t < seconds; t += SAMPLE) {
    const ctl = driveCtl(state, tx, ty, stuck, route);
    step(state, ctl, SAMPLE);
    const wp = route.points[route.index];
    if (wp && Math.hypot(state.player.x - wp.x, state.player.y - wp.y) < 70 && route.index < route.points.length - 1) {
      route.index += 1;
      stuck.time = 0; // reaching a waypoint proves the car is not stuck
    }
    if (state.player.car && Math.abs(state.player.car.speed) < 25) stuck.time += SAMPLE;
    else stuck.time = 0;
    if (stuck.time > 2.2) stuck.time = 0;
  }
}

/**
 * Set the world to the named scene (start, play, chase or mission; any
 * other name is start) and return the screen to draw over it.
 */
export function stageShot(name, state, step) {
  resetRun(state);
  if (name === 'play') {
    state.clock = 11 * 3600;
    putPlayerInCar(state);
    const target = state.mission && state.mission.target ? state.mission.target : PLACES.marina;
    simulate(state, step, 24, target.x, target.y);
    return { screen: SCREEN_PLAY, best: 0 };
  }
  if (name === 'chase') {
    state.clock = 18 * 3600 + 1800;
    putPlayerInCar(state);
    state.wanted = 3;
    addPoliceCruiser(state, -320, -180);
    addPoliceCruiser(state, 260, 300);
    simulate(state, step, 13, PLACES.hideout.x, PLACES.hideout.y);
    return { screen: SCREEN_PLAY, best: 0 };
  }
  if (name === 'mission') {
    state.clock = 12 * 3600;
    state.missionIndex = 1;
    state.mission = null;
    // Start job 2, then jump it to the delivery leg with the package aboard.
    step(state, { mx: 0, my: 0, run: false, enter: false, melee: false, firing: false }, SAMPLE);
    if (state.mission) {
      state.mission.phase = 'deliver';
      state.mission.hasPackage = true;
      state.mission.timer = 100;
      state.mission.target = { x: PLACES.plaza.x, y: PLACES.plaza.y, label: PLACES.plaza.label };
    }
    state.player.x = PLACES.docks.x + 60;
    state.player.y = PLACES.docks.y + 40;
    putPlayerInCar(state);
    simulate(state, step, 15, PLACES.plaza.x, PLACES.plaza.y);
    return { screen: SCREEN_PLAY, best: 0 };
  }
  // start: morning on Harbour Row, on foot beside a parked car. The camera
  // sits off-centre so the player shows beside the title panel, not under it.
  state.clock = 9 * 3600;
  for (let i = 0; i < 5 / SAMPLE; i += 1) {
    step(state, { mx: 0, my: 0, run: false, enter: false, melee: false, firing: false }, SAMPLE);
  }
  state.camera.x = state.player.x + 420;
  state.camera.y = state.player.y;
  return { screen: SCREEN_TITLE, best: 0 };
}
