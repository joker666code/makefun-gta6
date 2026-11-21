// Drawing only: the city, the cars and people in it, the HUD with its
// minimap, and the menu screens. The camera follows the player across
// the 2880x2160 city; a 1280x720 view is scaled to fit the window. Flat
// shapes and canvas text throughout — the art direction is a sun-soaked
// coastal city: warm sand, green parks, grey roads and colourful roofs.

import { CAR, CITY, FONT, JOB_COUNT, PALETTE, PED, PLAYER, VIEW, WORLD } from './config.js';
import { clamp } from './random.js';
import { PLACES } from './world.js';
import { missionObjective, missionProgress } from './missions.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const MINIMAP = { x: VIEW.width - 250, y: 14, w: 236, h: 176 };

// The three boats anchored in the bay (x, y, hull colour).
const BOATS = [[70, 480, '#f4f6f8'], [100, 1420, '#e8b73d'], [55, 980, '#d94f3d']];
// The named places dotted on the minimap (place, colour).
const PLACE_DOTS = [
  [PLACES.marina, '#4fc3f7'], [PLACES.plaza, '#f2c94c'], [PLACES.docks, '#ffffff'],
  [PLACES.hideout, '#7ed957'], [PLACES.vault, '#e5534b'],
];

/** A cheap deterministic hash in [0, 1) for window placement on roofs. */
function hash(n) {
  let x = (n * 2654435761) | 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0x5bd1e995);
  x ^= x >>> 15;
  return ((x >>> 0) % 1000) / 1000;
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

  function text(value, x, y, size, color, align, bold) {
    const key = size + (bold ? 'b' : '');
    if (!fonts.has(key)) fonts.set(key, `${bold ? '700 ' : ''}${size}px ${FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align ?? 'left';
    context.textBaseline = 'alphabetic';
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

  function clockText(clock) {
    const h = Math.floor(clock / 3600) % 24;
    const m = Math.floor((clock % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Warm daylight tint by time of day: dawn/dusk gold, night deep blue. */
  function dayTint(clock) {
    const h = clock / 3600;
    if (h >= 6 && h < 9) return { color: '#ff9a3d', alpha: 0.10 };
    if (h >= 17 && h < 19.5) return { color: '#ff7a2d', alpha: 0.13 };
    if (h >= 19.5 || h < 6) return { color: '#1a2a55', alpha: 0.20 };
    return { color: '#ffd76a', alpha: 0.04 };
  }

  function drawWorld(state) {
    const city = state.city;
    const cam = state.camera;
    const vx0 = clamp(cam.x - VIEW.width / 2, 0, WORLD.width - VIEW.width);
    const vy0 = clamp(cam.y - VIEW.height / 2, 0, WORLD.height - VIEW.height);
    const vx1 = vx0 + VIEW.width;
    const vy1 = vy0 + VIEW.height;

    // Grass base, with mown stripes for a little texture.
    context.fillStyle = PALETTE.grass;
    context.fillRect(vx0, vy0, VIEW.width, VIEW.height);
    context.fillStyle = PALETTE.grassDark;
    for (let y = Math.floor(vy0 / 120) * 120; y < vy1; y += 240) {
      context.fillRect(vx0, y, VIEW.width, 120);
    }
    // Sea and beach on the west edge, waves and boats included.
    if (vx0 < CITY.beachWidth) {
      context.fillStyle = PALETTE.waterDeep;
      context.fillRect(vx0, vy0, Math.min(CITY.beachWidth - 130, vx1) - vx0, VIEW.height);
      context.fillStyle = PALETTE.water;
      context.fillRect(Math.max(vx0, 60), vy0, Math.min(CITY.beachWidth - 130, vx1) - Math.max(vx0, 60), VIEW.height);
      context.strokeStyle = 'rgba(255,255,255,0.35)';
      context.lineWidth = 2;
      for (let y = Math.floor(vy0 / 90) * 90; y < vy1; y += 90) {
        context.beginPath();
        context.moveTo(20, y + Math.sin(state.time * 1.4 + y * 0.05) * 6);
        context.quadraticCurveTo(70, y + 8, 120, y + Math.sin(state.time * 1.4 + y * 0.05) * 6);
        context.stroke();
      }
      for (const [bx, by, bc] of BOATS) {
        const bob = Math.sin(state.time * 1.1 + by * 0.01) * 4;
        context.fillStyle = bc;
        context.beginPath();
        context.ellipse(bx, by + bob, 26, 10, 0.2, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#5c5148';
        context.fillRect(bx - 2, by + bob - 22, 3, 22);
      }
      context.fillStyle = PALETTE.sand;
      context.fillRect(Math.max(vx0, CITY.beachWidth - 130), vy0, Math.min(CITY.beachWidth, vx1) - Math.max(vx0, CITY.beachWidth - 130), VIEW.height);
    }
    // The park.
    context.fillStyle = PALETTE.park;
    context.fillRect(city.park.x, city.park.y, city.park.w, city.park.h);
    context.strokeStyle = '#4a7d3a';
    context.lineWidth = 3;
    context.strokeRect(city.park.x, city.park.y, city.park.w, city.park.h);
    // Solmar Plaza: a paved square with a fountain at its centre.
    context.fillStyle = '#b9b3a4';
    context.fillRect(1472, 752, 296, 296);
    context.fillStyle = PALETTE.water;
    context.beginPath();
    context.arc(1620, 900, 34, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#e8e4d8';
    context.beginPath();
    context.arc(1620, 900, 20, 0, Math.PI * 2);
    context.fill();

    // Roads: sidewalk edge, asphalt, centre dashes.
    for (const line of city.vertical) {
      if (line < vx0 - 60 || line > vx1 + 60) continue;
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(line - CITY.roadWidth / 2 - CITY.sidewalk, vy0, CITY.roadWidth + CITY.sidewalk * 2, VIEW.height);
      context.fillStyle = PALETTE.road;
      context.fillRect(line - CITY.roadWidth / 2, vy0, CITY.roadWidth, VIEW.height);
      context.strokeStyle = PALETTE.roadLine;
      context.lineWidth = 3;
      context.setLineDash([26, 30]);
      context.beginPath();
      context.moveTo(line, vy0);
      context.lineTo(line, vy1);
      context.stroke();
      context.setLineDash([]);
    }
    for (const line of city.horizontal) {
      if (line < vy0 - 60 || line > vy1 + 60) continue;
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(vx0, line - CITY.roadWidth / 2 - CITY.sidewalk, VIEW.width, CITY.roadWidth + CITY.sidewalk * 2);
      context.fillStyle = PALETTE.road;
      context.fillRect(vx0, line - CITY.roadWidth / 2, VIEW.width, CITY.roadWidth);
      context.strokeStyle = PALETTE.roadLine;
      context.lineWidth = 3;
      context.setLineDash([26, 30]);
      context.beginPath();
      context.moveTo(vx0, line);
      context.lineTo(vx1, line);
      context.stroke();
      context.setLineDash([]);
    }

    // Buildings: shadow, coloured body, darker roof, lit windows.
    for (const b of city.buildings) {
      if (b.x + b.w < vx0 || b.x > vx1 || b.y + b.h < vy0 || b.y > vy1) continue;
      context.fillStyle = 'rgba(0,0,0,0.25)';
      context.fillRect(b.x + 6, b.y + 8, b.w, b.h);
      context.fillStyle = b.color;
      context.fillRect(b.x, b.y, b.w, b.h);
      context.fillStyle = PALETTE.roof;
      context.fillRect(b.x + 10, b.y + 10, b.w - 20, b.h - 20);
      context.fillStyle = 'rgba(255,240,180,0.75)';
      const cols = Math.max(2, Math.floor(b.w / 46));
      const rows = Math.max(2, Math.floor(b.h / 46));
      for (let cx = 0; cx < cols; cx += 1) {
        for (let cy = 0; cy < rows; cy += 1) {
          if (hash(b.seed * 31 + cx * 7 + cy * 13) < 0.45) {
            context.fillRect(b.x + 18 + cx * ((b.w - 36) / cols), b.y + 18 + cy * ((b.h - 36) / rows), 12, 9);
          }
        }
      }
    }
    // Trees.
    for (const t of city.trees) {
      if (t.x < vx0 - 30 || t.x > vx1 + 30 || t.y < vy0 - 30 || t.y > vy1 + 30) continue;
      context.fillStyle = '#3f7a34';
      context.beginPath();
      context.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#5da24a';
      context.beginPath();
      context.arc(t.x - 3, t.y - 3, t.r * 0.7, 0, Math.PI * 2);
      context.fill();
    }

    // Pickups: health cross, ammo box, cash.
    for (const p of state.pickups) {
      if (!p.active || p.x < vx0 - 30 || p.x > vx1 + 30 || p.y < vy0 - 30 || p.y > vy1 + 30) continue;
      const bob = Math.sin(p.bob) * 3;
      context.fillStyle = 'rgba(0,0,0,0.3)';
      context.beginPath();
      context.arc(p.x, p.y + 12, 12, 0, Math.PI * 2);
      context.fill();
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

    // Cars, pedestrians, police, player, bullets, particles.
    for (const car of state.cars) drawCar(state, car);
    for (const ped of state.peds) drawPed(ped);
    for (const cop of state.cops) drawCop(cop);
    drawPlayer(state);
    for (const b of state.bullets) {
      context.strokeStyle = '#ffe66d';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(b.x, b.y);
      context.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      context.stroke();
    }
    for (const p of state.particles) {
      context.globalAlpha = Math.max(0, p.life / p.max);
      context.fillStyle = p.color;
      context.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    context.globalAlpha = 1;

    // Warm daylight over everything.
    const tint = dayTint(state.clock);
    context.fillStyle = tint.color;
    context.globalAlpha = tint.alpha;
    context.fillRect(vx0, vy0, VIEW.width, VIEW.height);
    context.globalAlpha = 1;
    return { vx0, vy0 };
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
      text(t.label, t.x, t.y - 48, 17, '#ffffff', 'center', true);
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
      text(`${t.label} ${Math.round(Math.hypot(t.x - state.player.x, t.y - state.player.y))}m`, cx, cy - 20, 14, '#ffffff', 'center', true);
    }
  }

  function drawCar(state, car) {
    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.angle);
    const wreck = car.wrecked;
    context.fillStyle = 'rgba(0,0,0,0.3)';
    rr(-CAR.length / 2 + 3, -CAR.width / 2 + 4, CAR.length, CAR.width, 8);
    context.fill();
    context.fillStyle = wreck ? '#3a3a3a' : car.color;
    rr(-CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 8);
    context.fill();
    if (car.kind === 'cop') {
      context.fillStyle = PALETTE.copBlue;
      context.fillRect(-6, -CAR.width / 2, 12, CAR.width);
      // Flashing light bar.
      const flash = Math.floor(state.time * 6) % 2 === 0;
      context.fillStyle = flash ? '#ff3b30' : '#2f6df6';
      context.fillRect(-4, -CAR.width / 2 - 3, 8, 7);
      context.fillStyle = flash ? '#2f6df6' : '#ff3b30';
      context.fillRect(-4, CAR.width / 2 - 4, 8, 7);
    } else if (car.kind === 'taxi') {
      context.fillStyle = '#111111';
      context.fillRect(-CAR.length / 2 + 8, -CAR.width / 2, CAR.length - 16, 5);
      context.fillRect(-CAR.length / 2 + 8, CAR.width / 2 - 5, CAR.length - 16, 5);
    }
    context.fillStyle = wreck ? '#222' : '#1d2733';
    context.fillRect(-4, -CAR.width / 2 + 4, 14, CAR.width - 8);
    context.fillStyle = wreck ? '#333' : 'rgba(200,230,255,0.85)';
    context.fillRect(CAR.length / 2 - 12, -CAR.width / 2 + 5, 7, CAR.width - 10);
    if (car.driver === 'player') {
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      rr(-CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 8);
      context.stroke();
    }
    context.restore();
    if (wreck && Math.floor(state.time * 3) % 2 === 0) {
      context.fillStyle = 'rgba(120,120,120,0.5)';
      context.beginPath();
      context.arc(car.x, car.y - 10, 8, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawPed(ped) {
    if (ped.down > 0) {
      context.fillStyle = ped.color;
      context.beginPath();
      context.ellipse(ped.x, ped.y, 14, 8, ped.angle, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.fillStyle = 'rgba(0,0,0,0.25)';
    context.beginPath();
    context.arc(ped.x + 2, ped.y + 3, PED.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = ped.color;
    context.beginPath();
    context.arc(ped.x, ped.y, PED.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f2c9a0';
    context.beginPath();
    context.arc(ped.x + Math.cos(ped.angle) * 3, ped.y + Math.sin(ped.angle) * 3, 5, 0, Math.PI * 2);
    context.fill();
  }

  function drawCop(cop) {
    context.fillStyle = 'rgba(0,0,0,0.25)';
    context.beginPath();
    context.arc(cop.x + 2, cop.y + 3, PED.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#1d3a6e';
    context.beginPath();
    context.arc(cop.x, cop.y, PED.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f2c9a0';
    context.beginPath();
    context.arc(cop.x, cop.y - 2, 5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#0f2247';
    context.fillRect(cop.x - 6, cop.y - 9, 12, 5);
    // Star badge.
    context.fillStyle = PALETTE.gold;
    context.beginPath();
    context.arc(cop.x + 5, cop.y + 4, 2.5, 0, Math.PI * 2);
    context.fill();
  }

  function drawPlayer(state) {
    const player = state.player;
    if (player.car) return; // the car drawing shows the player
    if (player.invuln > 0 && Math.floor(player.invuln * 10) % 2 === 0) return; // blink after a hit
    context.fillStyle = 'rgba(0,0,0,0.3)';
    context.beginPath();
    context.arc(player.x + 2, player.y + 3, PLAYER.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#e5534b';
    context.beginPath();
    context.arc(player.x, player.y, PLAYER.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f2c9a0';
    context.beginPath();
    context.arc(player.x + Math.cos(player.angle) * 4, player.y + Math.sin(player.angle) * 4, 6, 0, Math.PI * 2);
    context.fill();
    // Gun barrel shows the aim direction.
    context.strokeStyle = '#222';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(player.x + Math.cos(player.angle) * 10, player.y + Math.sin(player.angle) * 10);
    context.lineTo(player.x + Math.cos(player.angle) * 24, player.y + Math.sin(player.angle) * 24);
    context.stroke();
  }

  function drawHud(state) {
    const player = state.player;
    // Top-left panel: money, health, ammo.
    context.fillStyle = 'rgba(10,14,20,0.72)';
    rr(14, 12, 250, 96, 10);
    context.fill();
    text(`$${player.money.toLocaleString('en-US')}`, 28, 46, 30, PALETTE.gold, 'left', true);
    context.fillStyle = '#333';
    context.fillRect(28, 58, 180, 12);
    context.fillStyle = player.health > 40 ? PALETTE.green : PALETTE.red;
    context.fillRect(28, 58, 180 * Math.max(0, player.health) / PLAYER.health, 12);
    text(`HP ${Math.max(0, Math.round(player.health))}`, 214, 70, 14, PALETTE.text, 'left', true);
    text(`Ammo ${player.ammo}`, 28, 96, 16, PALETTE.text, 'left');
    text(player.car ? 'DRIVING' : 'ON FOOT', 170, 96, 16, PALETTE.blue, 'left', true);

    // Top-centre: current job, with its number and a progress bar.
    const mission = state.mission;
    if (mission) {
      const label = `JOB ${mission.index + 1}/${JOB_COUNT}  •  ${mission.def.title}  •  $${mission.def.reward}`;
      const obj = missionObjective(state);
      const prog = missionProgress(state);
      const h = prog ? 80 : 62;
      const w = 480;
      context.fillStyle = 'rgba(10,14,20,0.72)';
      rr(VIEW.width / 2 - w / 2, 12, w, h, 10);
      context.fill();
      text(label, VIEW.width / 2, 38, 18, PALETTE.gold, 'center', true);
      text(obj, VIEW.width / 2, 62, 15, PALETTE.text, 'center');
      if (prog) {
        context.fillStyle = '#333';
        context.fillRect(VIEW.width / 2 - 200, 72, 400, 7);
        context.fillStyle = PALETTE.gold;
        context.fillRect(VIEW.width / 2 - 200, 72, 400 * Math.max(0, Math.min(1, prog.frac)), 7);
      }
      if (mission.timer > 0 && (mission.index === 1 || mission.index === 5)) {
        text(`${Math.ceil(mission.timer)}s`, VIEW.width / 2 + w / 2 - 34, 38, 16, PALETTE.red, 'center', true);
      }
    }

    // Minimap, top-right, with the wanted stars beneath it.
    drawMinimap(state);
    const starsY = MINIMAP.y + MINIMAP.h + 26;
    text('WANTED', MINIMAP.x + 4, starsY, 14, PALETTE.text, 'left', true);
    for (let i = 0; i < 5; i += 1) {
      const x = MINIMAP.x + 78 + i * 30;
      const lit = i < state.wanted;
      const flash = state.wanted >= 3 && Math.floor(state.time * 4) % 2 === 0;
      context.fillStyle = lit ? (flash ? '#ffdf5e' : PALETTE.gold) : 'rgba(255,255,255,0.25)';
      context.beginPath();
      for (let p = 0; p < 5; p += 1) {
        const a = -Math.PI / 2 + (p * Math.PI * 2) / 5;
        const px = x + Math.cos(a) * 12;
        const py = starsY - 4 + Math.sin(a) * 12;
        if (p === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    }

    // Bottom-left: speed in its own dark chip, the car's health bar under it.
    if (player.car) {
      const kmh = Math.round(Math.abs(player.car.speed) * 0.36);
      context.fillStyle = 'rgba(10,14,20,0.72)';
      rr(14, VIEW.height - 78, 118, 64, 10);
      context.fill();
      text(`${kmh}`, 28, VIEW.height - 40, 34, PALETTE.text, 'left', true);
      text('km/h', 92, VIEW.height - 40, 15, PALETTE.muted, 'left');
      const carHealth = Math.max(0, player.car.health) / 100;
      context.fillStyle = '#333';
      context.fillRect(28, VIEW.height - 30, 90, 6);
      context.fillStyle = carHealth > 0.4 ? PALETTE.green : PALETTE.red;
      context.fillRect(28, VIEW.height - 30, 90 * carHealth, 6);
    }
    text('WASD move/drive  •  E enter car  •  Click shoot  •  F punch  •  Shift handbrake  •  P pause  •  M mute', 14, VIEW.height - 8, 13, 'rgba(255,255,255,0.75)', 'left');
    // Bottom-right: clock and day.
    text(`${clockText(state.clock)}  •  Day ${state.day}`, VIEW.width - 14, VIEW.height - 8, 15, PALETTE.text, 'right', true);

    // Transient centre message.
    if (state.messageTimer > 0 && state.message) {
      context.globalAlpha = Math.min(1, state.messageTimer);
      text(state.message, VIEW.width / 2, 108, 20, PALETTE.gold, 'center', true);
      context.globalAlpha = 1;
    }
  }

  function drawMinimap(state) {
    const sx = MINIMAP.w / WORLD.width;
    const sy = MINIMAP.h / WORLD.height;
    context.fillStyle = 'rgba(10,14,20,0.78)';
    rr(MINIMAP.x - 4, MINIMAP.y - 4, MINIMAP.w + 8, MINIMAP.h + 8, 8);
    context.fill();
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
    // Player: a white triangle pointing where they face.
    context.save();
    context.translate(px(state.player.x), py(state.player.y));
    context.rotate(state.player.angle);
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.moveTo(7, 0);
    context.lineTo(-5, -5);
    context.lineTo(-5, 5);
    context.closePath();
    context.fill();
    context.restore();
    context.restore();
    context.strokeStyle = 'rgba(255,255,255,0.35)';
    context.lineWidth = 1;
    context.strokeRect(MINIMAP.x, MINIMAP.y, MINIMAP.w, MINIMAP.h);
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const height = 150 + lines.length * 32;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    rr(x, y, width, height, 14);
    context.fill();
    context.strokeStyle = accent || PALETTE.gold;
    context.lineWidth = 2;
    rr(x, y, width, height, 14);
    context.stroke();
    text(title, VIEW.width / 2, y + 62, 44, accent || PALETTE.gold, 'center', true);
    lines.forEach((line, i) => {
      text(line, VIEW.width / 2, y + 108 + i * 32, 19, i === 0 ? PALETTE.text : PALETTE.muted, 'center');
    });
    if (prompt) text(prompt, VIEW.width / 2, y + height - 26, 20, PALETTE.gold, 'center', true);
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
