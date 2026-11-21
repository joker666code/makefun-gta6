// The city of Port Solmar: a road grid, building blocks, a park, a beach
// and the sea on the west edge. Everything is generated from the seed, so
// the same seed always builds the same city. This file knows nothing about
// the player or the rules — it only builds the place and answers the
// geometry questions the simulation asks (is this water? does this circle
// hit a building? where is the nearest road?).

import { CITY, PALETTE, WORLD } from './config.js';
import { clamp } from './random.js';

export const WATER_X = CITY.beachWidth;

/** All road centre lines, vertical and horizontal. */
export function roadLines() {
  const vertical = [];
  const horizontal = [];
  for (let x = CITY.block * 2; x < WORLD.width; x += CITY.block) vertical.push(x);
  for (let y = CITY.block; y < WORLD.height; y += CITY.block) horizontal.push(y);
  return { vertical, horizontal };
}

function nearestLine(lines, value) {
  let best = lines[0];
  for (const line of lines) {
    if (Math.abs(line - value) < Math.abs(best - value)) best = line;
  }
  return best;
}

/** Build the city from a seeded random function. */
export function buildCity(random) {
  const { vertical, horizontal } = roadLines();
  const buildings = [];
  const trees = [];
  const park = CITY.parkAt;
  // Blocks are the gaps between roads: a block runs from one road's edge
  // to the next, so no building ever overlaps a road.
  const colEdges = [CITY.beachWidth, ...vertical, WORLD.width];
  const rowEdges = [0, ...horizontal, WORLD.height];
  // Open lots that stay free of buildings: the park, the plaza, the docks
  // yard and the marina waterfront.
  const openSpots = [
    { x: park.x, y: park.y, w: park.w, h: park.h },
    { x: 1472, y: 752, w: 296, h: 296 }, // Solmar Plaza
    { x: 292, y: 392, w: 364, h: 296 }, // Docks yard
    { x: 292, y: 1832, w: 364, h: 296 }, // Marina waterfront
  ];
  for (let ci = 0; ci < colEdges.length - 1; ci += 1) {
    for (let ri = 0; ri < rowEdges.length - 1; ri += 1) {
      const x0 = colEdges[ci] + (ci === 0 ? 8 : CITY.roadWidth / 2 + 14);
      const x1 = colEdges[ci + 1] - (ci + 1 === colEdges.length - 1 ? 16 : CITY.roadWidth / 2 + 14);
      const y0 = rowEdges[ri] + (ri === 0 ? 16 : CITY.roadWidth / 2 + 14);
      const y1 = rowEdges[ri + 1] - (ri + 1 === rowEdges.length - 1 ? 16 : CITY.roadWidth / 2 + 14);
      const blockW = x1 - x0;
      const blockH = y1 - y0;
      if (blockW < 80 || blockH < 80) continue;
      const open = openSpots.some((s) => x0 < s.x + s.w && x0 + blockW > s.x && y0 < s.y + s.h && y0 + blockH > s.y);
      if (open) continue;
      if (random.chance(0.16)) continue; // an empty lot, for variety
      const split = random.chance(0.5);
      const color = random.pick(PALETTE.building);
      if (split) {
        buildings.push({ x: x0, y: y0, w: blockW, h: blockH * 0.46, color, seed: random.int(0, 999) });
        buildings.push({ x: x0, y: y0 + blockH * 0.54, w: blockW, h: blockH * 0.46, color: random.pick(PALETTE.building), seed: random.int(0, 999) });
      } else {
        buildings.push({ x: x0, y: y0, w: blockW, h: blockH, color, seed: random.int(0, 999) });
      }
    }
  }
  // Trees in the park and along the beach promenade.
  for (let i = 0; i < 26; i += 1) {
    trees.push({ x: park.x + 24 + random() * (park.w - 48), y: park.y + 24 + random() * (park.h - 48), r: 13 + random() * 8 });
  }
  for (let y = 120; y < WORLD.height - 60; y += 130) {
    trees.push({ x: CITY.beachWidth - 26, y, r: 12 + random() * 6 });
  }
  return { buildings, trees, park, vertical, horizontal };
}

/** True when the point is in the sea (west of the beach). */
export function isWater(x) {
  return x < CITY.beachWidth - 130;
}

/** True when the point is on sand. */
export function isBeach(x) {
  return x >= CITY.beachWidth - 130 && x < CITY.beachWidth;
}

