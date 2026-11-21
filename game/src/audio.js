// All sound is synthesised with WebAudio — no audio files, no network.
// Engine hum, a two-tone police siren, gunshots, a pickup chime, a crash
// thud and a mission jingle are all built from oscillators and filtered
// noise. The context is created on the first user gesture, so browsers
// that block autoplay stay silent until the player starts.

export function createAudio() {
  let context = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let muted = false;
  let volume = 0.5;
  let sirenOn = false;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      const engineFilter = context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      sirenOsc = context.createOscillator();
      sirenOsc.type = 'sine';
      sirenOsc.frequency.value = 720;
      sirenGain = context.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
    } catch {
      return false;
    }
    return true;
  }

  function blip(freq, dur, type, vol, slideTo) {
    if (!ensure() || muted) return;
    try {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, context.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, context.currentTime + dur);
      const gain = context.createGain();
      gain.gain.setValueAtTime(vol, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(context.currentTime + dur);
    } catch {
      // Sound is garnish: a failed blip never stops the game.
    }
  }

  function noise(dur, vol, freq) {
    if (!ensure() || muted) return;
    try {
      const length = Math.floor(context.sampleRate * dur);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq;
      const gain = context.createGain();
      gain.gain.value = vol;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start();
    } catch {
      // Sound is garnish.
    }
  }

  return {
    /** Call from a click or key press; browsers need a gesture to start audio. */
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : volume;
      return muted;
    },
    /** Master volume 0..1 (default 0.5); honoured by the mute toggle. */
    setVolume(level) {
      volume = Math.max(0, Math.min(1, level));
      if (master) master.gain.value = muted ? 0 : volume;
      return volume;
    },
    isMuted() {
      return muted;
    },
    /** Continuous engine note: pitch follows the driven car's speed. */
    setEngine(speedRatio, driving) {
      if (!ensure() || muted) {
        if (engineGain) engineGain.gain.value = 0;
        return;
      }
      try {
        engineOsc.frequency.value = 52 + speedRatio * 130;
        engineGain.gain.setTargetAtTime(driving ? 0.05 + speedRatio * 0.05 : 0, context.currentTime, 0.08);
      } catch {
        // Ignore.
      }
    },
    /** Two-tone siren while any police are chasing; call every frame. */
    setSiren(active, dt) {
      sirenOn = active;
      if (!ensure()) return;
      try {
        if (!active || muted) {
          sirenGain.gain.setTargetAtTime(0, context.currentTime, 0.1);
          return;
        }
        sirenTimer += dt;
        const tone = Math.floor(sirenTimer / 0.45) % 2 === 0 ? 720 : 980;
        sirenOsc.frequency.setTargetAtTime(tone, context.currentTime, 0.05);
        sirenGain.gain.setTargetAtTime(0.035, context.currentTime, 0.1);
      } catch {
        // Ignore.
      }
    },
    shot() {
      noise(0.12, 0.5, 2400);
    },
    copShot() {
      noise(0.1, 0.25, 1800);
    },
    pickup() {
      blip(660, 0.12, 'sine', 0.35, 990);
    },
    cash() {
      blip(880, 0.1, 'triangle', 0.35);
      setTimeout(() => blip(1320, 0.14, 'triangle', 0.3), 90);
    },
    crash() {
      noise(0.25, 0.6, 500);
    },
    punch() {
      noise(0.08, 0.4, 900);
    },
    mission() {
      blip(523, 0.14, 'triangle', 0.4);
      setTimeout(() => blip(659, 0.14, 'triangle', 0.4), 130);
      setTimeout(() => blip(784, 0.22, 'triangle', 0.4), 260);
    },
    busted() {
      blip(330, 0.5, 'sawtooth', 0.3, 110);
    },
  };
}
