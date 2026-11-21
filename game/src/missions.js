// The story: seven linked jobs from fixer Mara Voss and crew boss Dario
// Kent. Every job is a tiny state machine — a phase, a target point and a
// timer — and this file is the only place that understands the story. It
// pays the reward when a job finishes and opens the next one.

import { MISSIONS } from './config.js';
import { dist } from './random.js';
import { PLACES, randomRoadPoint } from './world.js';
import { makeCar } from './entities.js';

export const EVENT_MISSION = 32;

// How close the player must get to a marker for it to count.
const REACH = 90;
// Package Run and Smuggler's Run clocks, in seconds.
const PACKAGE_PICKUP_TIME = 120;
const PACKAGE_DELIVER_TIME = 100;
const SMUGGLE_TIME = 110;
// Tailing: seconds glued to the van before it gives up and parks.
const TAIL_NEEDED = 8;
const TAIL_FORGIVE = 8;

/** The courier van's loop around town for the tailing job (road to road). */
const COURIER_ROUTE = [
  { x: 1080, y: 720 }, { x: 1800, y: 720 }, { x: 1800, y: 1080 },
  { x: 1080, y: 1080 }, { x: 1080, y: 1440 }, { x: 1980, y: 1440 },
];

function pointAt(mission, place) {
  mission.target = { x: place.x, y: place.y, label: place.label };
}

function openJob(state, index) {
  const def = MISSIONS[index];
  const mission = {
    index,
    def,
    phase: 'go',
    target: null,
    timer: 0,
    tailTime: 0,
    loseTime: 0,
    hasPackage: false,
    hasCash: false,
    route: null,
    targetCar: null,
    passenger: null,
    checkpoints: null,
    checkpointIndex: 0,
  };
  switch (index) {
    case 0:
      pointAt(mission, PLACES.marina);
      mission.phase = 'drive';
      break;
    case 1:
      pointAt(mission, PLACES.docks);
      mission.phase = 'pickup';
      mission.timer = PACKAGE_PICKUP_TIME;
      break;
    case 2: {
      const spot = randomRoadPoint(state.city, state.rng);
      const van = makeCar(spot.x, spot.y, 0, '#e8e8e8', 'van', 'courier', spot.axis);
      van.wpIndex = 0;
      state.cars.push(van);
      mission.targetCar = van;
      mission.route = COURIER_ROUTE;
      mission.phase = 'tail';
      mission.target = { x: van.x, y: van.y, label: 'Courier van' };
      break;
    }
    case 3:
      mission.phase = 'hide';
      mission.target = { x: PLACES.hideout.x, y: PLACES.hideout.y, label: PLACES.hideout.label };
      state.wanted = Math.max(state.wanted, 3);
      break;
    case 4: {
      // Taxi Fare: the fare stands on the plaza and waits — they never
      // wander off, so the player can take as long as they like to arrive.
      const fare = {
        x: PLACES.plaza.x, y: PLACES.plaza.y, angle: 0,
        speed: 0, color: '#ffd166', mode: 'wait',
        tx: PLACES.plaza.x, ty: PLACES.plaza.y, wait: 0, down: 0,
      };
      state.peds.push(fare);
      mission.passenger = fare;
      mission.phase = 'pickup';
      pointAt(mission, PLACES.plaza);
      break;
    }
    case 5:
      // Smuggler's Run: three drops, in order, against one clock.
      mission.checkpoints = [PLACES.docks, PLACES.plaza, PLACES.marina];
      mission.checkpointIndex = 0;
      mission.timer = SMUGGLE_TIME;
      mission.phase = 'run';
      pointAt(mission, mission.checkpoints[0]);
      break;
    case 6:
      pointAt(mission, PLACES.vault);
      mission.phase = 'grab';
      break;
    default:
      break;
  }
  state.mission = mission;
  return mission;
}

function finishJob(state) {
  const mission = state.mission;
  const reward = mission.def.reward;
  state.player.money += reward;
  state.stats.missionsDone += 1;
  const done = mission.index;
  if (done + 1 >= MISSIONS.length) {
    state.won = true;
    state.mission = null;
    return EVENT_MISSION;
  }
  state.missionIndex = done + 1;
  openJob(state, done + 1);
  return EVENT_MISSION;
}

/** The one-line objective the HUD shows for the current job. */
export function missionObjective(state) {
  const mission = state.mission;
  if (!mission) return 'All jobs done — Port Solmar is yours.';
  switch (mission.index) {
    case 0:
      return state.player.car ? 'Drive to the marina marker' : 'Steal a car, then drive to the marina';
    case 1:
      return mission.phase === 'pickup'
        ? 'Pick up the package at the docks (on foot)'
        : 'Deliver the package to Solmar Plaza';
    case 2:
      return mission.phase === 'tail' ? 'Stay close behind the courier van' : 'The van stopped — get to it';
    case 3:
      return mission.phase === 'hide'
        ? 'Lose the police (wanted level to zero)'
        : 'Reach the hideout in the old town';
    case 4:
      return mission.phase === 'pickup'
        ? 'Pick up the passenger at Solmar Plaza (drive up in a car)'
        : 'Drop the passenger at the Marina — smooth ride, no heat';
    case 5: {
      const next = mission.checkpoints ? mission.checkpoints[mission.checkpointIndex] : null;
      return next
        ? `Drop ${mission.checkpointIndex + 1}/3: reach ${next.label} — ${Math.ceil(mission.timer)}s left`
        : 'Run the drops';
    }
    case 6:
      return mission.phase === 'grab'
        ? 'Grab the vault cash at Solmar Trust (on foot)'
        : 'Escape to the hideout with the cash';
    default:
      return mission.def.objective;
  }
}