export function isPark(city, x, y) {
  return x > city.park.x && x < city.park.x + city.park.w && y > city.park.y && y < city.park.y + city.park.h;
}

/** True when the point is on a road (within half a road width of a line). */
export function isRoad(city, x, y) {
  const half = CITY.roadWidth / 2;
  for (const line of city.vertical) if (Math.abs(x - line) <= half) return true;
  for (const line of city.horizontal) if (Math.abs(y - line) <= half) return true;
  return false;
}

/** The building a circle overlaps, or null. */
export function buildingHit(city, x, y, r) {
  for (const b of city.buildings) {
    if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return b;
  }
  return null;
}

/**
 * Push a circle out of buildings and the sea, and clamp it inside the
 * world. Returns the corrected position; the caller keeps the rest.
 */
export function resolveCircle(city, x, y, r) {
  let px = clamp(x, r + 4, WORLD.width - r - 4);
  let py = clamp(y, r + 4, WORLD.height - r - 4);
  if (px < CITY.beachWidth - 130 + r) px = CITY.beachWidth - 130 + r;
  for (let pass = 0; pass < 3; pass += 1) {
    const b = buildingHit(city, px, py, r);
    if (!b) break;
    const left = px - (b.x - r);
    const right = b.x + b.w + r - px;
    const top = py - (b.y - r);
    const bottom = b.y + b.h + r - py;
    const min = Math.min(left, right, top, bottom);
    if (min === left) px = b.x - r;
    else if (min === right) px = b.x + b.w + r;
    else if (min === top) py = b.y - r;
    else py = b.y + b.h + r;
  }
  return { x: px, y: py };
}

/** A random point on a road, for traffic and police spawns. */
export function randomRoadPoint(city, random) {
  if (random.chance(0.5)) {
    const x = random.pick(city.vertical);
    return { x: x + random.range(-16, 16), y: random.range(120, WORLD.height - 120), axis: 'x' };
  }
  const y = random.pick(city.horizontal);
  return { x: random.range(CITY.beachWidth + 120, WORLD.width - 120), y: y + random.range(-16, 16), axis: 'y' };
}

/** A random point on a sidewalk beside a road, for pedestrians. */
export function randomSidewalkPoint(city, random) {
  if (random.chance(0.5)) {
    const x = random.pick(city.vertical) + (random.chance(0.5) ? 1 : -1) * (CITY.roadWidth / 2 + CITY.sidewalk);
    return { x, y: random.range(120, WORLD.height - 120) };
  }
  const y = random.pick(city.horizontal) + (random.chance(0.5) ? 1 : -1) * (CITY.roadWidth / 2 + CITY.sidewalk);
  return { x: random.range(CITY.beachWidth + 120, WORLD.width - 120), y };
}

/** The closest road point to (x, y): used to snap spawns onto the grid. */
export function nearestRoadPoint(city, x, y) {
  const vx = nearestLine(city.vertical, x);
  const hy = nearestLine(city.horizontal, y);
  if (Math.abs(x - vx) < Math.abs(y - hy)) return { x: vx, y, axis: 'x' };
  return { x, y: hy, axis: 'y' };
}

/** A road route from (fromX, fromY) to (toX, toY) as waypoints, planned
 * once: onto the nearest road, along it to the cross street nearest the
 * target, across to the target's road, then straight to the target. */
export function planRoute(city, fromX, fromY, toX, toY) {
  const start = nearestRoadPoint(city, fromX, fromY);
  const end = nearestRoadPoint(city, toX, toY);
  const route = [{ x: start.x, y: start.y }];
  if (start.axis === 'x') {
    const turnY = nearestLine(city.horizontal, end.y);
    route.push({ x: start.x, y: turnY });
    route.push({ x: end.x, y: turnY });
  } else {
    const turnX = nearestLine(city.vertical, end.x);
    route.push({ x: turnX, y: start.y });
    route.push({ x: turnX, y: end.y });
  }
  route.push({ x: end.x, y: end.y });
  route.push({ x: toX, y: toY });
  return route;
}

/** Named places the missions and the shots use. */
export const PLACES = {
  marina: { x: 330, y: 1980, label: 'Marina' },
  docks: { x: 560, y: 420, label: 'Docks' },
  plaza: { x: 1620, y: 900, label: 'Solmar Plaza' },
  hideout: { x: 2340, y: 1800, label: 'Hideout' },
  vault: { x: 1980, y: 1260, label: 'Solmar Trust' },
  start: { x: 760, y: 1060, label: 'Harbour Row' },
};
