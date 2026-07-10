const FILES = {
  answer1: "/sounds/answer1.mp3",
  answer2: "/sounds/answer2.mp3",
  tick: "/sounds/tick.mp3",
};

const cache = {};

// Plays a short SFX by name. Safe to call even if the audio file hasn't been
// added yet (frontend/public/sounds/*.mp3 are provided by the user) — a
// missing file or browser autoplay block both fail silently, never throwing
// or logging to the console in a way that would alarm the user.
export function playSound(name) {
  const src = FILES[name];
  if (!src) return;
  let audio = cache[name];
  if (!audio) {
    audio = new Audio(src);
    cache[name] = audio;
  } else {
    audio.currentTime = 0;
  }
  audio.play().catch(() => {});
}