/** Progress bar for the HUD: { label, frac 0..1 }, or null when the job has none. */
export function missionProgress(state) {
  const mission = state.mission;
  if (!mission) return null;
  if (mission.index === 2 && mission.phase === 'tail') {
    return { label: 'Tail progress', frac: Math.min(1, mission.tailTime / TAIL_NEEDED) };
  }
  if (mission.index === 4) {
    return { label: 'Taxi Fare', frac: mission.phase === 'drop' ? 0.5 : 0 };
  }
  if (mission.index === 5 && mission.checkpoints) {
    return { label: `Drops ${mission.checkpointIndex}/3`, frac: mission.checkpointIndex / 3 };
  }
  return null;
}

/**
 * Advance the current job one step. Returns EVENT_MISSION when a job
 * completes (the caller plays the jingle and shows the payout).
 */
export function updateMissions(state, city, dt) {
  if (!state.mission) {
    if (state.missionIndex >= MISSIONS.length) return 0;
    openJob(state, state.missionIndex);
    return 0;
  }
  const mission = state.mission;
  const player = state.player;
  const toTarget = mission.target ? dist(player.x, player.y, mission.target.x, mission.target.y) : Infinity;

  switch (mission.index) {
    case 0:
      if (player.car && toTarget < REACH) return finishJob(state);
      break;
    case 1:
      if (mission.phase === 'pickup') {
        mission.timer -= dt;
        if (!player.car && toTarget < 60) {
          mission.hasPackage = true;
          mission.phase = 'deliver';
          mission.timer = PACKAGE_DELIVER_TIME;
          pointAt(mission, PLACES.plaza);
        } else if (mission.timer <= 0) {
          mission.timer = PACKAGE_PICKUP_TIME;
        }
      } else if (mission.phase === 'deliver') {
        mission.timer -= dt;
        if (toTarget < REACH) return finishJob(state);
        if (mission.timer <= 0) {
          mission.phase = 'pickup';
          mission.hasPackage = false;
          mission.timer = PACKAGE_PICKUP_TIME;
          pointAt(mission, PLACES.docks);
        }
      }
      break;
    case 2: {
      const van = mission.targetCar;
      if (!van || van.wrecked) return finishJob(state);
      mission.target = { x: van.x, y: van.y, label: 'Courier van' };
      const toVan = dist(player.x, player.y, van.x, van.y);
      if (mission.phase === 'tail') {
        if (player.car && toVan < 230) {
          mission.tailTime += dt;
          mission.loseTime = 0;
        } else {
          mission.loseTime += dt;
          if (mission.loseTime > TAIL_FORGIVE) mission.tailTime = Math.max(0, mission.tailTime - dt * 2);
        }
        if (mission.tailTime >= TAIL_NEEDED) {
          mission.phase = 'stop';
          van.driver = 'park';
          van.speed = 0;
        }
      } else if (toVan < 80) {
        return finishJob(state);
      }
      break;
    }
    case 3:
      if (mission.phase === 'hide') {
        if (state.wanted === 0) {
          mission.phase = 'goto';
          pointAt(mission, PLACES.hideout);
        }
      } else if (toTarget < REACH) {
        return finishJob(state);
      }
      break;
    case 4:
      if (mission.phase === 'pickup') {
        if (player.car && toTarget < 70) {
          // The fare climbs in: off the street, on to the marina.
          state.peds = state.peds.filter((p) => p !== mission.passenger);
          mission.phase = 'drop';
          pointAt(mission, PLACES.marina);
        }
      } else if (toTarget < REACH) {
        return finishJob(state);
      }
      break;
    case 5:
      mission.timer -= dt;
      if (toTarget < REACH) {
        mission.checkpointIndex += 1;
        if (mission.checkpointIndex >= mission.checkpoints.length) return finishJob(state);
        pointAt(mission, mission.checkpoints[mission.checkpointIndex]);
      } else if (mission.timer <= 0) {
        // Clock ran out: the whole run restarts from the first drop.
        mission.checkpointIndex = 0;
        mission.timer = SMUGGLE_TIME;
        pointAt(mission, mission.checkpoints[0]);
      }
      break;
    case 6:
      if (mission.phase === 'grab') {
        if (!player.car && toTarget < 60) {
          mission.hasCash = true;
          mission.phase = 'escape';
          pointAt(mission, PLACES.hideout);
          state.wanted = 4;
          state.quietTimer = 0;
        }
      } else if (toTarget < REACH) {
        return finishJob(state);
      }
      break;
    default:
      break;
  }
  return 0;
}
