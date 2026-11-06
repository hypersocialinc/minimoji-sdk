// THE PRESENTER — a Mini avatar presents a deck: one voiced line per slide, one bubble caption at a time with the
// word being said lit, content revealed on its word, the next slide when the line ends. A slide may wait for the
// person (a choice, a permission, a sign-in) in the host's own UI, and a choice may pick the next slide.
//
// No product content lives here: the deck is slides.json plus the slide markup in the page. The rules behind every
// number are in ../SKILL.md (the minimoji-presenter skill). Plain ES module, no build:
//
//   const deck = await startPresenter(document.querySelector('.pd'), { slides: 'slides.json' });
//   deck.on('waiting', ({ id, for: event }) => …);   deck.done('topic', 'filing');   deck.skip();
//
// Events (`deck.on(name, fn)`, also dispatched on the root as `presenter:<name>` CustomEvents):
//   step     { index, id }                 a slide starts (its line plays)
//   waiting  { index, id, for, prompt }    its line ended and it waits for deck.done(for, value)
//   done     { index, id, for, value }     the host answered; the deck moves on
//   ended    { skipped }                   the ending shows (after the last slide, or deck.skip())

/** the bundle, straight from minimoji.com (it answers CORS *), else the pinned copy beside this file */
export const SDK_URLS = ['https://www.minimoji.com/sdk/minimoji-heads.js', './vendor/minimoji-heads.js'];
const CLIP_WAIT_MS = 8000;      // the longest a slide waits for its clip, then it plays silently
const CASCADE_S = 0.25;         // several elements under one reveal selector arrive this far apart
const NUDGE_AFTER_MS = 8000;

/** sha256 of a slide's `say`, hex: the manifest's textSha256 (minimoji say --texts writes it) */
export async function textSha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** each slide whose lines/manifest.json entry came from another text: a console warning per slide */
export async function checkDrift(deck, manifest, warn = console.warn) {
  const drifted = [];
  for (const [i, s] of deck.slides.entries()) {
    const entry = manifest?.lines?.[`slide${i}`];
    if (entry && entry.textSha256 !== await textSha256(s.say)) {
      drifted.push(i);
      warn(`minimoji-presenter: slide${i} ("${s.say.slice(0, 40)}…") is not the text its line was voiced from; run scripts/make-lines.sh`);
    }
  }
  return drifted;
}

/** where a slide goes after it: `next` by the host's value, `next` as one id, else the next in order; 'end' ends */
export function nextIndex(deck, i, value) {
  const s = deck.slides[i], pick = s.next == null ? null : typeof s.next === 'string' ? s.next : s.next[String(value)];
  if (pick === 'end') return 'end';
  if (pick != null) {
    const at = deck.slides.findIndex((x) => x.id === pick);
    if (at >= 0) return at;
    console.warn(`minimoji-presenter: slide ${s.id ?? i} names no slide "${pick}"; going on in order`);
  }
  return i + 1 < deck.slides.length ? i + 1 : 'end';
}

/** a clip's URL in memory (fetch → Blob → object URL), or null; the line JSON, or null. A missing or broken file is
 *  said once in the console: the slide still plays, silently on its own clock. An `optional` clip (a nudge's) that is
 *  simply not there is quiet: its text shows silently, by design */
async function loadClip(base, name, { optional = false } = {}) {
  const get = (url, read) => fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return read(r);
  }).catch((error) => { if (!optional || !/HTTP 404/.test(error.message)) console.warn(`minimoji-presenter: no ${url} (${error.message ?? error}); ${name} plays silently`); return null; });
  const [line, audio] = await Promise.all([get(`${base}${name}.json`, (r) => r.json()), get(`${base}${name}.wav`, async (r) => URL.createObjectURL(await r.blob()))]);
  return { line, audio };
}

