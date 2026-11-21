// Drawing only: the city, the cars and people in it, the HUD with its
// minimap, and the menu screens. The camera follows the player across
// the 2880x2160 city; a 1280x720 view is scaled to fit the window.
//
// Art direction: a sun-soaked coastal city rendered in layered Canvas 2D —
// soft shadows under everything, glass and trim on every car, roof
// furniture and lit windows on the buildings, street furniture on the
// roads, and a real night mode with lamp pools and headlight cones.

import { CAR, CAR_MODELS, CITY, FONT, FONT_DISPLAY, JOB_COUNT, PALETTE, PED, PLAYER, VIEW, WORLD } from './config.js';
import { angleDiff, clamp } from './random.js';
import { PLACES } from './world.js';
import { missionObjective, missionProgress } from './missions.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const MINIMAP = { x: VIEW.width - 250, y: 26, w: 236, h: 176 };

// The three boats anchored in the bay (x, y, hull colour).
const BOATS = [[70, 480, '#f4f6f8'], [100, 1420, '#e8b73d'], [55, 980, '#d94f3d']];
// The named places dotted on the minimap (place, colour).
const PLACE_DOTS = [
  [PLACES.marina, '#4fc3f7'], [PLACES.plaza, '#f2c94c'], [PLACES.docks, '#ffffff'],
  [PLACES.hideout, '#7ed957'], [PLACES.vault, '#e5534b'],
];
// Shop signs painted on a few rooftops, picked by building hash.
const SIGNS = ['CAFE', 'HOTEL', 'BANK', 'PIZZA', 'BAR', 'SHOP', 'GYM', 'CLUB'];

/** A cheap deterministic hash in [0, 1) for window placement on roofs. */
function hash(n) {
  let x = (n * 2654435761) | 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0x5bd1e995);
  x ^= x >>> 15;
  return ((x >>> 0) % 1000) / 1000;
}

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

