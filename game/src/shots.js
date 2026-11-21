// The screenshot scenes behind ?shot=start|play|chase|mission. Each one
// plays the real rules forward from a fresh world for a fixed number of
// steps, steered by a simple autopilot (drive toward the objective, back
// up when stuck), so the frame is what a short game really looks like
// and the same seed always gives the same frame.

import { CAR, STEP } from './config.js';
import { angleDiff, clamp } from './random.js';
import { makeCar, resetRun } from './entities.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { PLACES, buildingHit, isRoad, nearestRoadPoint, planRoute } from './world.js';

const SAMPLE = STEP;

/** Put the player in the nearest car, on the spot, for a staged scene. */
function putPlayerInCar(state) {
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (car.wrecked || car.driver === 'police') continue;
    // Never stage the player in a car already wedged into a building
    // corner: its collision circle overlaps the wall and no move can
    // free it, so the scene would open on a car that cannot drive.
    if (buildingHit(state.city, car.x, car.y, CAR.radius)) continue;
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
  if (stuck.escape > 0) {
    // Escape: back up for a fixed stretch, alternating the steer side
    // each episode so a repeated wedge gets a different way out.
    const dir = (stuck.episode || 0) % 2 === 0 ? -1 : 1;
    return { mx: dir * steer, my: 1, run: false, enter: false, melee: false, firing: false };
  }
  // Brake into a sharp turn so the car makes the corner instead of
  // overshooting into the building on the far side.
  const throttle = Math.abs(diff) > 0.5 && Math.abs(car.speed) > 120 ? 0.5 : -1;
  return { mx: steer, my: throttle, run: false, enter: false, melee: false, firing: false };
}

/** Step the world for `seconds`, steering the player along the road route.
 * `stopWhen`, if given, ends the leg early the moment it returns true —
 * the return-to-road leg uses it to stop the instant the car is back on
 * asphalt instead of overshooting and oscillating around the target. */
function simulate(state, step, seconds, tx, ty, stopWhen) {
  const stuck = { time: 0, escape: 0, episode: 0 };
  // planRoute lives in world.js and is also what the police use to chase:
  // one route, planned once, so the car never re-snaps at an intersection.
  const route = { points: planRoute(state.city, state.player.x, state.player.y, tx, ty), index: 0 };
  for (let t = 0; t < seconds; t += SAMPLE) {
    const ctl = driveCtl(state, tx, ty, stuck, route);
    step(state, ctl, SAMPLE);
    if (stopWhen && stopWhen(state)) break;
    const wp = route.points[route.index];
    if (wp && Math.hypot(state.player.x - wp.x, state.player.y - wp.y) < 100 && route.index < route.points.length - 1) {
      route.index += 1;
      stuck.time = 0; // reaching a waypoint proves the car is not stuck
    }
    if (stuck.escape > 0) {
      stuck.escape -= SAMPLE;
      if (stuck.escape <= 0) {
        // The escape is over: re-plan from where the car ended up, so a
        // wedge against one corner does not send it back to the same one.
        route.points = planRoute(state.city, state.player.x, state.player.y, tx, ty);
        route.index = 0;
        stuck.episode += 1;
        stuck.time = 0;
      }
      continue;
    }
    if (state.player.car && Math.abs(state.player.car.speed) < 25) stuck.time += SAMPLE;
    else stuck.time = 0;
    if (stuck.time > 1.0) stuck.escape = 1.6;
  }
}

/** Drive the player car back onto the nearest road so the closing frame
 * shows it on asphalt, not parked on the marina lot or the plaza tiles
 * where the marker sits. The job is already complete by then, so the
 * money and JOB counter the frame shows do not change. */
function returnToRoad(state, step) {
  if (!state.player.car) return;
  const spot = nearestRoadPoint(state.city, state.player.x, state.player.y);
  simulate(state, step, 5, spot.x, spot.y,
    () => state.player.car && isRoad(state.city, state.player.x, state.player.y));
}

/** True when the courier van is on the same road ahead of the player
 * car, 200–400px out — close enough to read as the car being tailed,
 * far enough that the tail timer (which needs <230px) barely moves —
 * and no cruiser is glued to it, so the frame does not catch a police
 * car stacked on top of the van. */
function courierAhead(state) {
  const van = state.mission && state.mission.targetCar;
  const car = state.player.car;
  if (!van || van.wrecked || !car) return false;
  const dx = van.x - car.x;
  const dy = van.y - car.y;
  const d = Math.hypot(dx, dy);
  if (d > 400 || d < 200) return false;
  const ahead = Math.cos(car.angle) * dx + Math.sin(car.angle) * dy;
  if (ahead <= 0) return false;
  if (Math.abs(van.y - car.y) >= 40 && Math.abs(van.x - car.x) >= 40) return false;
  for (const other of state.cars) {
    if (other.driver === 'police' && !other.wrecked && Math.hypot(other.x - van.x, other.y - van.y) < 130) return false;
  }
  return true;
}

/** Frame the tailing job's closing shot: stage the player car on the
 * van's eastbound leg (the top of its loop, y=720, facing east), then
 * wait for the van to come round onto the same road ahead. If the van
 * has already parked at the end of its loop, drive to a spot on its
 * road 300px short of it instead. The job stays JOB 3/7 either way. */
function frameCourier(state, step) {
  const van = state.mission && state.mission.targetCar;
  if (!van || !state.player.car) return;
  simulate(state, step, 12, 1750, 720, () => courierAhead(state));
  if (courierAhead(state)) return;
  const idle = { mx: 0, my: 0, run: false, enter: false, melee: false, firing: false };
  for (let t = 0; t < 45; t += SAMPLE) {
    step(state, idle, SAMPLE);
    if (courierAhead(state)) return;
    if (!state.mission || state.mission.phase !== 'tail') return;
  }
  const v = state.mission && state.mission.targetCar;
  if (v && !v.wrecked) {
    const onH = Math.abs(v.y - 1440) < 60; // parked at the loop's end
    simulate(state, step, 12, onH ? v.x - 300 : v.x, onH ? v.y : v.y - 300,
      () => courierAhead(state));
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
    returnToRoad(state, step);
    return { screen: SCREEN_PLAY, best: 0 };
  }
  if (name === 'chase') {
    // Night chase in the rain: 21:00, lamps and headlights on, wet roads.
    state.clock = 21 * 3600;
    state.rain = 0.6;
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
    returnToRoad(state, step);
    frameCourier(state, step);
    return { screen: SCREEN_PLAY, best: 0 };
  }
  // start: morning on Harbour Row, on foot beside a parked car. The camera
  // sits off-centre so the player shows beside the title panel, not under it,
  // and the panel's narrower width leaves a car or a pedestrian visible
  // in the margin on the far side.
  state.clock = 9 * 3600;
  for (let i = 0; i < 5 / SAMPLE; i += 1) {
    step(state, { mx: 0, my: 0, run: false, enter: false, melee: false, firing: false }, SAMPLE);
  }
  state.camera.x = state.player.x + 500;
  state.camera.y = state.player.y;
  return { screen: SCREEN_TITLE, best: 0 };
}
