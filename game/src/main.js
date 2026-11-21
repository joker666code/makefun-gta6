// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps, and the renderer paints what is there. The game
// moves between four screens: title, play, paused and game over.
// Save data lives in localStorage; the best haul is kept beside it.
//
// ?seed=N fixes the city. ?shot=start|play|chase|mission (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.

import { BEST_KEY, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { buildCity } from './world.js';
import { createAudio } from './audio.js';
import {
  createState, resetRun, stepGame,
  EVENT_BUSTED, EVENT_CASH, EVENT_CRASH, EVENT_MISSION, EVENT_PICKUP, EVENT_SHOT, EVENT_WON,
} from './entities.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_MELEE, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const random = createRandom(seed);
const city = buildCity(random);
const state = createState(random, city);
window.__solmar = state; // debug hook: the live game state, for play-testing
const renderer = createRenderer(canvas);
const audio = createAudio();

function readNumber(key) {
  try {
    return Number.parseInt(window.localStorage.getItem(key) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best then lasts this visit.
  }
}

function saveGame() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: state.player.money,
      health: state.player.health,
      ammo: state.player.ammo,
      missionIndex: state.missionIndex,
      x: state.player.x,
      y: state.player.y,
      wanted: state.wanted,
      clock: state.clock,
      day: state.day,
      stats: state.stats,
    }));
  } catch {
    // A save that cannot be written is simply skipped.
  }
}

function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const save = JSON.parse(raw);
    resetRun(state);
    state.player.money = save.money ?? 120;
    state.player.health = save.health ?? 100;
    state.player.ammo = save.ammo ?? 24;
    state.player.x = save.x ?? state.player.x;
    state.player.y = save.y ?? state.player.y;
    state.wanted = save.wanted ?? 0;
    state.clock = save.clock ?? 9 * 3600;
    state.day = save.day ?? 1;
    if (save.stats) state.stats = save.stats;
    state.missionIndex = save.missionIndex ?? 0;
    state.mission = null;
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;
    return true;
  } catch {
    return false;
  }
}

function hasSave() {
  try {
    return window.localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

function runShot(name) {
  const scene = stageShot(name, state, stepGame);
  let painted = 0;
  function paint() {
    renderer.draw(state, scene.screen, { best: readNumber(BEST_KEY), saveExists: false });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readNumber(BEST_KEY);
  let accumulator = 0;
  let last = performance.now();

  function announce(message) {
    status.textContent = message;
  }

  function startGame(fresh) {
    if (fresh) resetRun(state);
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    announce('Playing. Steal a car and drive to the marina marker.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (state.player.money > best) {
      best = state.player.money;
      saveBest(best);
    }
    saveGame();
    announce(state.won ? 'You won. Port Solmar is yours.' : 'Busted. Game over.');
  }

  function handleActions(actions) {
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound muted.' : 'Sound on.');
    }
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startGame(true);
      return;
    }
    if (screen === SCREEN_OVER) {
      if (actions & ACTION_CONFIRM) startGame(true);
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions & ACTION_PAUSE || actions & ACTION_CONFIRM) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    if (actions & ACTION_PAUSE) {
      screen = SCREEN_PAUSED;
      saveGame();
      announce('Paused.');
    }
  }

  function handleTitleKeys(event) {
    if (screen === SCREEN_TITLE) {
      if (event.code === 'KeyC' && hasSave()) {
        if (loadGame()) startGame(false);
      } else if (event.code === 'KeyR') {
        startGame(true);
      }
      return;
    }
    // R also restarts straight from the game-over screen.
    if (screen === SCREEN_OVER && event.code === 'KeyR') startGame(true);
  }
  window.addEventListener('keydown', handleTitleKeys);

  function react(events) {
    if (events & EVENT_SHOT) audio.shot();
    if (events & EVENT_CRASH) audio.crash();
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_CASH) audio.cash();
    if (events & EVENT_MISSION) {
      audio.mission();
      saveGame();
      if (state.player.money > best) {
        best = state.player.money;
        saveBest(best);
      }
    }
    if (events & EVENT_BUSTED) audio.busted();
    if (events & EVENT_WON) audio.mission();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    // One-shot presses are taken once per frame and shared: the screen
    // handler gets confirm/pause/mute, the first step gets enter/melee.
    const actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_PLAY) {
      const move = input.move();
      const aim = renderer.toWorld(input.mouse.x, input.mouse.y, state.camera);
      let firstStep = true;
      while (accumulator >= STEP) {
        const ctl = {
          mx: move.x,
          my: move.y,
          run: input.running(),
          enter: firstStep && Boolean(actions & ACTION_ENTER),
          melee: firstStep && Boolean(actions & ACTION_MELEE),
          firing: input.mouse.down && !state.player.car,
          aimX: aim.x,
          aimY: aim.y,
        };
        firstStep = false;
        const events = stepGame(state, ctl, STEP);
        react(events);
        if (state.over) {
          endGame();
          break;
        }
        accumulator -= STEP;
      }
      audio.setEngine(state.player.car ? Math.abs(state.player.car.speed) / 560 : 0, Boolean(state.player.car));
      audio.setSiren(state.wanted > 0, STEP);
    } else {
      accumulator = 0;
      audio.setEngine(0, false);
      audio.setSiren(false, STEP);
    }
    renderer.draw(state, screen, { best, saveExists: hasSave() });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      saveGame();
      announce('Paused.');
    }
  });

  announce('Solmar Heat. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
