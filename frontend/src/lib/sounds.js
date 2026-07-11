const FILES = {
  answer1: "/sounds/answer1.mp3",
  answer2: "/sounds/answer2.mp3",
  tick: "/sounds/tick.mp3",
  round: "/sounds/round.mp3",
};

const cache = {};
let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

/** Resume the audio context after a user gesture (browser autoplay policy). */
export function unlockAudio() {
  const c = getCtx();
  if (c.state === "suspended") c.resume().catch(() => {});
}

function playTone(freq, duration, { type = "sine", gain = 0.25, delay = 0 } = {}) {
  unlockAudio();
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.connect(g);
  g.connect(c.destination);
  osc.type = type;
  osc.frequency.value = freq;
  const t = c.currentTime + delay;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.start(t);
  osc.stop(t + duration + 0.01);
}

function playClick(duration = 0.05, gain = 0.2) {
  unlockAudio();
  const c = getCtx();
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const env = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * env * gain;
  }
  const src = c.createBufferSource();
  const g = c.createGain();
  src.buffer = buffer;
  src.connect(g);
  g.connect(c.destination);
  const t = c.currentTime;
  g.gain.setValueAtTime(1, t);
  src.start(t);
}

const SYNTH = {
  // First player locks in their answer — bright upward ping
  answer1: () => playTone(659, 0.1, { gain: 0.3 }),
  // Second player answers — slightly lower confirmation tone
  answer2: () => playTone(494, 0.12, { gain: 0.28 }),
  // Final 3 seconds warning — sharp tick
  tick: () => playClick(0.04, 0.35),
  // New round preview — two-note "get ready" chime
  round: () => {
    playTone(440, 0.14, { gain: 0.22 });
    playTone(660, 0.18, { gain: 0.22, delay: 0.14 });
  },
};

function playFromFile(name) {
  const src = FILES[name];
  if (!src) return Promise.reject();
  let audio = cache[name];
  if (!audio) {
    audio = new Audio(src);
    cache[name] = audio;
  } else {
    audio.currentTime = 0;
  }
  return audio.play();
}

// Plays a short SFX by name. Tries bundled mp3 first; falls back to Web Audio
// synthesis so sounds always work even without asset files.
export function playSound(name) {
  const synth = SYNTH[name];
  if (!synth) return;
  playFromFile(name).catch(() => synth());
}