/** 0 by day, 1 at full night; dusk and dawn blend in between. */
function nightFactor(clock) {
  const h = (clock / 3600) % 24;
  if (h >= 19.5 || h < 5.5) return 1;
  if (h >= 17 && h < 19.5) return ((h - 17) / 2.5) * 0.85;
  if (h >= 5.5 && h < 7) return 0.85 * (1 - (h - 5.5) / 1.5);
  return 0;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW.width, height / VIEW.height);
    view.x = (width - VIEW.width * view.scale) / 2;
    view.y = (height - VIEW.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, bold, display, spacing) {
    const key = `${size}${bold ? 'b' : ''}${display ? 'd' : ''}`;
    if (!fonts.has(key)) fonts.set(key, `${bold ? '700 ' : ''}${size}px ${display ? FONT_DISPLAY : FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align ?? 'left';
    context.textBaseline = 'alphabetic';
    try { context.letterSpacing = spacing ? `${spacing}px` : '0px'; } catch { /* older canvas */ }
    context.fillText(value, x, y);
    try { context.letterSpacing = '0px'; } catch { /* older canvas */ }
  }

  /** Text with a dark outline, readable over any ground. */
  function textOutlined(value, x, y, size, color, align, bold) {
    const key = `${size}${bold ? 'b' : ''}o`;
    if (!fonts.has(key)) fonts.set(key, `${bold ? '700 ' : ''}${size}px ${FONT}`);
    context.font = fonts.get(key);
    context.textAlign = align ?? 'left';
    context.textBaseline = 'alphabetic';
    context.lineWidth = 4;
    context.strokeStyle = 'rgba(10,14,20,0.85)';
    context.strokeText(value, x, y);
    context.fillStyle = color;
    context.fillText(value, x, y);
  }

  /** Rounded-rect path (call fill or stroke after). */
  function rr(x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  /** A five-point star path centred at (x, y). */
  function starPath(x, y, r) {
    context.beginPath();
    for (let p = 0; p < 10; p += 1) {
      const a = -Math.PI / 2 + (p * Math.PI) / 5;
      const rad = p % 2 === 0 ? r : r * 0.45;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (p === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
  }

  /** A little keyboard-key chip, for the control hints. */
  function keyChip(label, x, y) {
    const w = 8 + label.length * 8;
    context.fillStyle = 'rgba(255,255,255,0.14)';
    rr(x, y - 13, w, 17, 4);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.35)';
    context.lineWidth = 1;
    rr(x, y - 13, w, 17, 4);
    context.stroke();
    text(label, x + w / 2, y, 11, '#f2f4f0', 'center', true);
    return w;
  }

  function clockText(clock) {
    const h = Math.floor(clock / 3600) % 24;
    const m = Math.floor((clock % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function drawWorld(state) {
    const city = state.city;
    const cam = state.camera;
    const vx0 = clamp(cam.x - VIEW.width / 2, 0, WORLD.width - VIEW.width);
    const vy0 = clamp(cam.y - VIEW.height / 2, 0, WORLD.height - VIEW.height);
    const vx1 = vx0 + VIEW.width;
    const vy1 = vy0 + VIEW.height;
    const nf = nightFactor(state.clock);

    // Grass base: mown stripes plus a deterministic speckle so the ground
    // is never one flat colour.
    context.fillStyle = PALETTE.grass;
    context.fillRect(vx0, vy0, VIEW.width, VIEW.height);
    context.fillStyle = PALETTE.grassDark;
    for (let y = Math.floor(vy0 / 120) * 120; y < vy1; y += 240) {
      context.fillRect(vx0, y, VIEW.width, 120);
    }
    context.fillStyle = 'rgba(255,255,255,0.05)';
    for (let gx = Math.floor(vx0 / 90) * 90; gx < vx1; gx += 90) {
      for (let gy = Math.floor(vy0 / 90) * 90; gy < vy1; gy += 90) {
        if (hash(gx * 0.37 + gy * 1.13) < 0.5) context.fillRect(gx + hash(gx + gy) * 60, gy + hash(gx * 2 + gy) * 60, 14, 5);
      }
    }

    // Sea and beach on the west edge: deep-to-shallow gradient, moving
    // wave crests, sun glints by day, boats with sails and reflections.
    if (vx0 < CITY.beachWidth) {
      const seaW = Math.min(CITY.beachWidth - 130, vx1) - vx0;
      if (seaW > 0) {
        const seaGrad = context.createLinearGradient(vx0, 0, vx0 + seaW + 130, 0);
        seaGrad.addColorStop(0, PALETTE.waterDeep);
        seaGrad.addColorStop(0.55, PALETTE.water);
        seaGrad.addColorStop(1, PALETTE.waterShallow);
        context.fillStyle = seaGrad;
        context.fillRect(vx0, vy0, seaW + 130, VIEW.height);
      }
      context.strokeStyle = 'rgba(255,255,255,0.35)';
      context.lineWidth = 2;
      for (let y = Math.floor(vy0 / 90) * 90; y < vy1; y += 90) {
        const wob = Math.sin(state.time * 1.4 + y * 0.05) * 6;
        context.beginPath();
        context.moveTo(20, y + wob);
        context.quadraticCurveTo(70, y + 8, 120, y + wob);
        context.stroke();
      }
      // Sun glints on the water, drifting with time.
      if (nf < 0.5) {
        context.fillStyle = 'rgba(255,255,255,0.35)';
        for (let i = 0; i < 14; i += 1) {
          const gx = 20 + hash(i * 7 + Math.floor(state.time * 2)) * 110;
          const gy = vy0 + hash(i * 13 + 5) * VIEW.height;
          context.fillRect(gx, gy, 10 + hash(i) * 14, 2);
        }
      }
      for (const [bx, by, bc] of BOATS) {
        if (bx < vx0 - 60 || bx > vx1 + 60 || by < vy0 - 60 || by > vy1 + 60) continue;
        const bob = Math.sin(state.time * 1.1 + by * 0.01) * 4;
        // Reflection streak under the hull.
        context.fillStyle = 'rgba(255,255,255,0.18)';
        context.fillRect(bx - 20, by + bob + 12, 40, 3);
        context.fillStyle = bc;
        context.beginPath();
        context.ellipse(bx, by + bob, 26, 10, 0.2, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = shade(bc, -40);
        context.beginPath();
        context.ellipse(bx, by + bob + 3, 22, 7, 0.2, 0, Math.PI);
        context.fill();
        context.fillStyle = '#5c5148';
        context.fillRect(bx - 2, by + bob - 22, 3, 22);
        context.fillStyle = 'rgba(244,246,248,0.9)';
        context.beginPath();
        context.moveTo(bx + 1, by + bob - 22);
        context.lineTo(bx + 16, by + bob - 4);
        context.lineTo(bx + 1, by + bob - 4);
        context.closePath();
        context.fill();
      }
      // Sand with a darker wet band at the waterline, speckles, umbrellas.
      const sandX0 = Math.max(vx0, CITY.beachWidth - 130);
      const sandX1 = Math.min(CITY.beachWidth, vx1);
      if (sandX1 > sandX0) {
        const sandGrad = context.createLinearGradient(sandX0, 0, sandX1, 0);
        sandGrad.addColorStop(0, PALETTE.sandDark);
        sandGrad.addColorStop(1, PALETTE.sand);
        context.fillStyle = sandGrad;
        context.fillRect(sandX0, vy0, sandX1 - sandX0, VIEW.height);
        context.fillStyle = 'rgba(120,90,40,0.25)';
        for (let sy = Math.floor(vy0 / 70) * 70; sy < vy1; sy += 70) {
          if (hash(sy * 0.31) < 0.6) context.fillRect(sandX0 + 14 + hash(sy) * 80, sy, 5, 3);
        }
      }
      for (const u of city.umbrellas || []) {
        if (u.x < vx0 - 40 || u.x > vx1 + 40 || u.y < vy0 - 40 || u.y > vy1 + 40) continue;
        context.fillStyle = 'rgba(0,0,0,0.2)';
        context.beginPath();
        context.ellipse(u.x + 4, u.y + 5, 18, 7, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = u.color;
        context.beginPath();
        context.arc(u.x, u.y, 16, Math.PI, 0);
        context.closePath();
        context.fill();
        context.fillStyle = 'rgba(255,255,255,0.75)';
        context.beginPath();
        context.moveTo(u.x, u.y);
        context.lineTo(u.x - 8, u.y - 14);
        context.lineTo(u.x + 8, u.y - 14);
        context.closePath();
        context.fill();
        context.fillStyle = '#ffffff';
        context.fillRect(u.x + 16, u.y + 8, 22, 9);
      }
      // Promenade: a pale walkway between sand and grass.
      context.fillStyle = '#cfc4a8';
      context.fillRect(Math.max(vx0, CITY.beachWidth - 8), vy0, Math.min(CITY.beachWidth + 8, vx1) - Math.max(vx0, CITY.beachWidth - 8), VIEW.height);
    }

    // The park: lawn, crossing paths, a pond and benches.
    context.fillStyle = PALETTE.park;
    context.fillRect(city.park.x, city.park.y, city.park.w, city.park.h);
    context.fillStyle = PALETTE.parkPath;
    context.fillRect(city.park.x + city.park.w / 2 - 10, city.park.y, 20, city.park.h);
    context.fillRect(city.park.x, city.park.y + city.park.h / 2 - 10, city.park.w, 20);
    context.fillStyle = PALETTE.water;
    context.beginPath();
    context.ellipse(city.park.x + city.park.w * 0.28, city.park.y + city.park.h * 0.3, 42, 26, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = PALETTE.waterShallow;
    context.beginPath();
    context.ellipse(city.park.x + city.park.w * 0.28, city.park.y + city.park.h * 0.3, 30, 17, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#4a7d3a';
    context.lineWidth = 3;
    context.strokeRect(city.park.x, city.park.y, city.park.w, city.park.h);

    // Solmar Plaza: paving tiles, a ringed fountain, benches.
    context.fillStyle = '#b9b3a4';
    context.fillRect(1472, 752, 296, 296);
    context.strokeStyle = 'rgba(0,0,0,0.12)';
    context.lineWidth = 1;
    for (let gx = 1472 + 37; gx < 1768; gx += 37) {
      context.beginPath();
      context.moveTo(gx, 752);
      context.lineTo(gx, 1048);
      context.stroke();
    }
    for (let gy = 752 + 37; gy < 1048; gy += 37) {
      context.beginPath();
      context.moveTo(1472, gy);
      context.lineTo(1768, gy);
      context.stroke();
    }
    context.fillStyle = '#8f887a';
    context.beginPath();
    context.arc(1620, 900, 40, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = PALETTE.water;
    context.beginPath();
    context.arc(1620, 900, 34, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.6)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(1620, 900, 24 + Math.sin(state.time * 2) * 3, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#e8e4d8';
    context.beginPath();
    context.arc(1620, 900, 12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#7a6a4f';
    for (const [bx, by] of [[1520, 790], [1700, 790], [1520, 1000], [1700, 1000]]) {
      context.fillRect(bx, by, 34, 10);
    }

    // Docks yard: stacked crates.
    for (const c of city.crates || []) {
      context.fillStyle = 'rgba(0,0,0,0.25)';
      context.fillRect(c.x + 3, c.y + 4, c.s, c.s);
      context.fillStyle = c.color;
      context.fillRect(c.x, c.y, c.s, c.s);
      context.strokeStyle = 'rgba(0,0,0,0.35)';
      context.lineWidth = 2;
      context.strokeRect(c.x, c.y, c.s, c.s);
      context.beginPath();
      context.moveTo(c.x, c.y);
      context.lineTo(c.x + c.s, c.y + c.s);
      context.moveTo(c.x + c.s, c.y);
      context.lineTo(c.x, c.y + c.s);
      context.stroke();
    }

    // Roads: sidewalk edge, asphalt with edge lines, centre dashes,
    // zebra crossings and stop lines at every intersection in view,
    // parking bays along the kerb.
    for (const line of city.vertical) {
      if (line < vx0 - 60 || line > vx1 + 60) continue;
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(line - CITY.roadWidth / 2 - CITY.sidewalk, vy0, CITY.roadWidth + CITY.sidewalk * 2, VIEW.height);
      context.fillStyle = PALETTE.sidewalkDark;
      context.fillRect(line - CITY.roadWidth / 2 - CITY.sidewalk, vy0, 3, VIEW.height);
      context.fillRect(line + CITY.roadWidth / 2 + CITY.sidewalk - 3, vy0, 3, VIEW.height);
      context.fillStyle = PALETTE.road;
      context.fillRect(line - CITY.roadWidth / 2, vy0, CITY.roadWidth, VIEW.height);
      context.fillStyle = PALETTE.roadDark;
      context.fillRect(line - CITY.roadWidth / 2, vy0, 4, VIEW.height);
      context.fillRect(line + CITY.roadWidth / 2 - 4, vy0, 4, VIEW.height);
      context.strokeStyle = PALETTE.roadLine;
      context.lineWidth = 3;
      context.setLineDash([26, 30]);
      context.beginPath();
      context.moveTo(line, vy0);
      context.lineTo(line, vy1);
      context.stroke();
      context.setLineDash([]);
      // Parking bays: white ticks along the east kerb, in stretches.
      context.strokeStyle = 'rgba(255,255,255,0.5)';
      context.lineWidth = 2;
      for (let y = Math.floor(vy0 / 120) * 120; y < vy1; y += 120) {
        if (hash(line * 0.7 + y * 0.13) < 0.55) {
          context.beginPath();
          context.moveTo(line + CITY.roadWidth / 2 - 8, y);
          context.lineTo(line + CITY.roadWidth / 2 - 8, y + 60);
          context.stroke();
        }
      }
    }
    for (const line of city.horizontal) {
      if (line < vy0 - 60 || line > vy1 + 60) continue;
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(vx0, line - CITY.roadWidth / 2 - CITY.sidewalk, VIEW.width, CITY.roadWidth + CITY.sidewalk * 2);
      context.fillStyle = PALETTE.sidewalkDark;
      context.fillRect(vx0, line - CITY.roadWidth / 2 - CITY.sidewalk, VIEW.width, 3);
      context.fillRect(vx0, line + CITY.roadWidth / 2 + CITY.sidewalk - 3, VIEW.width, 3);
      context.fillStyle = PALETTE.road;
      context.fillRect(vx0, line - CITY.roadWidth / 2, VIEW.width, CITY.roadWidth);
      context.fillStyle = PALETTE.roadDark;
      context.fillRect(vx0, line - CITY.roadWidth / 2, VIEW.width, 4);
      context.fillRect(vx0, line + CITY.roadWidth / 2 - 4, VIEW.width, 4);
      context.strokeStyle = PALETTE.roadLine;
      context.lineWidth = 3;
      context.setLineDash([26, 30]);
      context.beginPath();
      context.moveTo(vx0, line);
      context.lineTo(vx1, line);
      context.stroke();
      context.setLineDash([]);
    }
    // Zebra crossings + stop lines where roads meet, in view only.
    context.fillStyle = 'rgba(255,255,255,0.75)';
    for (const vx of city.vertical) {
      if (vx < vx0 - 80 || vx > vx1 + 80) continue;
      for (const hy of city.horizontal) {
        if (hy < vy0 - 80 || hy > vy1 + 80) continue;
        for (let i = -3; i <= 3; i += 1) {
          context.fillRect(vx + i * 9 - 3, hy - CITY.roadWidth / 2 - 14, 6, 12);
          context.fillRect(vx + i * 9 - 3, hy + CITY.roadWidth / 2 + 2, 6, 12);
          context.fillRect(vx - CITY.roadWidth / 2 - 14, hy + i * 9 - 3, 12, 6);
          context.fillRect(vx + CITY.roadWidth / 2 + 2, hy + i * 9 - 3, 12, 6);
        }
        context.fillStyle = 'rgba(255,255,255,0.85)';
        context.fillRect(vx - CITY.roadWidth / 2 + 4, hy - CITY.roadWidth / 2 - 22, CITY.roadWidth - 8, 4);
        context.fillStyle = 'rgba(255,255,255,0.75)';
      }
    }

    // Buildings: a sun-cast shadow, a coloured body, a parapet roof with a
    // lit top edge, roof furniture (AC boxes, skylights, vents), warm lit
    // windows after dark, and a shop sign on some rooftops.
    for (const b of city.buildings) {
      if (b.x + b.w < vx0 || b.x > vx1 || b.y + b.h < vy0 || b.y > vy1) continue;
      const sh = 6 + nf * -2;
      context.fillStyle = `rgba(0,0,0,${(0.28 - nf * 0.12).toFixed(2)})`;
      context.fillRect(b.x + sh, b.y + 8, b.w, b.h);
      context.fillStyle = b.color;
      context.fillRect(b.x, b.y, b.w, b.h);
      // Parapet: darker rim, lighter inner roof, sunlit top edge.
      context.fillStyle = shade(b.color, -34);
      context.fillRect(b.x, b.y, b.w, 6);
      context.fillRect(b.x, b.y, 6, b.h);
      context.fillStyle = PALETTE.roof;
      context.fillRect(b.x + 10, b.y + 10, b.w - 20, b.h - 20);
      context.fillStyle = PALETTE.roofLight;
      context.fillRect(b.x + 10, b.y + 10, b.w - 20, 4);
      context.fillRect(b.x + 10, b.y + 10, 4, b.h - 20);
      context.fillStyle = PALETTE.roofDark;
      context.fillRect(b.x + 10, b.y + b.h - 14, b.w - 20, 4);
      context.fillRect(b.x + b.w - 14, b.y + 10, 4, b.h - 20);
      // Roof furniture, deterministic per building.
      const cols = Math.max(2, Math.floor(b.w / 46));
      const rows = Math.max(2, Math.floor(b.h / 46));
      for (let cx = 0; cx < cols; cx += 1) {
        for (let cy = 0; cy < rows; cy += 1) {
          const r = hash(b.seed * 31 + cx * 7 + cy * 13);
          const wx = b.x + 18 + cx * ((b.w - 36) / cols);
          const wy = b.y + 18 + cy * ((b.h - 36) / rows);
          if (r < 0.16) {
            // AC unit: grey box with a darker grille.
            context.fillStyle = '#8d9299';
            context.fillRect(wx, wy, 16, 12);
            context.fillStyle = '#5b6067';
            context.fillRect(wx + 3, wy + 3, 10, 6);
          } else if (r < 0.26) {
            // Skylight: pale blue glass catching the sky.
            context.fillStyle = nf > 0.4 ? '#ffd98a' : '#bcd8e8';
            context.fillRect(wx, wy, 14, 10);
            context.strokeStyle = 'rgba(0,0,0,0.3)';
            context.lineWidth = 1;
            context.strokeRect(wx, wy, 14, 10);
          } else if (r < 0.34) {
            // Vent pipe.
            context.fillStyle = '#6e6258';
            context.fillRect(wx + 4, wy, 5, 12);
          } else if (nf > 0.35 && r < 0.62) {
            // Lit window: warm glass after dark.
            context.fillStyle = `rgba(255,214,130,${(0.55 + 0.35 * hash(r * 91)).toFixed(2)})`;
            context.fillRect(wx, wy, 12, 9);
          } else if (nf <= 0.35 && r < 0.5) {
            // Daytime roof tile shading.
            context.fillStyle = 'rgba(255,255,255,0.10)';
            context.fillRect(wx, wy, 12, 9);
          }
        }
      }
      // Shop sign band on the roof's south edge, for a few buildings.
      if (hash(b.seed * 3 + 11) < 0.34 && b.w > 130) {
        const label = SIGNS[Math.floor(hash(b.seed * 5 + 2) * SIGNS.length) % SIGNS.length];
        const signColor = PALETTE.sign[Math.floor(hash(b.seed * 7 + 4) * PALETTE.sign.length) % PALETTE.sign.length];
        const sw = Math.min(b.w - 30, 30 + label.length * 13);
        context.fillStyle = signColor;
        context.fillRect(b.x + (b.w - sw) / 2, b.y + b.h - 30, sw, 20);
        context.strokeStyle = 'rgba(255,255,255,0.7)';
        context.lineWidth = 1;
        context.strokeRect(b.x + (b.w - sw) / 2, b.y + b.h - 30, sw, 20);
        text(label, b.x + b.w / 2, b.y + b.h - 15, 13, '#ffffff', 'center', true, true, 1);
      }
    }
    // Street lamps: thin poles with a lamp head; the glow comes in the
    // lighting pass after dark.
    for (const lamp of city.lamps || []) {
      if (lamp.x < vx0 - 30 || lamp.x > vx1 + 30 || lamp.y < vy0 - 30 || lamp.y > vy1 + 30) continue;
      context.fillStyle = 'rgba(0,0,0,0.25)';
      context.beginPath();
      context.arc(lamp.x + 2, lamp.y + 2, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#3a3f46';
      context.fillRect(lamp.x - 1, lamp.y - 1, 3, 3);
      context.fillStyle = nf > 0.25 ? '#ffe9ad' : '#cfd6dd';
      context.beginPath();
      context.arc(lamp.x, lamp.y, 3.5, 0, Math.PI * 2);
      context.fill();
    }
    // Trees: ground shadow, layered canopy, sunlit top.
    for (const t of city.trees) {
      if (t.x < vx0 - 30 || t.x > vx1 + 30 || t.y < vy0 - 30 || t.y > vy1 + 30) continue;
      context.fillStyle = 'rgba(0,0,0,0.22)';
      context.beginPath();
      context.ellipse(t.x + 4, t.y + 5, t.r, t.r * 0.8, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#3f7a34';
      context.beginPath();
      context.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#5da24a';
      context.beginPath();
      context.arc(t.x - 3, t.y - 3, t.r * 0.7, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#7cc46a';
      context.beginPath();
      context.arc(t.x - 5, t.y - 6, t.r * 0.35, 0, Math.PI * 2);
      context.fill();
    }

    // Pickups: glow ring, bobbing icon, soft shadow.
    for (const p of state.pickups) {
      if (!p.active || p.x < vx0 - 30 || p.x > vx1 + 30 || p.y < vy0 - 30 || p.y > vy1 + 30) continue;
      const bob = Math.sin(p.bob) * 3;
      const pulse = 1 + Math.sin(p.bob * 2) * 0.08;
      context.fillStyle = 'rgba(0,0,0,0.3)';
      context.beginPath();
      context.arc(p.x, p.y + 12, 12, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = p.kind === 'health' ? 'rgba(229,83,75,0.7)' : 'rgba(242,201,76,0.7)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(p.x, p.y + bob, 16 * pulse, 0, Math.PI * 2);
      context.stroke();
      if (p.kind === 'health') {
        context.fillStyle = '#ffffff';
        context.fillRect(p.x - 12, p.y - 12 + bob, 24, 24);
        context.fillStyle = '#e5534b';
        context.fillRect(p.x - 3, p.y - 9 + bob, 6, 18);
        context.fillRect(p.x - 9, p.y - 3 + bob, 18, 6);
      } else if (p.kind === 'ammo') {
        context.fillStyle = '#f2c94c';
        context.fillRect(p.x - 12, p.y - 10 + bob, 24, 20);
        context.fillStyle = '#7a5b00';
        context.fillRect(p.x - 12, p.y - 2 + bob, 24, 4);
      } else {
        context.fillStyle = '#f2c94c';
        context.beginPath();
        context.arc(p.x, p.y + bob, 12, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#7a5b00';
        text('$', p.x, p.y + 5 + bob, 16, '#7a5b00', 'center', true);
      }
    }

    drawMissionMarker(state, vx0, vy0);

    // Skid marks, fading: dark rubber laid down by drifts.
    for (const s of state.skids || []) {
      context.save();
      context.translate(s.x, s.y);
      context.rotate(s.angle);
      context.fillStyle = `rgba(20,20,22,${(0.4 * (s.life / s.max)).toFixed(3)})`;
      context.fillRect(-7, -2, 14, 4);
      context.restore();
    }

    // Cars, pedestrians, police, player, bullets, particles.
    for (const car of state.cars) drawCar(state, car, nf);
    for (const ped of state.peds) drawPed(ped);
    for (const cop of state.cops) drawCop(cop);
    drawPlayer(state);
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (const b of state.bullets) {
      context.strokeStyle = '#ffe66d';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(b.x, b.y);
      context.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      context.stroke();
    }
    context.restore();
    for (const p of state.particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.glow) {
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.globalAlpha = a;
        context.fillStyle = p.color;
        context.beginPath();
        context.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2);
        context.fill();
        context.restore();
      } else if (p.shell) {
        context.save();
        context.translate(p.x, p.y);
        context.rotate(p.life * 12);
        context.globalAlpha = a;
        context.fillStyle = p.color;
        context.fillRect(-2.5, -1, 5, 2);
        context.restore();
      } else {
        context.globalAlpha = a * 0.9;
        context.fillStyle = p.color;
        context.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    context.globalAlpha = 1;

    drawLighting(state, vx0, vy0, nf);
    if (state.rain > 0) drawRain(state, vx0, vy0);
    return { vx0, vy0 };
  }

  /** Daylight tint, night darkening, lamp pools and headlight cones. */
  function drawLighting(state, vx0, vy0, nf) {
    const h = (state.clock / 3600) % 24;
    if (nf <= 0.02) {
      // Day: a faint warm wash; gold at dawn and dusk.
      const warm = (h >= 6 && h < 9) || (h >= 17 && h < 19.5);
      context.fillStyle = warm ? '#ff9a3d' : '#ffd76a';
      context.globalAlpha = warm ? 0.08 : 0.03;
      context.fillRect(vx0, vy0, VIEW.width, VIEW.height);
      context.globalAlpha = 1;
      // Sun glare from the top-left corner.
      const glare = context.createRadialGradient(vx0 + 80, vy0 + 40, 10, vx0 + 80, vy0 + 40, 420);
      glare.addColorStop(0, 'rgba(255,240,190,0.20)');
      glare.addColorStop(1, 'rgba(255,240,190,0)');
      context.fillStyle = glare;
      context.fillRect(vx0, vy0, VIEW.width, VIEW.height);
      return;
    }
    // Night: a deep blue wash over the world.
    context.fillStyle = '#0d1434';
    context.globalAlpha = 0.34 * nf;
    context.fillRect(vx0, vy0, VIEW.width, VIEW.height);
    context.globalAlpha = 1;
    context.save();
    context.globalCompositeOperation = 'lighter';
    // Warm pools around every street lamp in view.
    for (const lamp of state.city.lamps || []) {
      if (lamp.x < vx0 - 160 || lamp.x > vx0 + VIEW.width + 160 || lamp.y < vy0 - 160 || lamp.y > vy0 + VIEW.height + 160) continue;
      const g = context.createRadialGradient(lamp.x, lamp.y, 4, lamp.x, lamp.y, 130);
      g.addColorStop(0, `rgba(255,217,138,${(0.30 * nf).toFixed(2)})`);
      g.addColorStop(1, 'rgba(255,217,138,0)');
      context.fillStyle = g;
      context.beginPath();
      context.arc(lamp.x, lamp.y, 130, 0, Math.PI * 2);
      context.fill();
    }
    // Headlight cones: the player's car and every cruiser throws light.
    for (const car of state.cars) {
      if (car.wrecked) continue;
      const isPlayerCar = state.player.car === car;
      const isCop = car.kind === 'cop';
      if (!isPlayerCar && !isCop && car.driver !== 'traffic') continue;
      if (car.x < vx0 - 200 || car.x > vx0 + VIEW.width + 200 || car.y < vy0 - 200 || car.y > vy0 + VIEW.height + 200) continue;
      const a = car.visAngle ?? car.angle;
      const fx = car.x + Math.cos(a) * 26;
      const fy = car.y + Math.sin(a) * 26;
      const len = isPlayerCar ? 190 : 130;
      const spread = 0.42;
      const grad = context.createLinearGradient(fx, fy, fx + Math.cos(a) * len, fy + Math.sin(a) * len);
      grad.addColorStop(0, `rgba(255,243,196,${(0.34 * nf).toFixed(2)})`);
      grad.addColorStop(1, 'rgba(255,243,196,0)');
      context.fillStyle = grad;
      context.beginPath();
      context.moveTo(fx, fy);
      const left = a - spread;
      const right = a + spread;
      context.lineTo(fx + Math.cos(left) * len, fy + Math.sin(left) * len);
      context.lineTo(fx + Math.cos(right) * len, fy + Math.sin(right) * len);
      context.closePath();
      context.fill();
    }
    // Police light bars wash red and blue onto the road around cruisers.
    for (const car of state.cars) {
      if (car.kind !== 'cop' || car.wrecked) continue;
      const red = Math.floor(state.time * 6) % 2 === 0;
      const g = context.createRadialGradient(car.x, car.y, 6, car.x, car.y, 90);
      g.addColorStop(0, red ? `rgba(255,59,48,${(0.30 * nf).toFixed(2)})` : `rgba(47,109,246,${(0.30 * nf).toFixed(2)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = g;
      context.beginPath();
      context.arc(car.x, car.y, 90, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    // A soft vignette so the frame holds together at night.
    const vig = context.createRadialGradient(vx0 + VIEW.width / 2, vy0 + VIEW.height / 2, VIEW.height * 0.45, vx0 + VIEW.width / 2, vy0 + VIEW.height / 2, VIEW.height * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, `rgba(0,0,0,${(0.22 * nf).toFixed(2)})`);
    context.fillStyle = vig;
    context.fillRect(vx0, vy0, VIEW.width, VIEW.height);
  }

  /** Diagonal rain streaks, deterministic per frame. */
  function drawRain(state, vx0, vy0) {
    const drops = Math.round(state.rain * 90);
    context.strokeStyle = 'rgba(200,220,255,0.28)';
    context.lineWidth = 1;
    context.beginPath();
    for (let i = 0; i < drops; i += 1) {
      const x = vx0 + ((hash(i * 31) * VIEW.width + state.time * 130) % VIEW.width);
      const y = vy0 + ((hash(i * 57) * VIEW.height + state.time * 720) % VIEW.height);
      context.moveTo(x, y);
      context.lineTo(x - 5, y + 13);
    }
    context.stroke();
  }

  function drawMissionMarker(state, vx0, vy0) {
    const mission = state.mission;
    if (!mission || !mission.target) return;
    const t = mission.target;
    const pulse = 1 + Math.sin(state.time * 4) * 0.12;
    const inView = t.x > vx0 && t.x < vx0 + VIEW.width && t.y > vy0 && t.y < vy0 + VIEW.height;
    if (inView) {
      context.save();
      context.translate(t.x, t.y);
      context.rotate(Math.PI / 4);
      context.fillStyle = PALETTE.gold;
      context.globalAlpha = 0.9;
      context.fillRect(-13 * pulse, -13 * pulse, 26 * pulse, 26 * pulse);
      context.globalAlpha = 1;
      context.restore();
      context.strokeStyle = 'rgba(242,201,76,0.8)';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(t.x, t.y, 34 + Math.sin(state.time * 4) * 6, 0, Math.PI * 2);
      context.stroke();
      textOutlined(t.label, t.x, t.y - 48, 17, '#ffffff', 'center', true);
    } else {
      // Edge arrow pointing at an off-screen objective.
      const cx = clamp(t.x, vx0 + 60, vx0 + VIEW.width - 60);
      const cy = clamp(t.y, vy0 + 60, vy0 + VIEW.height - 60);
      const a = Math.atan2(t.y - (vy0 + VIEW.height / 2), t.x - (vx0 + VIEW.width / 2));
      context.save();
      context.translate(cx, cy);
      context.rotate(a);
      context.fillStyle = PALETTE.gold;
      context.beginPath();
      context.moveTo(18, 0);
      context.lineTo(-10, -12);
      context.lineTo(-10, 12);
      context.closePath();
      context.fill();
      context.restore();
      // The label stays on screen even when the arrow sits at the edge.
      const labelX = clamp(cx, 120, VIEW.width - 120);
      textOutlined(`${t.label} ${Math.round(Math.hypot(t.x - state.player.x, t.y - state.player.y))}m`, labelX, cy - 20, 14, '#ffffff', 'center', true);
    }
  }

  function drawCar(state, car, nf) {
    // Smooth the heading so turns glide instead of snapping.
    const target = car.angle;
    const diff = angleDiff(car.visAngle ?? car.angle, target);
    car.visAngle = (car.visAngle ?? car.angle) + clamp(diff, -0.32, 0.32);
    const model = CAR_MODELS[car.kind] || CAR_MODELS.sedan;
    const wreck = car.wrecked;
    const body = wreck ? '#3a3a3a' : (model.body || car.color);
    const L = car.kind === 'van' || car.kind === 'courier' ? 60 : car.kind === 'sports' ? 58 : CAR.length;
    const W = car.kind === 'van' || car.kind === 'courier' ? 30 : CAR.width;
    const hl = L / 2;
    const hw = W / 2;

    // Soft ground shadow, offset toward the low sun.
    context.fillStyle = 'rgba(0,0,0,0.32)';
    context.beginPath();
    context.ellipse(car.x + 4, car.y + 6, hl + 2, hw + 3, car.visAngle, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.visAngle + (wreck ? 0.06 : 0));
    // Wheels: dark tyres with a lighter hub, wider on the sports car.
    const wheelW = car.kind === 'sports' ? 11 : 9;
    const wheelH = 5;
    context.fillStyle = '#15181c';
    for (const [wx, wy] of [[-hl + 9, -hw - 1], [hl - 11, -hw - 1], [-hl + 9, hw - 4], [hl - 11, hw - 4]]) {
      rr(wx, wy, wheelW, wheelH, 2);
      context.fill();
    }
    // Body: main colour, a sunlit top edge and a shaded lower edge.
    context.fillStyle = body;
    rr(-hl, -hw, L, W, 8);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.20)';
    rr(-hl + 4, -hw, L - 8, 4, 2);
    context.fill();
    context.fillStyle = 'rgba(0,0,0,0.20)';
    rr(-hl + 4, hw - 4, L - 8, 4, 2);
    context.fill();
    // Hood and boot seams.
    context.strokeStyle = 'rgba(0,0,0,0.28)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(hl - 16, -hw + 3);
    context.lineTo(hl - 16, hw - 3);
    context.moveTo(-hl + 14, -hw + 3);
    context.lineTo(-hl + 14, hw - 3);
    context.stroke();
    if (car.kind === 'cop') {
      // Cruiser: blue centre stripe over white, black push bar up front.
      context.fillStyle = PALETTE.copBlue;
      context.fillRect(-hl + 2, -4, L - 4, 8);
      context.fillStyle = '#15181c';
      context.fillRect(hl - 3, -hw + 4, 3, W - 8);
      const flash = Math.floor(state.time * 6) % 2 === 0;
      context.fillStyle = flash ? '#ff3b30' : '#2f6df6';
      context.fillRect(-6, -hw - 2, 11, 6);
      context.fillStyle = flash ? '#2f6df6' : '#ff3b30';
      context.fillRect(-6, hw - 4, 11, 6);
      if (nf > 0.25) {
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = flash ? 'rgba(255,59,48,0.5)' : 'rgba(47,109,246,0.5)';
        context.beginPath();
        context.arc(0, -hw, 9, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = flash ? 'rgba(47,109,246,0.5)' : 'rgba(255,59,48,0.5)';
        context.beginPath();
        context.arc(0, hw, 9, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    } else if (car.kind === 'taxi') {
      // Cab: checker band down both flanks and a roof sign.
      for (let i = 0; i < 6; i += 1) {
        context.fillStyle = i % 2 === 0 ? '#151515' : '#f4f6f8';
        context.fillRect(-hl + 10 + i * 6, -hw + 1, 6, 4);
        context.fillRect(-hl + 10 + i * 6, hw - 5, 6, 4);
      }
      context.fillStyle = '#f4f6f8';
      context.fillRect(-7, -5, 14, 10);
      context.strokeStyle = '#151515';
      context.lineWidth = 1;
      context.strokeRect(-7, -5, 14, 10);
      context.fillStyle = '#151515';
      context.fillRect(-5, -2, 10, 4);
    }
    if (model.stripe && car.kind !== 'cop') {
      // Sports car: twin racing stripes down the centre.
      context.fillStyle = 'rgba(255,255,255,0.75)';
      context.fillRect(-hl + 2, -5, L - 4, 3);
      context.fillRect(-hl + 2, 2, L - 4, 3);
    }
    // Glass: windshield and rear window with a diagonal sky glint.
    const glass = wreck ? '#222222' : model.glass;
    context.fillStyle = glass;
    rr(hl - 15, -hw + 5, 8, W - 10, 2);
    context.fill();
    rr(-hl + 6, -hw + 6, 6, W - 12, 2);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.55)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(hl - 13, hw - 6);
    context.lineTo(hl - 8, -hw + 6);
    context.stroke();
    // Roof panel between the glass, with a sunroof on sedans and sports.
    const roofColor = wreck ? '#2c2c2c' : (model.roof || shade(body, -18));
    context.fillStyle = roofColor;
    rr(-hl + 13, -hw + 4, L - 30, W - 8, 4);
    context.fill();
    if ((car.kind === 'sedan' || car.kind === 'sports') && !wreck) {
      context.fillStyle = 'rgba(20,28,38,0.85)';
      rr(-4, -hw + 7, 12, W - 14, 2);
      context.fill();
    }
    if (car.kind === 'van' || car.kind === 'courier') {
      // Boxy van: a row of side windows and rear door seams.
      context.fillStyle = glass;
      context.fillRect(-hl + 16, -hw + 3, 6, 4);
      context.fillRect(-hl + 16, hw - 7, 6, 4);
      context.fillRect(-hl + 26, -hw + 3, 6, 4);
      context.fillRect(-hl + 26, hw - 7, 6, 4);
      context.strokeStyle = 'rgba(0,0,0,0.3)';
      context.beginPath();
      context.moveTo(-hl + 2, -hw + 3);
      context.lineTo(-hl + 2, hw - 3);
      context.stroke();
    }
    if (model.spoiler && !wreck) {
      // Sports spoiler across the boot.
      context.fillStyle = '#15181c';
      context.fillRect(-hl - 2, -hw - 1, 5, W + 2);
      context.fillStyle = shade(body, 30);
      context.fillRect(-hl - 2, -hw - 1, 2, W + 2);
    }
    // Headlights up front, tail lights at the rear.
    context.fillStyle = nf > 0.25 ? PALETTE.headlight : '#fff8d0';
    rr(hl - 2, -hw + 4, 3, 6, 1);
    context.fill();
    rr(hl - 2, hw - 10, 3, 6, 1);
    context.fill();
    context.fillStyle = '#ff2d2d';
    rr(-hl - 1, -hw + 4, 3, 6, 1);
    context.fill();
    rr(-hl - 1, hw - 10, 3, 6, 1);
    context.fill();
    if (wreck) {
      // Cracked windshield: a pale X over the glass.
      context.strokeStyle = 'rgba(220,220,220,0.7)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(hl - 15, -hw + 5);
      context.lineTo(hl - 7, hw - 5);
      context.moveTo(hl - 7, -hw + 5);
      context.lineTo(hl - 15, hw - 5);
      context.stroke();
    }
    if (car.driver === 'player') {
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      rr(-hl, -hw, L, W, 8);
      context.stroke();
      context.fillStyle = PALETTE.gold;
      context.fillRect(-hl - 1, -2, 4, 4);
      context.fillRect(hl - 3, -2, 4, 4);
    }
    context.restore();
    if (wreck && Math.floor(state.time * 3) % 2 === 0) {
      context.fillStyle = 'rgba(120,120,120,0.5)';
      context.beginPath();
      context.arc(car.x, car.y - 10, 8, 0, Math.PI * 2);
      context.fill();
    }
  }

  /** A walking figure: swinging legs and arms, torso, head, hair. */
  function drawFigure(x, y, angle, phase, shirt, pants, skin, radius, moving) {
    const swing = moving ? Math.sin(phase) * 5 : 0;
    const perpX = Math.cos(angle + Math.PI / 2);
    const perpY = Math.sin(angle + Math.PI / 2);
    const fwdX = Math.cos(angle);
    const fwdY = Math.sin(angle);
    // Ground shadow.
    context.fillStyle = 'rgba(0,0,0,0.28)';
    context.beginPath();
    context.ellipse(x + 2, y + 3, radius, radius * 0.85, 0, 0, Math.PI * 2);
    context.fill();
    // Legs: two feet stepping along the facing direction.
    context.fillStyle = pants;
    context.beginPath();
    context.arc(x + fwdX * swing - perpX * 4, y + fwdY * swing - perpY * 4, 4, 0, Math.PI * 2);
    context.arc(x - fwdX * swing + perpX * 4, y - fwdY * swing + perpY * 4, 4, 0, Math.PI * 2);
    context.fill();
    // Arms swinging opposite the legs.
    context.fillStyle = skin;
    context.beginPath();
    context.arc(x - fwdX * swing * 0.6 - perpX * (radius - 1), y - fwdY * swing * 0.6 - perpY * (radius - 1), 3, 0, Math.PI * 2);
    context.arc(x + fwdX * swing * 0.6 + perpX * (radius - 1), y + fwdY * swing * 0.6 + perpY * (radius - 1), 3, 0, Math.PI * 2);
    context.fill();
    // Torso.
    context.fillStyle = shirt;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.18)';
    context.beginPath();
    context.arc(x - 2, y - 3, radius * 0.55, 0, Math.PI * 2);
    context.fill();
    // Head, pushed a little toward the facing direction, with hair.
    context.fillStyle = skin;
    context.beginPath();
    context.arc(x + fwdX * 3, y + fwdY * 3, 5.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#2b2118';
    context.beginPath();
    context.arc(x + fwdX * 2, y + fwdY * 2 - 2, 5, Math.PI, Math.PI * 2);
    context.fill();
  }

  function drawPed(ped) {
    if (ped.down > 0) {
      context.fillStyle = 'rgba(0,0,0,0.25)';
      context.beginPath();
      context.ellipse(ped.x + 2, ped.y + 3, 15, 8, ped.angle, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = ped.color;
      context.beginPath();
      context.ellipse(ped.x, ped.y, 14, 8, ped.angle, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#f2c9a0';
      context.beginPath();
      context.arc(ped.x + Math.cos(ped.angle) * 14, ped.y + Math.sin(ped.angle) * 14, 5, 0, Math.PI * 2);
      context.fill();
      return;
    }
    drawFigure(ped.x, ped.y, ped.angle, ped.phase || 0, ped.color, ped.pants || '#333333', '#f2c9a0', PED.radius, ped.mode !== 'wait');
  }

  function drawCop(cop) {
    drawFigure(cop.x, cop.y, cop.angle, cop.phase || 0, '#1d3a6e', '#0f2247', '#f2c9a0', PED.radius, true);
    // Cap with a brim, and a gold badge dot.
    context.fillStyle = '#0f2247';
    context.beginPath();
    context.arc(cop.x + Math.cos(cop.angle) * 3, cop.y + Math.sin(cop.angle) * 3 - 2, 5.5, Math.PI, Math.PI * 2);
    context.fill();
    context.fillStyle = PALETTE.gold;
    context.beginPath();
    context.arc(cop.x + Math.cos(cop.angle + Math.PI / 2) * 6, cop.y + Math.sin(cop.angle + Math.PI / 2) * 6, 2.5, 0, Math.PI * 2);
    context.fill();
  }

  function drawPlayer(state) {
    const player = state.player;
    if (player.car) return; // the car drawing shows the player
    if (player.invuln > 0 && Math.floor(player.invuln * 10) % 2 === 0) return; // blink after a hit
    drawFigure(player.x, player.y, player.angle, player.phase || 0, '#e5534b', '#2b3a55', '#f2c9a0', PLAYER.radius, player.speed > 0);
    // Gun barrel shows the aim direction, with a dark grip in the hand.
    context.strokeStyle = '#222';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(player.x + Math.cos(player.angle) * 10, player.y + Math.sin(player.angle) * 10);
    context.lineTo(player.x + Math.cos(player.angle) * 24, player.y + Math.sin(player.angle) * 24);
    context.stroke();
    context.fillStyle = '#1a1a1a';
    context.beginPath();
    context.arc(player.x + Math.cos(player.angle) * 12, player.y + Math.sin(player.angle) * 12, 3, 0, Math.PI * 2);
    context.fill();
  }

  function drawHud(state) {
    const player = state.player;
    // Top-left panel: money, health, ammo — gold top rule, display type.
    context.fillStyle = 'rgba(10,14,20,0.78)';
    rr(14, 12, 258, 96, 10);
    context.fill();
    context.fillStyle = PALETTE.gold;
    context.fillRect(24, 12, 238, 3);
    text(`$${player.money.toLocaleString('en-US')}`, 28, 48, 32, PALETTE.gold, 'left', true, true, 1);
    context.fillStyle = '#2c313a';
    rr(28, 58, 180, 12, 6);
    context.fill();
    context.fillStyle = player.health > 40 ? PALETTE.green : PALETTE.red;
    rr(28, 58, 180 * Math.max(0, player.health) / PLAYER.health, 12, 6);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 1; i < 5; i += 1) context.fillRect(28 + i * 36 - 1, 58, 2, 12);
    text(`HP ${Math.max(0, Math.round(player.health))}`, 214, 70, 14, PALETTE.text, 'left', true);
    // Ammo: little bullet ticks, then the count.
    context.fillStyle = PALETTE.gold;
    for (let i = 0; i < 3; i += 1) context.fillRect(28 + i * 5, 84, 3, 10);
    text(`AMMO ${player.ammo}`, 46, 96, 15, PALETTE.text, 'left', true);
    text(player.car ? 'DRIVING' : 'ON FOOT', 176, 96, 14, PALETTE.blue, 'left', true, true, 1);

    // Top-centre: current job, with its number and a progress bar.
    const mission = state.mission;
    if (mission) {
      const label = `JOB ${mission.index + 1}/${JOB_COUNT}  •  ${mission.def.title}  •  $${mission.def.reward}`;
      const obj = missionObjective(state);
      const prog = missionProgress(state);
      const h = prog ? 82 : 64;
      const w = 500;
      context.fillStyle = 'rgba(10,14,20,0.78)';
      rr(VIEW.width / 2 - w / 2, 12, w, h, 10);
      context.fill();
      context.fillStyle = PALETTE.gold;
      context.fillRect(VIEW.width / 2 - w / 2 + 10, 12, w - 20, 3);
      text(label, VIEW.width / 2, 40, 18, PALETTE.gold, 'center', true, true, 1);
      text(obj, VIEW.width / 2, 64, 15, PALETTE.text, 'center');
      if (prog) {
        context.fillStyle = '#2c313a';
        rr(VIEW.width / 2 - 200, 74, 400, 7, 3);
        context.fill();
        context.fillStyle = PALETTE.gold;
        rr(VIEW.width / 2 - 200, 74, 400 * Math.max(0, Math.min(1, prog.frac)), 7, 3);
        context.fill();
      }
      if (mission.timer > 0 && (mission.index === 1 || mission.index === 5)) {
        context.fillStyle = 'rgba(229,83,75,0.9)';
        rr(VIEW.width / 2 + w / 2 - 66, 22, 52, 24, 6);
        context.fill();
        text(`${Math.ceil(mission.timer)}s`, VIEW.width / 2 + w / 2 - 40, 40, 16, '#ffffff', 'center', true, true);
      }
    }

    // Minimap, top-right, with the wanted stars beneath it.
    drawMinimap(state);
    const starsY = MINIMAP.y + MINIMAP.h + 26;
    text('WANTED', MINIMAP.x + 4, starsY, 13, PALETTE.text, 'left', true, true, 2);
    for (let i = 0; i < 5; i += 1) {
      const x = MINIMAP.x + 82 + i * 30;
      const lit = i < state.wanted;
      const flash = state.wanted >= 3 && Math.floor(state.time * 4) % 2 === 0;
      context.fillStyle = lit ? (flash ? '#ffdf5e' : PALETTE.gold) : 'rgba(255,255,255,0.25)';
      starPath(x, starsY - 4, 12);
      context.fill();
      if (lit) {
        context.strokeStyle = 'rgba(0,0,0,0.45)';
        context.lineWidth = 1;
        context.stroke();
      }
    }

    // Bottom-left: speed in its own dark chip, the car's health bar under it.
    if (player.car) {
      const kmh = Math.round(Math.abs(player.car.speed) * 0.36);
      context.fillStyle = 'rgba(10,14,20,0.78)';
      rr(14, VIEW.height - 78, 122, 64, 10);
      context.fill();
      context.fillStyle = PALETTE.gold;
      context.fillRect(24, VIEW.height - 78, 102, 3);
      text(`${kmh}`, 28, VIEW.height - 40, 34, PALETTE.text, 'left', true, true);
      text('km/h', 96, VIEW.height - 40, 15, PALETTE.muted, 'left');
      const carHealth = Math.max(0, player.car.health) / 100;
      context.fillStyle = '#2c313a';
      rr(28, VIEW.height - 30, 94, 6, 3);
      context.fill();
      context.fillStyle = carHealth > 0.4 ? PALETTE.green : PALETTE.red;
      rr(28, VIEW.height - 30, 94 * carHealth, 6, 3);
      context.fill();
    }
    // Bottom hint line: key chips, then the plain text.
    let hx = 14;
    if (!player.car) {
      hx += keyChip('WASD', hx, VIEW.height - 8) + 6;
      text('move', hx, VIEW.height - 8, 13, 'rgba(255,255,255,0.75)', 'left');
      hx += 44;
      hx += keyChip('E', hx, VIEW.height - 8) + 6;
      text('enter car', hx, VIEW.height - 8, 13, 'rgba(255,255,255,0.75)', 'left');
      hx += 66;
      hx += keyChip('CLICK', hx, VIEW.height - 8) + 6;
      text('shoot', hx, VIEW.height - 8, 13, 'rgba(255,255,255,0.75)', 'left');
      hx += 48;
    } else {
      hx += keyChip('SHIFT', hx, VIEW.height - 8) + 6;
      text('handbrake', hx, VIEW.height - 8, 13, 'rgba(255,255,255,0.75)', 'left');
      hx += 84;
    }
    hx += keyChip('P', hx, VIEW.height - 8) + 6;
    text('pause', hx, VIEW.height - 8, 13, 'rgba(255,255,255,0.75)', 'left');
    hx += 50;
    hx += keyChip('M', hx, VIEW.height - 8) + 6;
    text('mute', hx, VIEW.height - 8, 13, 'rgba(255,255,255,0.75)', 'left');
    // Bottom-right: clock and day in a small chip.
    const clockLabel = `${clockText(state.clock)}  •  Day ${state.day}`;
    context.fillStyle = 'rgba(10,14,20,0.78)';
    rr(VIEW.width - 14 - 128, VIEW.height - 34, 128, 26, 8);
    context.fill();
    text(clockLabel, VIEW.width - 22, VIEW.height - 15, 15, PALETTE.text, 'right', true, true, 1);

    // Transient centre message in a dark pill.
    if (state.messageTimer > 0 && state.message) {
      context.globalAlpha = Math.min(1, state.messageTimer);
      const mw = 40 + state.message.length * 9;
      context.fillStyle = 'rgba(10,14,20,0.8)';
      rr(VIEW.width / 2 - mw / 2, 96, mw, 34, 17);
      context.fill();
      context.strokeStyle = PALETTE.gold;
      context.lineWidth = 1;
      rr(VIEW.width / 2 - mw / 2, 96, mw, 34, 17);
      context.stroke();
      text(state.message, VIEW.width / 2, 119, 18, PALETTE.gold, 'center', true);
      context.globalAlpha = 1;
    }
  }

  function drawMinimap(state) {
    const sx = MINIMAP.w / WORLD.width;
    const sy = MINIMAP.h / WORLD.height;
    context.fillStyle = 'rgba(10,14,20,0.82)';
    rr(MINIMAP.x - 4, MINIMAP.y - 4, MINIMAP.w + 8, MINIMAP.h + 8, 8);
    context.fill();
    context.strokeStyle = 'rgba(242,201,76,0.55)';
    context.lineWidth = 1;
    rr(MINIMAP.x - 4, MINIMAP.y - 4, MINIMAP.w + 8, MINIMAP.h + 8, 8);
    context.stroke();
    text('PORT SOLMAR', MINIMAP.x + MINIMAP.w / 2, MINIMAP.y - 8, 10, PALETTE.muted, 'center', true, true, 2);
    context.save();
    context.beginPath();
    context.rect(MINIMAP.x, MINIMAP.y, MINIMAP.w, MINIMAP.h);
    context.clip();
    context.fillStyle = '#6f9e4e';
    context.fillRect(MINIMAP.x, MINIMAP.y, MINIMAP.w, MINIMAP.h);
    context.fillStyle = PALETTE.water;
    context.fillRect(MINIMAP.x, MINIMAP.y, (CITY.beachWidth - 130) * sx, MINIMAP.h);
    context.fillStyle = PALETTE.sand;
    context.fillRect(MINIMAP.x + (CITY.beachWidth - 130) * sx, MINIMAP.y, 130 * sx, MINIMAP.h);
    context.fillStyle = PALETTE.park;
    context.fillRect(MINIMAP.x + state.city.park.x * sx, MINIMAP.y + state.city.park.y * sy, state.city.park.w * sx, state.city.park.h * sy);
    context.strokeStyle = '#565d66';
    context.lineWidth = 2;
    for (const line of state.city.vertical) {
      context.beginPath();
      context.moveTo(MINIMAP.x + line * sx, MINIMAP.y);
      context.lineTo(MINIMAP.x + line * sx, MINIMAP.y + MINIMAP.h);
      context.stroke();
    }
    for (const line of state.city.horizontal) {
      context.beginPath();
      context.moveTo(MINIMAP.x, MINIMAP.y + line * sy);
      context.lineTo(MINIMAP.x + MINIMAP.w, MINIMAP.y + line * sy);
      context.stroke();
    }
    const px = (x) => MINIMAP.x + x * sx;
    const py = (y) => MINIMAP.y + y * sy;
    // Key places, colour-coded, so the map reads without the mission marker.
    for (const [place, color] of PLACE_DOTS) {
      context.fillStyle = color;
      context.fillRect(px(place.x) - 2, py(place.y) - 2, 4, 4);
    }
    for (const car of state.cars) {
      context.fillStyle = car.kind === 'cop' ? '#4d8dff' : '#d8d8d8';
      context.fillRect(px(car.x) - 2, py(car.y) - 2, 4, 4);
    }
    for (const cop of state.cops) {
      context.fillStyle = '#2f6df6';
      context.fillRect(px(cop.x) - 2, py(cop.y) - 2, 4, 4);
    }
    if (state.mission && state.mission.target) {
      const t = state.mission.target;
      context.fillStyle = PALETTE.gold;
      context.save();
      context.translate(px(t.x), py(t.y));
      context.rotate(Math.PI / 4);
      context.fillRect(-5, -5, 10, 10);
      context.restore();
    }
    // Player: a white triangle pointing where they face, ringed in gold.
    context.save();
    context.translate(px(state.player.x), py(state.player.y));
    context.rotate(state.player.angle);
    context.fillStyle = PALETTE.gold;
    context.beginPath();
    context.moveTo(9, 0);
    context.lineTo(-6, -6);
    context.lineTo(-6, 6);
    context.closePath();
    context.fill();
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.moveTo(7, 0);
    context.lineTo(-5, -5);
    context.lineTo(-5, 5);
    context.closePath();
    context.fill();
    context.restore();
    context.restore();
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 660;
    const height = 168 + lines.length * 32;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2;
    // Backdrop: dim the city behind the panel.
    context.fillStyle = 'rgba(6,8,12,0.45)';
    context.fillRect(0, 0, VIEW.width, VIEW.height);
    context.fillStyle = PALETTE.panel;
    rr(x, y, width, height, 16);
    context.fill();
    context.strokeStyle = accent || PALETTE.gold;
    context.lineWidth = 2;
    rr(x, y, width, height, 16);
    context.stroke();
    // Gold corner ticks and a top rule.
    context.fillStyle = accent || PALETTE.gold;
    context.fillRect(x + 24, y, width - 48, 3);
    for (const [cx, cy] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) {
      context.fillRect(cx - 6, cy - 6, 12, 12);
    }
    text('PORT SOLMAR', VIEW.width / 2, y + 34, 13, PALETTE.muted, 'center', true, true, 4);
    // Title in a gold gradient, with a soft shadow.
    const grad = context.createLinearGradient(0, y + 30, 0, y + 84);
    grad.addColorStop(0, '#ffe98a');
    grad.addColorStop(0.55, PALETTE.gold);
    grad.addColorStop(1, '#c08f1d');
    context.save();
    context.shadowColor = 'rgba(0,0,0,0.6)';
    context.shadowBlur = 12;
    context.shadowOffsetY = 3;
    context.font = `700 46px ${FONT_DISPLAY}`;
    context.fillStyle = grad;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    try { context.letterSpacing = '3px'; } catch { /* older canvas */ }
    context.fillText(title, VIEW.width / 2, y + 82);
    context.restore();
    // Gold divider with a centre diamond.
    context.fillStyle = accent || PALETTE.gold;
    context.fillRect(VIEW.width / 2 - 110, y + 98, 100, 2);
    context.fillRect(VIEW.width / 2 + 10, y + 98, 100, 2);
    context.save();
    context.translate(VIEW.width / 2, y + 99);
    context.rotate(Math.PI / 4);
    context.fillRect(-5, -5, 10, 10);
    context.restore();
    lines.forEach((line, i) => {
      text(line, VIEW.width / 2, y + 136 + i * 32, 18, i === 0 ? PALETTE.text : PALETTE.muted, 'center');
    });
    if (prompt) {
      const pw = 40 + prompt.length * 10;
      context.strokeStyle = PALETTE.gold;
      context.lineWidth = 1.5;
      rr(VIEW.width / 2 - pw / 2, y + height - 52, pw, 34, 17);
      context.stroke();
      context.fillStyle = 'rgba(242,201,76,0.12)';
      rr(VIEW.width / 2 - pw / 2, y + height - 52, pw, 34, 17);
      context.fill();
      text(prompt, VIEW.width / 2, y + height - 29, 17, PALETTE.gold, 'center', true);
    }
  }

  /** Paint one frame: the world, then the HUD or a menu panel. */
  function draw(state, screen, extra) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#0c0f14';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const cam = state.camera;
    const vx0 = clamp(cam.x - VIEW.width / 2, 0, WORLD.width - VIEW.width);
    const vy0 = clamp(cam.y - VIEW.height / 2, 0, WORLD.height - VIEW.height);
    // Crash shake: a small deterministic wobble that fades with state.shake.
    const shake = state.shake || 0;
    const ox = shake > 0 ? Math.sin(state.time * 47) * shake * 7 : 0;
    const oy = shake > 0 ? Math.cos(state.time * 39) * shake * 7 : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x - (vx0 + ox) * view.scale, view.y - (vy0 + oy) * view.scale);
    drawWorld(state);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    if (screen === SCREEN_TITLE) {
      const lines = [
        'Port Solmar. Sun, sea, and seven jobs that pay.',
        'Steal cars, lose the police, run the story — Mara Voss is waiting.',
        'WASD / arrows to move and drive  •  E to enter a car  •  Click to shoot',
        `Best haul so far: $${(extra.best || 0).toLocaleString('en-US')}`,
      ];
      drawPanel('SOLMAR HEAT', lines, extra.saveExists ? 'Press Space to start — or C to continue your save' : 'Press Space or click to start', PALETTE.gold);
      // Seven gold pips for the seven jobs, under the panel.
      for (let i = 0; i < 7; i += 1) {
        context.fillStyle = PALETTE.gold;
        context.beginPath();
        context.arc(VIEW.width / 2 - 60 + i * 20, (VIEW.height + 168 + lines.length * 32) / 2 + 34, 5, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }
    drawHud(state);
    // Low-health vignette: a pulsing red frame while the player is hurt.
    if (screen === SCREEN_PLAY && state.player.health < 35) {
      const pulse = 0.10 + 0.07 * Math.sin(state.time * 5);
      context.strokeStyle = `rgba(229,83,75,${pulse.toFixed(3)})`;
      context.lineWidth = 26;
      context.strokeRect(13, 13, VIEW.width - 26, VIEW.height - 26);
    }
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The city waits. Your heat does not cool while paused.', 'M mute sound  •  R restart the run'], 'Press P to resume', PALETTE.blue);
    } else if (screen === SCREEN_OVER) {
      const won = state.won;
      const lines = won
        ? ['Every job done. Port Solmar is yours.', `Final haul: $${state.player.money.toLocaleString('en-US')}  •  Jobs done: ${state.stats.missionsDone}  •  Cars stolen: ${state.stats.carsStolen}`]
        : ['Busted. The Solmar police finally caught up with you.', `Haul: $${state.player.money.toLocaleString('en-US')}  •  Jobs done: ${state.stats.missionsDone}  •  Cars stolen: ${state.stats.carsStolen}`];
      drawPanel(won ? 'SOLMAR IS YOURS' : 'BUSTED', lines, 'Press Space or click to play again', won ? PALETTE.gold : PALETTE.red);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return {
    draw,
    /** Mouse (CSS px, relative to the canvas) → world point, given the camera. */
    toWorld(mx, my, camera) {
      const vx0 = clamp(camera.x - VIEW.width / 2, 0, WORLD.width - VIEW.width);
      const vy0 = clamp(camera.y - VIEW.height / 2, 0, WORLD.height - VIEW.height);
      return { x: vx0 + mx / view.scale, y: vy0 + my / view.scale };
    },
    view,
  };
}