/** a refused play() is expected when autoplay is blocked or a newer clip cut it off; anything else is a broken clip */
const playRefused = (what) => (error) => {
  if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') console.warn(`minimoji-presenter: ${what}'s audio could not play`, error);
};

/** the first bundle that loads and has the bubble captions (an older one lacks them), or null: the still image */
async function loadSdk(urls) {
  for (const url of urls) {
    try {
      const sdk = await import(url);
      if (typeof sdk.capsFromLine === 'function' && typeof sdk.mountHeadPerformance === 'function') return sdk;
      console.warn(`minimoji-presenter: ${url} is an older bundle (no capsFromLine); trying the next`);
    } catch (error) { console.warn(`minimoji-presenter: ${url} did not load (${error?.message ?? error}); trying the next`); }
  }
  console.warn('minimoji-presenter: no heads bundle loaded; showing the still image');
  return null;
}

/** a clock that stops while paused: the silent line's, and the beats' when there is no audio */
function pausableClock() {
  let base = 0, from = performance.now(), running = false;
  return {
    now: () => (base + (running ? performance.now() - from : 0)) / 1000,
    reset() { base = 0; from = performance.now(); },
    run(on) { if (on === running) return; if (on) from = performance.now(); else base += performance.now() - from; running = on; },
  };
}

export async function startPresenter(root, { slides = 'slides.json', lines = 'lines/', sdkUrls = SDK_URLS, resume = false } = {}) {
  const deck = typeof slides === 'string' ? await fetch(slides).then((r) => {
    if (!r.ok) throw new Error(`minimoji-presenter: ${slides} answered ${r.status}`);
    return r.json();
  }) : slides;
  const $ = (sel, el = root) => el.querySelector(sel), $$ = (sel, el = root) => [...el.querySelectorAll(sel)];
  const slideEls = $$('[data-pd-slide]');
  if (slideEls.length !== deck.slides.length) throw new Error(`minimoji-presenter: slides.json has ${deck.slides.length} slides and the page ${slideEls.length} [data-pd-slide] elements`);
  const mount = $('.pd-head'), poster = $('.pd-poster'), bubble = $('.pd-bubble'), audio = new Audio();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners = {}, emit = (name, detail) => {
    for (const fn of listeners[name] ?? []) {
      try { fn(detail); } catch (error) { console.warn(`minimoji-presenter: a "${name}" listener threw`, error); }
    }
    root.dispatchEvent(new CustomEvent(`presenter:${name}`, { detail }));   // the DOM reports its listeners' errors itself
  };
  const storeKey = `minimoji-presenter:${location.pathname}`;
  const holdMs = deck.holdMs ?? 250;

  // every slide's clip in memory before it plays; reveal targets hidden until their word
  const clips = deck.slides.map((s, i) => loadClip(lines, `slide${i}`));
  const nudges = deck.slides.map((s, i) => (s.wait?.nudge ? loadClip(lines, `slide${i}-nudge`, { optional: true }) : null));
  fetch(`${lines}manifest.json`).then((r) => (r.ok ? r.json() : null)).then((m) => m && checkDrift(deck, m))
    .catch((error) => console.warn('minimoji-presenter: the drift check did not run', error));   // no manifest is quiet
  deck.slides.forEach((s, i) => (s.reveals ?? []).forEach((r) => $$(r.selector, slideEls[i]).forEach((el) => el.classList.add('pd-hidden'))));

  // the head: the still image until the SDK's head draws; a head that throws goes back to the still for good
  const sdk = await loadSdk(sdkUrls);
  let stage = null;
  const dropHead = (error) => {
    if (error) console.warn('minimoji-presenter: the head stopped; showing the still image', error);
    try { stage?.dispose(); } catch {}
    stage = null; poster.hidden = false;
  };
  if (sdk) {
    try {
      stage = sdk.mountHeadPerformance(mount, {
        avatar: {}, character: deck.character ?? { id: 'agent' }, crt: 1, bursts: false, reduceMotion: reduce,
        onHeadTop: (px) => root.style.setProperty('--headTop', `${px}px`),
      });
      poster.hidden = true;
    } catch (error) { dropHead(error); }
  }
  const clock = pausableClock();
  const player = sdk?.createLinePlayer({
    now: clock.now,
    onCue: (cue, quiet) => stage && sdk.applySpeechCue(stage, cue, undefined, quiet),
    onEnd: (gen, reason) => { if (reason === 'ended' && run?.gen === gen) lineEnded(); },
  });

  // the show's state: the slide, its line's run, waiting, paused, ended
  let index = 0, run = null, waiting = null, paused = false, ended = false, started = false, sound = true, timer = 0, glance = 0;
  let byVisitor = true, caps = [], capIndex = -1;
  const look = (sel, slideEl) => {
    if (!stage) return;
    if (sel === 'viewer') return stage.look(null, sdk.LOOK_HOLD);
    const el = sel && $(sel, slideEl);
    try { if (el) stage.look(sdk.lookTargetFor(el, mount), 2); } catch { /* not on screen */ }
  };

  // ─── captions: one phrase in the bubble, the word being said in a pill ───
  function showCaption(t, words = null) {
    if (words) { caps = words; capIndex = -1; }
    const at = sdk ? sdk.captionAt(caps, t) : { index: caps.findIndex((c) => t < c.end), lit: -1 };
    const i = at.index < 0 ? caps.length - 1 : at.index;
    if (i !== capIndex) {
      capIndex = i;
      const text = $('.pd-bubble-text');
      text.replaceChildren(...(caps[i]?.words ?? []).flatMap((w, n) => [n ? ' ' : '', Object.assign(document.createElement('span'), { textContent: w.text })]));
      if (reduce) { text.classList.remove('pd-fade'); void text.offsetWidth; text.classList.add('pd-fade'); }
    }
    $$('.pd-bubble-text span').forEach((el, n) => el.classList.toggle('is-lit', n === at.lit));
  }
  const textCaption = (text) => [{ start: 0, end: Infinity, words: text.split(/\s+/).filter(Boolean).map((w) => ({ text: w, start: Infinity, end: Infinity })) }];
  /** the line's bubble captions (the SDK's capsFromLine); without the SDK, its own caption phrases unlit */
  const capsFor = (line, say) => (sdk ? sdk.capsFromLine(line, say)
    : line?.captions?.length ? line.captions.map((c) => ({ start: c.start, end: c.end, words: c.text.split(' ').map((w) => ({ text: w, start: Infinity, end: Infinity })) })) : textCaption(say));

  // ─── a slide: its wash and place, its line, its beats and reveals ───
  async function play(i, { visitor = false } = {}) {
    clearTimeout(timer); clearInterval(glance); player?.stop(); audio.pause();
    // the old slide's run ends now, not when this clip arrives: nothing of it may end, wait or caption meanwhile
    run = null; clock.run(false);
    index = i; waiting = null; ended = false; byVisitor = visitor; paused = false;
    const s = deck.slides[i], el = slideEls[i];
    if (resume) try { sessionStorage.setItem(storeKey, String(i)); } catch {}
    slideEls.forEach((x, n) => x.classList.toggle('is-on', n === i));
    $$('.pd-dot').forEach((d, n) => d.setAttribute('aria-current', n === i ? 'step' : 'false'));
    root.dataset.pos = s.pos ?? 'center';
    root.classList.remove('is-ended', 'is-waiting', 'is-paused');
    root.style.setProperty('--wash', s.wash ?? '#fff');
    root.classList.toggle('is-dark', !!s.dark);   // a charcoal bubble on a dark slide, never a white one
    $$('.pd-hidden.is-in', el).forEach((x) => x.classList.remove('is-in'));
    bubble.hidden = false;
    emit('step', { index: i, id: s.id ?? `slide${i}` });

    const late = Symbol('late');
    let clip = await Promise.race([clips[i], new Promise((r) => setTimeout(() => r(late), CLIP_WAIT_MS))]);
    if (clip === late) { console.warn(`minimoji-presenter: slide${i}'s clip took over ${CLIP_WAIT_MS / 1000} s; it plays silently`); clip = {}; }
    if (index !== i || ended) return;
    let { line, audio: src } = clip;
    // a line the player refuses (not the line format) plays the slide silently on its own clock, never stalls it
    if (sdk && line) {
      try { sdk.validateLine(line); } catch (error) { console.warn(`minimoji-presenter: slide${i}.json is not a line; it plays silently`, error); line = null; src = null; }
    }
    const voiced = !!(sound && src && line);
    const r = run = { gen: 0, line, s, el, i, voiced, beat: 0, revealed: new Set(), duration: line?.duration ?? s.say.split(/\s+/).length * 0.36 + 0.4 };
    r.reveals = (s.reveals ?? []).flatMap((rv, k) => $$(rv.selector, el).map((target, n) => ({ target, at: (sdk?.wordTime(line, rv.word, k + 1) ?? k + 1) + n * CASCADE_S })));
    r.beats = [...(s.beats ?? [])].sort((a, b) => a.at - b.at);
    showCaption(0, capsFor(line, s.say));
    safely(() => { if (stage && s.mood) stage.setMood(s.mood); if (stage && s.gesture) stage.gesture(s.gesture); });
    clock.reset(); clock.run(!paused);   // a pause pressed while the clip loaded holds the line at its start
    if (voiced) { audio.src = src; audio.currentTime = 0; if (!paused) audio.play().catch(playRefused(`slide${i}`)); }
    if (player && line) r.gen = player.say(line, voiced ? { audio, follow: true } : {});
  }
  audio.addEventListener('error', () => console.warn(`minimoji-presenter: slide${index}'s audio did not decode`, audio.error));
  audio.addEventListener('ended', () => { if (run?.voiced && !paused) lineEnded(); });   // the safety net beside onEnd

  function lineEnded() {
    const r = run; if (!r || r.over) return;
    r.over = true;
    r.reveals.forEach((x) => x.target.classList.add('is-in'));
    const s = r.s;
    if (s.wait) {
      waiting = { for: s.wait.for, index: r.i };
      root.classList.add('is-waiting');
      if (s.wait.prompt) showCaption(0, textCaption(s.wait.prompt));
      safely(() => { if (stage) { stage.setMood('happy'); stage.look(null, sdk.LOOK_HOLD); } });
      emit('waiting', { index: r.i, id: s.id ?? `slide${r.i}`, for: s.wait.for, prompt: s.wait.prompt ?? null });
      armNudge();
      return;
    }
    // reduced motion: the deck moves on by itself only after a slide the visitor chose
    if (reduce && !byVisitor) return;
    timer = setTimeout(() => advance(), holdMs);
  }

  function armNudge() {
    const w = deck.slides[index].wait;
    if (waiting && w?.nudge && !waiting.nudged) timer = setTimeout(() => nudge(index), w.nudgeAfterMs ?? NUDGE_AFTER_MS);
  }
  /** once, if the person has not answered: the nudge's clip, or its text silently in the bubble when there is none */
  async function nudge(i) {
    if (!waiting || index !== i || paused) return;
    waiting.nudged = true;
    const s = deck.slides[i], { line, audio: src } = await nudges[i];
    if (!waiting || index !== i) return;
    const voiced = line && src && sound;
    showCaption(0, voiced ? capsFor(line, s.wait.nudge) : textCaption(s.wait.nudge));   // silent text lights no word
    if (voiced) {
      run = { ...run, line, over: true, beats: [], reveals: [], duration: line.duration, nudging: true };
      clock.reset(); clock.run(true);
      audio.src = src; audio.currentTime = 0; audio.play().catch(playRefused(`slide${i}-nudge`));
      try { run.gen = player?.say(line, { audio, follow: true }); } catch (error) { console.warn(`minimoji-presenter: slide${i}-nudge.json is not a line`, error); }
    }
  }

  function advance(value) {
    const next = nextIndex(deck, index, value);
    if (next === 'end') ending(false); else play(next);
  }

  function ending(skipped) {
    clearTimeout(timer); clearInterval(glance); player?.stop(); audio.pause();
    run = null; waiting = null; ended = true; paused = false;
    const e = deck.ending ?? {};
    root.classList.remove('is-waiting', 'is-paused');
    root.classList.add('is-ended');
    root.classList.remove('is-dark');
    root.style.setProperty('--wash', e.wash ?? '#fff');   // its own wash, never the last slide's (often dark)
    root.dataset.pos = e.pos ?? 'left';
    bubble.hidden = true;
    if (resume) try { sessionStorage.removeItem(storeKey); } catch {}
    if (stage) {
      stage.setMood(e.mood ?? 'joy');
      let n = 0;
      glance = setInterval(() => {
        if (!stage || reduce) return;
        look(n % 2 ? 'viewer' : e.lookAt, root);
        stage.gesture(n++ % 2 ? 'ponder-tilt' : 'sunny-nod');
      }, e.glanceEveryMs ?? 2800);
      look(e.lookAt, root);
    }
    emit('ended', { skipped });
  }

  // ─── one frame loop for the page ───
  let last = performance.now(), raf = 0, warned = false;
  /** a head call that throws drops the head (the still image); the show goes on */
  function safely(fn) { try { fn(); } catch (error) { dropHead(error); } }
  function frame(now) {
    raf = requestAnimationFrame(frame);   // first: nothing below can stop the loop
    try { step(now); } catch (error) { if (!warned) { warned = true; console.warn('minimoji-presenter: a frame failed; the show goes on', error); } }
  }
  function step(now) {
    const dt = (now - last) / 1000; last = now;
    try {
      const tick = player?.tick();
      if (stage) tick ? stage.frame(dt, tick.sample) : stage.idleFrame(dt);
    } catch (error) { dropHead(error); }
    const r = run;
    if (r && started && !paused && !ended) {
      const t = (r.voiced || r.nudging) && !audio.paused ? audio.currentTime : clock.now();
      if (!r.over) {
        showCaption(t);
        for (const x of r.reveals) if (t >= x.at && !r.revealed.has(x)) { r.revealed.add(x); x.target.classList.add('is-in'); }
        while (r.beat < r.beats.length && r.beats[r.beat].at <= t * 1000) {
          const b = r.beats[r.beat++];
          safely(() => {
            if (b.look) look(b.look, r.el);
            if (stage && b.mood) stage.setMood(b.mood);
            if (stage && b.gesture) stage.gesture(b.gesture);
            if (stage && b.react) stage.react(b.react);
          });
        }
        // no player (or no line): the slide's own clock ends it; with one, a clip that never played ends just after
        if (t >= r.duration + (player && r.line ? 0.6 : 0)) lineEnded();
      } else if (r.nudging) showCaption(t);
    }
  }
  raf = requestAnimationFrame(frame);

  // ─── controls: Play (a trusted click), pause, arrows, dots, keys, sound ───
  function setPaused(on) {
    if (!started || ended || on === paused) return;
    paused = on;
    root.classList.toggle('is-paused', on);
    clock.run(!on);
    if (on) { audio.pause(); clearTimeout(timer); return; }
    if (run && ((!run.over && run.voiced) || (run.nudging && !audio.ended))) audio.play().catch(playRefused(`slide${index}`));
    else if (run?.over && !waiting) timer = setTimeout(() => advance(), holdMs);
    else if (waiting) armNudge();
  }
  const go = (i) => { if (!started) return; play(((i % deck.slides.length) + deck.slides.length) % deck.slides.length, { visitor: true }); };
  /** forward: where the deck itself would go (its `next`, then the ending); a step waiting for the person is never
   *  skipped by an arrow: only deck.done() (or deck.skip()) moves it on */
  function forward() {
    if (!started || ended) return;
    if (waiting || deck.slides[index].wait) return console.info('minimoji-presenter: this step waits for the person; deck.done() moves it on');
    const next = nextIndex(deck, index);
    if (next === 'end') ending(false); else play(next, { visitor: true });
  }
  function begin(at = 0) { started = true; root.classList.add('is-started'); play(at, { visitor: true }); }

  $$('[data-pd-play]').forEach((b) => b.addEventListener('click', (e) => {
    if (!e.isTrusted) return;   // browsers allow sound after a person's click only
    e.stopPropagation();
    let at = 0;
    if (resume) try { at = Math.min(deck.slides.length - 1, Math.max(0, Number(sessionStorage.getItem(storeKey)) || 0)); } catch {}
    sound = true; begin(at);
  }));
  $$('[data-pd-replay]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); begin(0); }));
  $$('[data-pd-prev]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); go(ended ? deck.slides.length - 1 : index - 1); }));
  $$('[data-pd-next]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); forward(); }));
  $$('[data-pd-pause]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setPaused(!paused); }));
  $$('[data-pd-sound]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); sound = !sound; audio.muted = !sound; b.setAttribute('aria-pressed', String(sound));
  }));
  const dots = $('.pd-dots');
  deck.slides.forEach((s, i) => {
    const d = Object.assign(document.createElement('button'), { className: 'pd-dot', type: 'button' });
    d.setAttribute('aria-label', `Slide ${i + 1}`);
    d.addEventListener('click', (e) => {
      e.stopPropagation();
      const gate = deck.slides.findIndex((x, n) => x.wait && n < i && n >= (started ? index : 0));
      if (gate >= 0) return console.info(`minimoji-presenter: slide${gate} waits for the person first`);
      if (started) go(i); else begin(i);
    });
    dots?.append(d);
  });
  // a click anywhere on the card pauses, except on the host's own controls (a choice, a button, a link, a form)
  $('.pd-card').addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, select, textarea, label, [data-pd-ui]') || !started || ended) return;
    setPaused(!paused);
  });
  const onKey = (e) => {
    if (e.target.closest?.('input, select, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && started && !ended && !e.target.closest?.('button, a')) { e.preventDefault(); setPaused(!paused); }
    else if (e.key === 'ArrowRight') forward();
    else if (e.key === 'ArrowLeft' && started) go(ended ? deck.slides.length - 1 : index - 1);
  };
  addEventListener('keydown', onKey);
  requestAnimationFrame(() => root.classList.add('pd-ready'));   // positions animate from now on, never on the first slide

  const api = {
    deck,
    get index() { return index; },
    get waitingFor() { return waiting?.for ?? null; },
    get paused() { return paused; },
    on(name, fn) { (listeners[name] ??= []).push(fn); return () => { listeners[name] = listeners[name].filter((f) => f !== fn); }; },
    /** the host's answer to a waiting slide: `event` must be what it waits for; `value` may pick the next slide */
    done(event, value) {
      if (!waiting || waiting.for !== event) { console.warn(`minimoji-presenter: done("${event}") but the deck waits for ${waiting ? `"${waiting.for}"` : 'nothing'}`); return false; }
      const s = deck.slides[index];
      clearTimeout(timer); player?.stop(); audio.pause();
      emit('done', { index, id: s.id ?? `slide${index}`, for: event, value });
      waiting = null;
      advance(value);
      return true;
    },
    skip() { if (!started) started = true; ending(true); },
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    go,
    next: forward,
    dispose() {
      clearTimeout(timer); clearInterval(glance); cancelAnimationFrame(raf); removeEventListener('keydown', onKey);
      player?.stop(); audio.pause(); run = null; ended = true; dropHead();
      Promise.all([...clips, ...nudges.filter(Boolean)]).then((all) => all.forEach((c) => c.audio && URL.revokeObjectURL(c.audio)));
    },
  };
  return api;
}
