// The story: five linked jobs from fixer Mara Voss and crew boss Dario
// Kent. Each mission is a small state machine — a phase, a target point
// on the map and a timer — and this file is the only place that knows
// the story. It pays out on completion and starts the next job.

import { MISSIONS } from './config.js';
import { dist } from './random.js';
import { PLACES, randomRoadPoint } from './world.js';
import { makeCar } from './entities.js';

export const EVENT_MISSION = 32;

const REACH = 90;

/** The courier van's loop around town for the tailing job (road to road). */
const COURIER_ROUTE = [
  { x: 1080, y: 720 }, { x: 1800, y: 720 }, { x: 1800, y: 1080 },
  { x: 1080, y: 1080 }, { x: 1080, y: 1440 }, { x: 1980, y: 1440 },
];

function setTarget(mission, place) {
  mission.target = { x: place.x, y: place.y, label: place.label };
}

function startMission(state, index) {
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
  };
  if (index === 0) {
    setTarget(mission, PLACES.marina);
    mission.phase = 'drive';
  } else if (index === 1) {
    setTarget(mission, PLACES.docks);
    mission.phase = 'pickup';
    mission.timer = 120;
  } else if (index === 2) {
    const p = randomRoadPoint(state.city, state.rng);
    const van = makeCar(p.x, p.y, 0, '#e8e8e8', 'van', 'courier', p.axis);
    van.wpIndex = 0;
    state.cars.push(van);
    mission.targetCar = van;
    mission.route = COURIER_ROUTE;
    mission.phase = 'tail';
    mission.target = { x: van.x, y: van.y, label: 'Courier van' };
  } else if (index === 3) {
    mission.phase = 'hide';
    mission.target = { x: PLACES.hideout.x, y: PLACES.hideout.y, label: PLACES.hideout.label };
    state.wanted = Math.max(state.wanted, 3);
  } else if (index === 4) {
    setTarget(mission, PLACES.vault);
    mission.phase = 'grab';
  }
  state.mission = mission;
  return mission;
}

function completeMission(state) {
  const mission = state.mission;
  const reward = mission.def.reward;
  state.player.money += reward;
  state.stats.missionsDone += 1;
  const doneIndex = mission.index;
  if (doneIndex + 1 >= MISSIONS.length) {
    state.won = true;
    state.mission = null;
    return EVENT_MISSION;
  }
  state.missionIndex = doneIndex + 1;
  startMission(state, doneIndex + 1);
  return EVENT_MISSION;
}

/** The one-line objective the HUD shows for the current job. */
export function missionObjective(state) {
  const mission = state.mission;
  if (!mission) return 'All jobs done — Port Solmar is yours.';
  const def = mission.def;
  if (mission.index === 0) return state.player.car ? 'Drive to the marina marker' : 'Steal a car, then drive to the marina';
  if (mission.index === 1) {
    return mission.phase === 'pickup' ? 'Pick up the package at the docks (on foot)' : 'Deliver the package to Solmar Plaza';
  }
  if (mission.index === 2) return mission.phase === 'tail' ? 'Stay close behind the courier van' : 'The van stopped — get to it';
  if (mission.index === 3) return mission.phase === 'hide' ? 'Lose the police (wanted level to zero)' : 'Reach the hideout in the old town';
  if (mission.index === 4) return mission.phase === 'grab' ? 'Grab the vault cash at Solmar Trust (on foot)' : 'Escape to the hideout with the cash';
  return def.objective;
}

/**
 * Advance the current mission one step. Returns EVENT_MISSION when a job
 * completes (the caller plays the jingle and shows the payout).
 */
export function updateMissions(state, city, dt) {
  if (!state.mission) {
    if (state.missionIndex >= MISSIONS.length) return 0;
    startMission(state, state.missionIndex);
    return 0;
  }
  const mission = state.mission;
  const player = state.player;
  const dTarget = mission.target ? dist(player.x, player.y, mission.target.x, mission.target.y) : Infinity;

  if (mission.index === 0) {
    if (player.car && dTarget < REACH) return completeMission(state);
  } else if (mission.index === 1) {
    if (mission.phase === 'pickup') {
      mission.timer -= dt;
      if (!player.car && dTarget < 60) {
        mission.hasPackage = true;
        mission.phase = 'deliver';
        mission.timer = 100;
        setTarget(mission, PLACES.plaza);
      } else if (mission.timer <= 0) {
        mission.timer = 120;
      }
    } else if (mission.phase === 'deliver') {
      mission.timer -= dt;
      if (dTarget < REACH) return completeMission(state);
      if (mission.timer <= 0) {
        mission.phase = 'pickup';
        mission.hasPackage = false;
        mission.timer = 120;
        setTarget(mission, PLACES.docks);
      }
    }
  } else if (mission.index === 2) {
    const van = mission.targetCar;
    if (!van || van.wrecked) return completeMission(state);
    mission.target = { x: van.x, y: van.y, label: 'Courier van' };
    const dVan = dist(player.x, player.y, van.x, van.y);
    if (mission.phase === 'tail') {
      if (player.car && dVan < 230) {
        mission.tailTime += dt;
        mission.loseTime = 0;
      } else {
        mission.loseTime += dt;
        if (mission.loseTime > 8) mission.tailTime = Math.max(0, mission.tailTime - dt * 2);
      }
      if (mission.tailTime >= 8) {
        mission.phase = 'stop';
        van.driver = 'park';
        van.speed = 0;
      }
    } else if (dVan < 80) {
      return completeMission(state);
    }
  } else if (mission.index === 3) {
    if (mission.phase === 'hide') {
      if (state.wanted === 0) {
        mission.phase = 'goto';
        setTarget(mission, PLACES.hideout);
      }
    } else if (dTarget < REACH) {
      return completeMission(state);
    }
  } else if (mission.index === 4) {
    if (mission.phase === 'grab') {
      if (!player.car && dTarget < 60) {
        mission.hasCash = true;
        mission.phase = 'escape';
        setTarget(mission, PLACES.hideout);
        state.wanted = 4;
        state.quietTimer = 0;
      }
    } else if (dTarget < REACH) {
      return completeMission(state);
    }
  }
  return 0;
}
