// a stand-in for minimoji.com/sdk/minimoji-heads.js where the repo's real
// bundle is not beside the tests (the exported CLI in minimoji-sdk): the
// same three exports, enough of buildLine's contract for `say` to be tested
// (tags leave the words, a known tag sets a mood), nothing of the engine
export const LINE_VERSION = 1;
const MOODS = { excited: "joy", happy: "happy", sad: "sad" };
export function buildLine({ pcm, sampleRate, words = [], mood = null }) {
  const duration = +(pcm.length / sampleRate).toFixed(5);
  const cues = mood ? [{ at: 0, mood, k: 0.3 }] : [];
  const kept = [];
  for (const w of words) {
    for (const [, tag] of w.text.matchAll(/\[([^\]]*)\]/g)) if (MOODS[tag]) cues.push({ at: w.start, mood: MOODS[tag], k: 0.3 });
    const text = w.text.replace(/\[[^\]]*\]/g, " ").trim();
    if (text) kept.push({ ...w, text });
  }
  const frames = Array.from({ length: Math.ceil(duration * 60) }, () => [0]);
  return { version: 1, fps: 60, duration, frames, captions: kept.length ? [{ text: kept.map((w) => w.text).join(" "), start: kept[0].start, end: kept.at(-1).end }] : [], words: kept, cues };
}
export function validateLine(line) {
  if (line?.version !== 1 || !(line.duration > 0) || line.frames.length !== Math.ceil(line.duration * 60)) throw Error("Invalid speech line");
  if (line.cues.some((c) => !["joy", "happy", "sad", "neutral"].includes(c.mood))) throw Error("Invalid speech line");
  return line;
}
