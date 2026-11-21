import type { CharacterSelection } from './engine/characters';
import type { SpeechLine, LineCue, LineAudio } from './engine/line';
import type { SpeechClip, ClipCache, ClipTranscriber, TextClip, ClipSynthesizer } from './engine/clip';
import type * as React from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { Camera, Group, Material, Scene, Texture, WebGLRenderer } from 'three';

// ---- THE AVATAR SPEC — the unions mirror packages/core/src/inventory.js (tested equal to
// packages/core/inventory.json); normalize() is the acceptance contract, and what it returns is `Avatar`.
export type HeadShape = 'round' | 'oval' | 'wide' | 'square';
export type Skin = 'porcelain' | 'fair' | 'tan' | 'brown' | 'deep' | 'espresso' | 'rosy';
export type LegacyHairStyle =
  | 'bald' | 'buzz' | 'crop' | 'quiff' | 'swept' | 'undercut' | 'slick' | 'spiky'
  | 'side' | 'pixie' | 'curtain' | 'fringe' | 'bowl' | 'curly' | 'afro' | 'topknot'
  | 'bob' | 'midi' | 'layers' | 'shag' | 'wolf' | 'wavy' | 'mullet' | 'halfup'
  | 'long' | 'hime' | 'pony' | 'twin' | 'buns';
export type LikenessHairStyle = 'coilsCrop' | 'coilsTaper' | 'locsShort' | 'locsShoulder' | 'locsLong' | 'boxBraidsLong' | 'boxBraidsBob' | 'cornrows' | 'cornrowBun' | 'twistsShort' | 'twistsShoulder' | 'recedingCrop';
/** sculpted (generated) cuts: any document version; drawn once the part is loaded (`loadGeneratedParts`) */
export type SculptedHairStyle = 'sculptedCurls' | 'sculptedQuiff' | 'sculptedWaves' | 'sculptedBob' | 'sculptedCrop'
  | 'sculptedAfro'
  | 'sculptedHighBun' | 'sculptedTopKnot' | 'sculptedSpaceBuns'
  | 'sculptedPigtails' | 'sculptedSidePart';
export type HairStyle = LegacyHairStyle | LikenessHairStyle | SculptedHairStyle;
export type HairColor =
  | 'ink' | 'espresso' | 'chocolate' | 'chestnut' | 'caramel' | 'honey' | 'blonde' | 'platinum' | 'ginger' | 'ash' | 'silver'
  | 'rose' | 'lilac' | 'mint' | 'sky' | 'plum';
export type HexColor = `#${string}`;
export type EyeColorName = 'ink' | 'brown' | 'blue' | 'green' | 'hazel' | 'grey' | 'violet';
export type EyeColor = EyeColorName | HexColor;
export type EyeShape = 'round' | 'almond' | 'narrow' | 'upturned' | 'downturned' | 'hooded' | 'ringed' | 'lashes' | 'bead';
export type LegacyBrows = 'none' | 'flat' | 'round' | 'thick' | 'block';
export type LikenessBrows = 'softArch' | 'highArch' | 'angled' | 'tapered' | 'bushy' | 'sparse';
export type Brows = LegacyBrows | LikenessBrows;
export type EyeProportions = { width: number; height: number; spacing: number };
export type BrowSpec = { width: number; thickness: number; height: number; color?: AccessoryColor };
export type NoseStyle =
  | 'none' | 'dot' | 'button' | 'round' | 'wedge' | 'long' | 'roman' | 'hook' | 'nostrils' | 'wide' | 'snub' | 'bulb'
  | 'heart' | 'snout' | 'cat' | 'beak';
export type FacialHair =
  | 'none' | 'stache' | 'pencil' | 'walrus' | 'curly' | 'dali' | 'goatee' | 'soul' | 'vandyke' | 'circle'
  | 'chin' | 'mutton' | 'muttonStache' | 'boxed' | 'full' | 'fullStache' | 'long' | 'longStache'
  | 'fullLight' | 'stubble' | 'stubbleStache';
/** optional style picks: absent is `standard` / `auto` (the frame's own lens) */
export type MouthStyle = 'standard' | 'bold';
export type LensMode = 'auto' | 'clear' | 'tint' | 'shade';
export type GlassesStyle = 'none' | 'round' | 'square' | 'sunnies' | 'goggles' | 'monocle' | 'aviator' | 'cateye' | 'heart' | 'star' | 'hippie' | 'visor' | 'patch';
export type HatStyle = 'none' | 'beanie' | 'bow' | 'flower' | 'crown' | 'wizard' | 'bucket' | 'cap' | 'flatCap'
  | 'beret';
export type EarsStyle = 'none' | 'cat' | 'bear' | 'bunny' | 'horns';
export type ExtraStyle = 'none' | 'earrings' | 'hoops' | 'headphones' | 'sticker' | 'plaster' | 'mole' | 'fangs';
export type ColorName = 'blue' | 'red' | 'yellow' | 'green' | 'purple' | 'pink' | 'orange' | 'teal' | 'gold' | 'black' | 'white';
export type AccessoryColor = ColorName | HexColor;

/** a nose with extras: `size` × the default (.4–1.5), `bias` slides it up/down (−.1..+.1), `warm` = skin-toned rather than ink */
/** the listening state: `tempo` in bpm (96), `mouth` closed | hum | sing | lipSync (the host feeds setMouth), `intensity` 0..1 scales the nod and the notes */
export interface Listening { tempo?: number; mouth?: 'closed' | 'hum' | 'sing' | 'lipSync'; intensity?: number;
  /** false hides the floating notes and keeps the nod: an instrument's head sings without decorations */
  notes?: boolean }
/** Another speaker's normalized loudness, optional relative pitch and direction. */
export interface HeardVoice { level: number; pitch?: number | null; look?: { x: number; y: number } | null }

/** what a host playing the head says, this frame (the engine's ginput.js; MinimojiKit's AvatarPerformanceSnapshot) */
export interface PerformanceSnapshot {
  /** Fed every frame, including level 0 through pauses; null releases. */
  heardVoice?: HeardVoice | null;
  /** false when the host is stopped, stale or off screen: gaze, mouth and beat are let go */
  active?: boolean;
  look?: { x: number; y: number } | null;
  /** Each field except pitch is 0..1; pitch is optional semitones off the speaker median. `energy` above 0 makes it SUNG (a bigger jaw; brows, eyes and head join in; the engine's
   *  `createSingingVoice` makes one with a note attack and a trill). Fed every frame so the 0.3 s mouth TTL never closes a held note, null releases at once */
  mouth?: { open: number; width: number; round: number; energy?: number; bliss?: number; pitch?: number | null } | null;
  /** the host's ABSOLUTE musical beat: it replaces the listening nod's clock for the frame */
  beat?: number | null;
  /** bump on a seek, a restart or a pad switch: the nod eases back in */
  generation?: number;
  /** an event sequence: the head blinks once when the number changes */
  blink?: number;
  /** an event sequence: the listening drop (a bigger nod and a burst of notes) fires once when the number changes;
   *  it does nothing unless the head is listening (`listening` stays the host's prop) */
  drop?: number;
  /** how loud the host's real audio is, 0..1: it drives the sound arcs directly (the jaw stays `mouth`'s); null leaves them to the mouth */
  voiceLevel?: number | null;
}
/** what a talking head wears beside its mouth: the jaw alone (the default), or optional sound arcs / speech lines */
export type TalkStyle = 'arcs' | 'lines' | 'mouth';
/** a screen face's CRT strength: 0 off, 1 the default, 2 loud */
export type ScreenCrt = 0 | 1 | 2;
/** what D.A.S.H.'s screen shows for an agent (bake 19): a thinking wave, working code flowing up, or his face in the
 *  state's colour on dark glass ('needs-you' and 'needs_you' are 'needsYou') */
export type AgentState = 'thinking' | 'working' | 'needsYou' | 'needs-you' | 'waiting' | 'done' | 'errored' | 'asleep';
/** sampled once per rendered frame, right before the head's update; `t` is the stage clock in seconds */
export type PerformanceInput = (t: number) => PerformanceSnapshot | null | undefined;

export interface NoseSpec { style: NoseStyle; size?: number; bias?: number; warm?: boolean }
/** an accessory as normalize() returns it: always an object; colours present only when named */
export interface Accessory<S extends string> { style: S; color?: AccessoryColor; color2?: AccessoryColor }

/** anything normalize() / randomAvatar() accept: every field optional, an accessory as a style
 *  string or an object. Unknown values fall back to defaults, and the cross-field rules apply
 *  (a beanie needs supported short hair, ears and a hat fight for the crown). V2 explicitly
 *  enables likeness fields and inclusive appearance rules; omitted v means v1. `hair` is always an object — `hair: 'afro'` is not read. */
interface AvatarInputBase {
  seed?: number;
  head?: HeadShape;
  skin?: Skin;
  nose?: NoseStyle | NoseSpec;
  facialHair?: FacialHair;
  mouth?: MouthStyle;
  glasses?: GlassesStyle | (Accessory<GlassesStyle> & { lens?: LensMode });
  hat?: HatStyle | Accessory<HatStyle>;
  ears?: EarsStyle | Accessory<EarsStyle>;
  extra?: ExtraStyle | Accessory<ExtraStyle>;
  blush?: boolean;
  freckles?: boolean;
}
export interface AvatarV1Input extends AvatarInputBase {
  v?: 1;
  hair?: { style?: LegacyHairStyle | SculptedHairStyle; color?: HairColor };
  eyes?: { color?: EyeColor; shape?: EyeShape };
  brows?: LegacyBrows;
}
export interface AvatarV2Input extends AvatarInputBase {
  v: 2;
  hair?: { style?: HairStyle; color?: HairColor };
  eyes?: { color?: EyeColor; shape?: EyeShape } & Partial<EyeProportions>;
  brows?: Brows;
  brow?: Partial<BrowSpec>;
}
export interface AvatarV3Input extends Omit<AvatarV2Input, 'v'> { v: 3 }
export type AvatarInput = AvatarV1Input | AvatarV2Input | AvatarV3Input;
/** one normalized avatar document — what normalize(), randomAvatar() and decodeAvatar() return.
 *  Every field present, accessories as objects; `nose` is the plain style when it carries no extras.
 *  The same document always rebuilds the same head. See packages/core/avatar.schema.json */
interface AvatarBase {
  seed: number;
  head: HeadShape;
  skin: Skin;
  facialHair: FacialHair;
  /** present only when `bold` */
  mouth?: MouthStyle;
  /** `lens` present only when not `auto` */
  glasses: Accessory<GlassesStyle> & { lens?: LensMode };
  hat: Accessory<HatStyle>;
  ears: Accessory<EarsStyle>;
  extra: Accessory<ExtraStyle>;
  blush: boolean;
  freckles: boolean;
}
export interface AvatarV1 extends AvatarBase {
  v: 1;
  hair: { style: LegacyHairStyle | SculptedHairStyle; color: HairColor };
  eyes: { color: EyeColor; shape: EyeShape };
  brows: LegacyBrows;
  nose: NoseStyle | NoseSpec;
}
export interface AvatarV2 extends AvatarBase {
  v: 2;
  hair: { style: HairStyle; color: HairColor };
  eyes: { color: EyeColor; shape: EyeShape } & EyeProportions;
  brows: Brows;
  brow: BrowSpec;
  nose: Required<NoseSpec>;
}
export interface AvatarV3 extends Omit<AvatarV2, 'v'> { v: 3 }
export type Avatar = AvatarV1 | AvatarV2 | AvatarV3;
export interface Inventory {
  head: readonly HeadShape[]; skin: readonly Skin[];
  hair: { style: readonly HairStyle[]; color: readonly HairColor[] };
  eyeColor: readonly EyeColorName[]; eyeShape: readonly EyeShape[];
  brows: readonly Brows[]; nose: readonly NoseStyle[]; facialHair: readonly FacialHair[];
  glasses: readonly GlassesStyle[]; hat: readonly HatStyle[]; ears: readonly EarsStyle[];
  color: readonly ColorName[]; extra: readonly ExtraStyle[];
  blush: readonly boolean[]; freckles: readonly boolean[];
  mouth: readonly MouthStyle[]; lens: readonly LensMode[];
}

// ---- THE RUNTIME
/** the faces the engine knows; `idle` is `neutral` under the name the runtime starts on */
export type GlossFace =
  | 'idle' | 'neutral' | 'happy' | 'laugh' | 'sad' | 'angry' | 'furious' | 'surprised'
  | 'worried' | 'scared' | 'dead' | 'smug' | 'joy' | 'sleeping' | 'crying' | 'thinking';

/** a head's presence: 'online' (the idle), 'asleep' (offline: eyes and mouth shut, a slow breath, a partway
 *  droop; `z` lies it down with the Zs, which only a full-eye, non-lite build has; `roll` (radians, 0..0.95)
 *  is where the head stops instead, Zs or not, the Zs upright at it — `ASLEEP_GENTLE_ROLL` is the gentle 16°)
 *  or 'party' (a bounce on the beat) */
export type PresenceState = 'online' | 'asleep' | 'party';
/** the gentle asleep roll, 16° in radians: `{ state: 'asleep', z: true, roll: ASLEEP_GENTLE_ROLL }` */
export const ASLEEP_GENTLE_ROLL: number;
export type Presence = PresenceState | { state: PresenceState; z?: boolean; roll?: number; tempo?: number };

export interface HeadOffsets { x: number; y: number; yaw: number; pitch: number; rot: number }
export interface FaceApi {
  head: HeadOffsets;
  /** Screen-only state; organic heads return null. Existing eight-field mood contract. */
  screenMood(): [number, number, number, number, number, number, number, number] | null;
  /** The mood's screen colour, premultiplied linear: [r, g, b, LED weight, glass share, glass cast, darken];
   *  all zero restores the theme. */
  screenPalette(): [number, number, number, number, number, number, number] | null;
  /** Each of the 20 screen strips' strength this frame (the mood effects' or the CRT's, the larger; may pass 1). */
  screenStrips(): number[] | null;
  /** Cue-relative elapsed seconds, dead/scared/furious/thinking weights, enabled flag. */
  screenEffects(): [number, number, number, number, number, number] | null;
  /** Disable temporal screen decorations immediately; face and palette stay unchanged. */
  setScreenEffectsEnabled(enabled: boolean): void;
  /** gaze in −1..1 (clamped); null releases it */
  lookAt(x: number | null, y?: number): void;
  /** an unknown id is ignored */
  setFace(id: GlossFace): void;
  /** talk for `seconds` (default 2); 0 / false stops */
  talk(seconds?: number | false): void;
  talking(): boolean;
  /** listen to music: composes with any face (a sad head nods sadly) and sets nothing on it; null / false stops */
  listen(st: Listening | null | false): void;
  listening(): Listening | null;
  /** the drop: a bigger nod and a burst of notes, without leaving the listening state */
  drop(): void;
  /** the host's absolute beat for the coming frame; null free-runs on the tempo. A changed `generation` eases the nod back in */
  setBeat(beat: number | null, generation?: number): void;
  /** Natural talk is on for fed speech. False clears phrase/pitch state. */
  setNatural(on: boolean): void;
  natural(): boolean;
  setNaturalMotionEnabled(on: boolean): void;
  /** the emote on a face change, read by the next `setFace` (a flip alone does nothing). Off: the face still
   *  changes, a cue already playing plays on, `perform` is unaffected. Seeded by the `emotes` option */
  setEmotesEnabled(on: boolean): void;
  emotesEnabled(): boolean;
  /** the typing state: the thinking face plus a looping tilt and glance, mouth shut; any speech takes the mouth at once */
  think(on: boolean): void;
  thinking(): boolean;
  /** leaving 'asleep' for anything (thinking, talking, online, party) plays the built-in wake-up */
  setPresence(p: Presence | null): void;
  presence(): { state: PresenceState; z?: boolean; roll?: number; tempo?: number };
  /** 1 as authored, up to 2: exaggerates the thinking face's subtle channels for a small head */
  setEmphasis(k: number): void;
  /** blink now; one already under way absorbs it */
  blink(): void;
  /** Listen to another speaker; expires after .3 s without a feed. */
  hear(voice: HeardVoice | null): void;
  /** Optional pitch is semitones off the speaker median, not a 0…1 value. */
  setMouth(p: { open: number; width: number; round: number; energy?: number; bliss?: number; pitch?: number | null } | null): void;
  setViseme(v: string | null): void;
  /** a screen face's (D.A.S.H.'s) CRT look: 0 off, 1 the default, 2 loud; anything else is 1, a head of skin ignores it */
  setScreenCrt(level: ScreenCrt): void;
  /** the CRT strength, null on a head of skin */
  screenCrt(): ScreenCrt | null;
  /** light a screen face's glass in `hex` over every mood: `glass` ≈.3 keeps it dark, 2.2 floods it (default 1).
   *  null hands it back to the mood (or the agent state's own colour); it wins over an agent state's colour */
  setScreenColor(hex: string | null, opts?: { glass?: number }): void;
  screenColor(): { hex: string; glass: number } | null;
  /** what the head shows for an agent; null for none. D.A.S.H.'s screen shows it; any other head shows it with its
   *  own face and a held sticker (`agentStickers`). `color`/`glass` override the state's colour. Unknown ids are ignored */
  setAgentState(state: AgentState | null, opts?: { color?: string; glass?: number }): void;
  agentState(): Exclude<AgentState, 'needs-you'> | null;
  /** a head without a screen in an agent state: this frame's stickers (skull diameters from the skull's centre, y up;
   *  `rot` in degrees) and their colour; null with no state, and always on a screen head */
  agentStickers(): { color: string; stickers: Array<{ kind: 'thought' | 'keyboard' | 'codeflow' | 'check' | 'cross' | 'clock' | 'bang' | 'sparkle'; x: number; y: number; size: number; rot: number; alpha: number; t: number; back?: boolean; typing?: boolean; key?: number }> } | null;
  /** an unknown style is ignored */
  setTalkStyle(style: TalkStyle): void;
  talkStyle(): TalkStyle;
  /** a host's real loudness, 0..1, kept fresh every frame (a 0.3 s TTL); null releases */
  setVoiceLevel(level: number | null): void;
  /** a small head (below 48 pt): thicker rings, two at most */
  setCompact(on: boolean): void;
  update(t: number, dt: number): HeadOffsets;
  face(): GlossFace;
  /** one message drives the runtime: `talking: true` talks until told to stop */
  applyState(st: { expression?: GlossFace; talking?: number | boolean; look?: { x?: number; y?: number } | null; listening?: Listening | boolean | null; thinking?: boolean; presence?: Presence; event?: 'drop'; talkStyle?: TalkStyle; voiceLevel?: number | null }): void;
}
/** the engine's build: what the react package places, scales and disposes. `head` is the group
 *  the face rides on; onFrame runs after the offsets are applied, so adding to its rotation there
 *  composes with them. `bounds` is the whole character; `L.H`/`L.cy` the head's height and centre */
export interface Built {
  group: Group;
  head: Group;
  bounds: { w: number; h: number; cy: number; minY: number; maxY: number };
  L: { H: number; cy: number; [k: string]: unknown };
  stats: { buildMs: number; verts: number; meshes: number };
}
export interface Head { fit?: 'face' | 'bounds'; built: Built; holder: Group; life: FaceApi; rate: number; phase: number }
/** the stage's material cache: `(finish, colour, shell?, print?)`; materials are shared, never dispose one */
export type MaterialFactory = (finish: string, color: string, shell?: boolean, print?: { key: string } | null) => Material;

export interface MinimojiStageProps {
  /** overlay (default): transparent, fixed over the page, heads anchored to DOM rects. wall: the opaque cream wall for a viewer.
   *  Fixed for the life of the stage — change the `key` to switch. */
  mode?: 'overlay' | 'wall';
  /** gloss detail 0.2–1 (one value per page: the last stage to mount wins) */
  detail?: number;
  /** overlay only, on by default: the heads ride in the page's flow — the fixed canvas becomes an
   *  off-screen buffer and each anchor gets a 2D canvas of its own, inside the tile, that the frame is
   *  copied into. The browser then scrolls the heads with the page, on the compositor, instead of the
   *  stage chasing it a frame behind (the slip you see on a phone). `false` paints straight over the page.
   *  Mark an ancestor `data-minimoji-surface` to have the heads under it share one canvas — do that for a
   *  group shot, and wherever the anchor itself clips its overflow. */
  surfaces?: boolean;
  /** where the comic stickers' PNGs are loaded from (a URL ending in `/`): https://www.minimoji.com/emote-bursts/
   *  by default. For a strict CSP, serve your own copy of the package's `emote-bursts/` folder
   *  (`node_modules/@minimoji/react/emote-bursts/`) and point this at it, e.g. `"/emote-bursts/"` */
  burstBase?: string;
  /** RECORD FRAME BY FRAME (video export): a stepped clock from `createManualClock({ seed })`. The stage then runs no
   *  loop of its own and reads no wall clock or pointer: nothing advances and nothing draws until `clock.step(dt)`, each
   *  step is one frame advanced by exactly `dt`, heads open on themselves (no landing), and the same seed and the same
   *  calls draw the same frames. `await clock.ready` before the first step: it waits for the heads to build, their
   *  sculpted parts and the stickers. Yield between steps (await your frame capture): a line's face and cues reach
   *  the head as props, committed between tasks. Fixed for the life of the stage; off by default */
  clock?: ManualClock | null;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}
export function MinimojiStage(props: MinimojiStageProps): ReactNode;

/** A STEPPED CLOCK for recording a head frame by frame (`createManualClock`). Give the same one to the stage and to
 *  `useLine({ clock })` (a vanilla stage: `mountHeadPerformance(el, { clock })`), then `await clock.ready` and call
 *  `step(1 / 30)` once per video frame: each step moves every clock the heads have by exactly that much and draws one
 *  frame, however long you take between steps. A line on it plays no sound: mux the audio yourself, from the line's start */
export interface ManualClock {
  readonly manual: true;
  readonly seed: number;
  /** seconds: the sum of every step */
  now(): number;
  readonly time: number;
  readonly steps: number;
  /** move every clock by `dt` seconds (finite, ≥ 0) and draw one frame on every stage on this clock; answers the time */
  step(dt: number): number;
  /** resolves once nothing the next frame depends on is still loading; rejects when a held load failed (an Error
   *  naming each, `failed` lists them), reported once */
  readonly ready: Promise<void>;
  /** a seeded random source of its own for `salt` */
  random(salt?: string): () => number;
  /** run `fn` on every step; answers the unsubscribe */
  onStep(fn: (dt: number, time: number) => void): () => void;
  /** have `ready` wait for a load of yours too (and reject, naming `what`, if it fails); answers the promise as given */
  hold<T>(promise: Promise<T>, what?: string): Promise<T>;
}
/** a stepped clock. `seed` deals the dice of every head on it (default 1): when it blinks, where the eyes glance, which
 *  emote of a mood plays, a poke's reaction. Two recordings match only with the same seed: derive it from a stable id
 *  for the content (a deck's id, a slide's id plus a speaker), never from `location`, a URL or a served path (a server
 *  that serves each run under a fresh prefix gives every run other blinks) */
export function createManualClock(options?: { seed?: number }): ManualClock;

/** a poke's answer: a face held a moment and a short move on the head (no sound: play your own from `onPoke`) */
export type Reaction = 'oof' | 'ah' | 'flinch' | 'giggle' | 'dizzy';
/** the reactions there are, and the pool a poke picks from when none is named (all five) */
export const REACTION_NAMES: readonly Reaction[];
export const DEFAULT_REACTIONS: readonly Reaction[];
/** poke and drag a head. Off by default; `true` turns both on */
export interface Interactive {
  /** a tap on the head plays a reaction, never the same one twice in a row; `reactions` replaces the pool (unknown names warn once and are skipped) */
  poke?: boolean | { reactions?: Reaction[] };
  /** the head follows a drag on a rubber band (approaching `maxPx`, 80 css px), tilts toward the pull, and springs back with a wobble; a fling plays `dizzy` */
  drag?: boolean | { maxPx?: number };
  /** the head's accessible name: it becomes a button (Enter or Space pokes it). Default "Poke the avatar" */
  label?: string;
}
/** what `ref` on a <MinimojiHead> holds */
export interface MinimojiHeadHandle {
  /** play a reaction now, cutting in over one already playing: a name, or with none one from the pool. Answers what played, or null (no head yet, or an unknown name, which warns) */
  react(name?: Reaction): Reaction | null;
  /** the head, once built */
  head: Head | null;
}

export interface MinimojiHeadProps {
  /** A curated engine character, rendered instead of the human avatar. */
  character?: CharacterSelection | null;
  avatar: AvatarInput;
  /** overlay: the element whose rect the head is placed in — REQUIRED there (without it the head is built but not placed);
   *  ignored on a wall. The head marks it `data-minimoji="loading"` until it is built and begins its scale-in, then `"ready"` —
   *  style that for a loading state, and set `data-minimoji="loading"` in your own markup to have it from first paint */
  anchor?: RefObject<HTMLElement | null>;
  expression?: GlossFace;
  /** 'mouse' follows the page pointer from wherever the head sits (and idles while there is no pointer — off the window, or a touch screen); 'near' follows it only within `reach` px of the head and idles otherwise; {x,y} in −1..1; null looks at the camera;
   *  'idle' has nothing to look at — the head glances about on its own, and its drift gestures turn it (with any look set, they yield);
   *  'manual' leaves gaze to you (call head.life.lookAt from onFrame) */
  look?: 'mouse' | 'near' | 'idle' | 'manual' | { x: number; y: number } | null;
  /** 'near' only: how close the pointer must be, in css px (default ≈ the anchor's size) */
  reach?: number;
  /** seconds to talk (< 60). `true`, or a larger changing number such as `Date.now()`,
   *  talks the default 2 s and re-triggers on every change; `false` / 0 stops */
  talking?: number | boolean;
  /** what the head wears beside its mouth while talking: `'mouth'` (the default, the jaw alone), or optional `'arcs'` / `'lines'` */
  talkStyle?: TalkStyle;
  /** a screen face's (D.A.S.H.'s) CRT look, its scanlines and glass following the mood: 0 off, 1 (the default), 2 loud.
   *  A head of skin ignores it */
  crt?: ScreenCrt;
  /** what the head shows for an agent: on D.A.S.H. his screen (bake 19): 'thinking' (a wave of three neon dots), 'working'
   *  (code flowing up), or his face for 'needsYou' | 'waiting' | 'done' | 'errored' | 'asleep' in the state's colour. Any
   *  other head shows it with its own face and one held sticker in the state's colour (or `screenColor`); 'working' types
   *  on a small keyboard. null (the default) leaves the head exactly as it was */
  agentState?: AgentState | null;
  /** a screen face's glass colour over every mood and agent state, `#rrggbb` (e.g. your app's own state colour); null leaves it */
  screenColor?: string | null;
  /** how much of the glass `screenColor` takes: ≈.3 keeps it dark (only the face lights), 2.2 floods it; default 1 */
  screenGlass?: number;
  /** how loud the voice is right now, 0..1 (null: none): drives the sound arcs directly, not the jaw, and is kept
   *  fresh every frame. A call's level meter goes here; while a live `performance` source names its own level, that one wins */
  voiceLevel?: number | null;
  /** listening to music: a state that composes with `expression` — a nod on the beat of `tempo`, notes rising; null / false stops */
  listening?: Listening | null | false;
  /** a host that PLAYS the head (an instrument): called every frame before the update. While set it owns
   *  gaze, mouth, beat and blinks, and `look` is ignored; `expression` and `listening` stay yours. Keep its
   *  identity stable (a ref or a module function) and read your own clock inside it */
  performance?: PerformanceInput | null;
  /** Play one authored gesture, or choose a gesture for a mood. Bump generation to replay it. */
  cue?: ({ gesture: string; mood?: never; generation?: number | string } | { mood: GlossFace; gesture?: never; generation?: number | string }) | null;
  onGestureEnd?: (id: string, result: { cancelled: boolean }) => void;
  /** let a pointer poke the head and drag it (see `Interactive`); a poke works idle, paused or mid-line, and lip-sync carries on under it.
   *  Only the head's skull counts: a press anywhere else in the anchor goes to the page. Under reduced motion the faces still change, nothing moves */
  interactive?: boolean | Interactive | null;
  /** a poke played a reaction */
  onPoke?: (event: { reaction: Reaction }) => void;
  onDragStart?: () => void;
  /** `distance`: how far the pointer went, css px; `flung`: released fast enough to play `dizzy` */
  onDragEnd?: (event: { distance: number; flung: boolean }) => void;
  /** `react(name?)` from code (React 19 passes `ref` as a prop) */
  ref?: React.Ref<MinimojiHeadHandle>;
  drift?: boolean;
  /** false stills every one-shot, the emote on an expression change and a `cue` alike (reduced motion) */
  performances?: boolean;
  /** Planning gaze and pitch expression during fed speech; default true. */
  naturalTalk?: boolean;
  /** false: an expression change plays no emote, and a `cue` still plays (a host that cues its own gestures,
   *  e.g. over a beat, or a face set for bookkeeping: a mood lapsing, a mute, a reset). Default true. Live, never
   *  a rebuild: read on the next `expression` change, so pass it with the expression it is for (`false` with a
   *  lapse, `true` with a pick); a flip alone does nothing. Stickers are `bursts`'s, not this */
  emotes?: boolean;
  /** the comic stickers (!, sweat, flames, hearts) that pop around the head when `expression` CHANGES to a mood
   *  that has them (`BURST_MOODS` from `@minimoji/react/bursts`), as MinimojiKit's `bursts`. Never the first face,
   *  never the same face again; any strength pops (a line's quiet 0.3 cue too); a face with none (neutral) lets
   *  them fade, as the end of a line does. Reduced motion shows none. Default true; false: none */
  bursts?: boolean;
  /** false: face only. No stickers (it overrides `bursts`) and none of the rig's effect plates (tears, sparkles,
   *  steam, sleep Zs, notes, a screen face's effects); expressions, blush, lip sync (its sound arcs and lines too)
   *  and motion are untouched.
   *  Default true, as the vanilla stage's `decorations` (`/sdk/minimoji-heads.js`) */
  decorations?: boolean;
  shadow?: boolean;
  scale?: number;
  onFrame?: (head: Head, t: number, offsets: HeadOffsets) => void;
  onReady?: (head: Head) => void;
  /** the build threw (also logged): the head on stage, if any, is the one before */
  onError?: (error: unknown) => void;
}
/** a head on the stage. Heads build one per animation frame, in mount order, and scale in with a soft bounce as they land */
export function MinimojiHead(props: MinimojiHeadProps): ReactNode;

export interface MinimojiShadowProps {
  /** overlay only: the element whose rect catches the heads' shadows — one surface for several heads (give them `shadow={false}`). Required there; a no-op on a wall */
  anchor?: RefObject<HTMLElement | null>;
  /** shadow darkness (default .22, the same as a head's own) */
  opacity?: number;
}
export function MinimojiShadow(props: MinimojiShadowProps): ReactNode;

export interface MinimojiHeadPosterProps {
  /** the head's still: a saved avatar's `${service}/avatars/<avatarKey>.png?size=256` (the service draws 256 px on save),
   *  or your own transparent picture of the head */
  src: string;
  /** the puff that breathes out behind the head as the still gives way: the package's own by default; false for none */
  puff?: string | false;
  className?: string;
  /** the still fills its anchor (`object-fit: contain`); re-place it with `{ inset: 'auto', left, top, width, height }` */
  style?: CSSProperties;
}
/** a head's own loader, placed inside the anchor of a `<MinimojiHead>`: the head's still comes in soft, sharpens and breathes,
 *  then gives way with a puff when the anchor turns `data-minimoji="ready"`. `"error"` keeps the sharp still; reduced motion is
 *  the soft still, no puff. A local silhouette draws before the image arrives (tinted with `style.color`), then fades to the still. A failed image keeps the sharp silhouette. A React 19 `<style>`, hoisted once: mark the anchor `data-minimoji="loading"` in your markup
 *  and it runs from the first paint, server-rendered or not */
export function MinimojiHeadPoster(props: MinimojiHeadPosterProps): ReactNode;
/** a person's yes to your app: the Minimoji avatar it shows. Store both against your user */
/** a private character the person picked for your app at minimoji.com/me, worn in place of their Mini avatar */
export interface MinimojiGrantCharacter { id: string; name: string; kind: string | null; revision: number; bakeVersion: number; speech: string | null; sha256: string; bytes: number | null }
/** `character`: when the person wears one of their private characters in your app, load it with
 *  `loadMinimojiGrantHead` and show it; `avatarKey` stays their Mini avatar (shown when it is null) */
export interface MinimojiConnected { grantId: string; avatarKey: string; character?: MinimojiGrantCharacter | null }
export interface MinimojiConnectOptions {
  /** your app's publishable key (`mk_pub_…`): the key is the app the person says yes to */
  key: string;
  /** the service: the deployment's `.convex.site` origin (`NEXT_PUBLIC_MINIMOJI_SERVICE_URL`) */
  service: string;
  /** let avatars made inside your app be added to the person's library (default true; the sheet says so) */
  addToLibrary?: boolean;
}
/** "Use my Minimoji": start a connect, open minimoji.com in a popup, poll until the person answers. `connect()` resolves
 *  `{ grantId, avatarKey }` on a yes, null on not now, expiry or `cancel()`. Call it from a click; a blocked popup is an `error` */
export function useMinimojiConnect(options: MinimojiConnectOptions): { connect: () => Promise<MinimojiConnected | null>; connecting: boolean; cancel: () => void; error: Error | null };
export interface MinimojiConnectButtonProps {
  /** your app's publishable key; `minimojiKey` because React keeps `key` */
  minimojiKey: string;
  service: string;
  addToLibrary?: boolean;
  onConnected?: (connected: MinimojiConnected) => void;
  /** the label (default "Use my Minimoji") */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}
export function MinimojiConnectButton(props: MinimojiConnectButtonProps): ReactNode;
/** the flow without React; `open`/`go`/`sleep`/`fetchImpl` are seams for tests or a tab instead of a popup */
export function connectMinimoji(options: MinimojiConnectOptions & {
  fetchImpl?: typeof fetch; signal?: AbortSignal; open?: () => { close?: () => void; location?: { href: string } } | null;
  go?: (popup: unknown, url: string) => void; sleep?: (ms: number) => Promise<void>; now?: () => number;
}): Promise<MinimojiConnected | null>;
/** the grant's avatar today (it follows edits and re-picks at minimoji.com/me), or null once the person disconnected your app */
/** the line a person set on the avatar in the Minimoji app, and the face and
 *  gesture word it was read as once, on the service (null when unsure).
 *  `setAt` is epoch milliseconds */
export interface MinimojiStatus { text: string; mood: string | null; gesture: string | null; setAt: number | null }
export interface MinimojiGrant extends MinimojiConnected { status: MinimojiStatus | null }
/** the grant's avatar and status today, or null once the person disconnected the app */
export function refreshMinimojiGrant(options: { service: string; key: string; grantId: string; fetchImpl?: typeof fetch }): Promise<MinimojiGrant | null>;
/** the worn character's GLB bytes for `prepareBakedHead(bytes, { sha256 })`, fetched with your key from the grant;
 *  `'unchanged'` when `etag` (the sha256 you have) is still current; null once no character is worn (show `avatarKey`).
 *  Rejects with `status: 410` once the grant is revoked */
export function loadMinimojiGrantHead(options: { service: string; key: string; grantId: string; etag?: string; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<ArrayBuffer | 'unchanged' | null>;
export interface MinimojiStatusBubbleProps {
  /** the status line; nothing is drawn without one */
  text?: string | null;
  /** the text's px; Bunch draws 11, 14 and 22. Default 14 */
  size?: number;
  /** false drops the tail and the tilt. Default true */
  tail?: boolean;
  className?: string;
  style?: CSSProperties;
}
/** a status in Bunch's bubble; the tail's tip is its bottom-left corner */
export function MinimojiStatusBubble(props: MinimojiStatusBubbleProps): ReactNode;
export const STATUS_BUBBLE: Readonly<Record<string, number | string>>;
export function statusBubblePath(width: number, height: number, options?: { size?: number; tail?: boolean }): string;
export function statusBubbleTip(width: number, height: number, options?: { size?: number; tail?: boolean }): { x: number; y: number } | null;
/** the bubble without React, inside `host` */
export function mountStatusBubble(host: HTMLElement, options?: { text?: string; size?: number; tail?: boolean }): { update(next: { text?: string; size?: number; tail?: boolean }): void; destroy(): void };
/** an avatar your app saved (POST /avatars with your secret key) added to the person's library and picked for your app */
export function addToMinimojiLibrary(options: { service: string; key: string; grantId: string; avatarKey: string; fetchImpl?: typeof fetch }): Promise<MinimojiConnected>;
/** the poster's stylesheet, for an app that renders without React 19's style hoisting */
export const POSTER_CSS: string;
/** the package's puff picture, as a URL */
export const POSTER_PUFF: string;

/** the head for `avatar`, or null until the first is built. On a change the old head is returned until the
 *  new one lands, then disposed a moment later (the whirl's length; see MinimojiHead). A changed `emotes`
 *  never rebuilds it: it is applied live and read by the next `setFace` you make */
export function useMinimoji(avatar: AvatarInput, materialFor: MaterialFactory | null, opts?: { character?: CharacterSelection | null; gaze?: boolean; drift?: boolean; performances?: boolean; emotes?: boolean; naturalTalk?: boolean }): Head | null;
/** only reachable from inside a mounted stage, after its renderer is up — so nothing here is null */
export interface StageContextValue {
  mode: 'overlay' | 'wall';
  gl: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  materialFor: MaterialFactory;
  size: { w: number; h: number };
  pointer: { x: number; y: number; on: boolean };
  /** read the page here, not from a scroll listener: `fn` runs once per rendered frame, just before the
   *  frame it feeds. Returns the way to stop watching. */
  watch(fn: () => void): () => void;
}
export function useStage(): StageContextValue;

/** the normalized JSON of an avatar: field order and defaults do not matter */
export function avatarKey(avatar: AvatarInput): string;
export function buildHead(avatar: AvatarInput, materialFor: MaterialFactory, opts?: { character?: CharacterSelection | null; gaze?: boolean; drift?: boolean; performances?: boolean; emotes?: boolean; naturalTalk?: boolean }): Head;
export function disposeHead(head: Head): void;
export function fitScale(built: Built, w: number, h: number, fit?: 'face' | 'bounds'): number;

/** Data-only, self-contained Mini bake; account authorization belongs to its host. */
export interface BakedHeadSource {
  format?: 'minimoji-head-glb';
  /** http(s):// or a root-relative /path; relative, blob: and data: URLs are refused (pass bytes instead) */
  url: string;
  sha256?: string;
  version?: number;
  bakeVersion?: number;
}
export interface PreparedBakedHead {
  readonly format: 'minimoji-head-glb';
  readonly version: number;
  readonly sha256: string;
  readonly byteLength: number;
  readonly bounds: Readonly<Built['bounds']>;
  readonly faceNames: readonly string[];
  /** A packed character's colour slots: slot → the parts wearing it in this file (an empty list: that slot is not on
   *  this variant). null on a head with no slot map (another bake, or a pack from before it): its colours are fixed. */
  readonly slots: Readonly<Record<string, readonly string[]>> | null;
  /** New geometry, materials and animation metadata; no state is shared with another instance. */
  createBuilt(): Built;
  /** Frees the template only; existing instances remain usable. Idempotent. */
  dispose(): void;
}
export const BAKED_HEAD_FORMAT: 'minimoji-head-glb';
export const BAKED_HEAD_MAX_BYTES: number;
/** The oldest bake version a baked head may carry; files from this version up to the current bake load. */
export const BAKED_HEAD_MIN_VERSION: number;
export function prepareBakedHead(source: string | BakedHeadSource | ArrayBuffer | ArrayBufferView, options?: {
  sha256?: string; version?: number; bakeVersion?: number; maxBytes?: number;
  fetch?: typeof globalThis.fetch; signal?: AbortSignal;
}): Promise<PreparedBakedHead>;
export const loadBakedHead: typeof prepareBakedHead;
export function buildBakedHead(prepared: PreparedBakedHead, opts?: {
  gaze?: boolean; drift?: boolean; performances?: boolean; emotes?: boolean; naturalTalk?: boolean;
  environment?: Texture; random?: () => number;
  /** a packed character's colours by slot, `{ trim: '#7a3cff' }` (see `prepared.slots`); throws on an unknown slot */
  colors?: Readonly<Record<string, string>>;
}): Head;
/** Recolour a head from `buildBakedHead` by colour slot, live (no reload). Throws on a head with no slot map, an
 *  unknown slot or a colour that is not #rrggbb; a slot with no parts on this variant changes nothing. */
export function setBakedHeadColors(head: Head, colors: Readonly<Record<string, string>>): void;

export function randomAvatar(rng?: () => number, overrides?: AvatarInput): Avatar;
export function normalize(a: AvatarInput): Avatar;
/** base64url of the document as given — normalize first if you want the canonical form */
export function encodeAvatar(a: AvatarInput): string;
/** decodes (either base64 alphabet) and normalizes */
export function decodeAvatar(s: string): Avatar;
export const INVENTORY: Inventory;
/** Omitted version is v1; unknown versions throw rather than silently downgrade. */
export function documentVersion(avatar: { v?: unknown }): 1 | 2 | 3;
export const DOCUMENT_VERSIONS: readonly [1, 2, 3];
export const V1_HAIR_STYLES: readonly LegacyHairStyle[];
export const V2_HAIR_STYLES: readonly LikenessHairStyle[];
export const V1_BROWS: readonly LegacyBrows[];
export const V2_BROWS: readonly LikenessBrows[];
export interface LegacyAvatarLoss { path: string; from: unknown; to: unknown; reason: string }
/** Explicit lossy approximation only; reports appearance fields that cannot survive v1. */
export function exportLegacyAvatar(avatar: AvatarInput): { doc: AvatarV1; losses: LegacyAvatarLoss[] };
/** the version every editor writes today */
export const CURRENT_DOCUMENT_VERSION: 3;
/** a part the current version draws a little differently than v1 did */
export interface AvatarUpgradeChange { path: 'freckles' | 'facialHair'; reason: string }
/** Raise a v1/v2 document to v3 without changing the head it draws: rule
 *  fallbacks the old version applied, and a v1 bald/beanie brow's ink, are
 *  written in; the rest stays as sparse as it came. `effects` names the rules
 *  written in; `changes` lists v1 freckles/facial hair, which v2 redrew. A v3
 *  document, or an unknown version, comes back as given (the same object). */
export function upgradeAvatar<T extends AvatarInput>(avatar: T): { doc: T | AvatarV3Input; effects: readonly { id: string; reason: string }[]; changes: readonly AvatarUpgradeChange[] };

// ---- THE FIELDS — every path a form can edit (see packages/core/src/fields.js)
export type AccessoryKey = 'glasses' | 'hat' | 'ears' | 'extra';
/** the closed set of editable paths, in document order */
export type AvatarPath =
  | 'seed' | 'head' | 'skin' | 'hair.style' | 'hair.color' | 'eyes.color' | 'eyes.shape' | 'brows'
  | 'eyes.width' | 'eyes.height' | 'eyes.spacing' | 'brow.width' | 'brow.thickness' | 'brow.height' | 'brow.color'
  | 'nose.style' | 'nose.size' | 'nose.bias' | 'nose.warm' | 'facialHair' | 'mouth'
  | `${AccessoryKey}.${'style' | 'color' | 'color2'}` | 'glasses.lens' | 'blush' | 'freckles';
interface FieldBase {
  path: AvatarPath;
  /** may be absent from a normalized avatar (an accessory colour, a nose extra) */
  optional?: boolean;
  minVersion?: 2;
}
/** what a field takes: a list (enum / colour — names or '#rrggbb' / bool), a bounded number, or the seed */
export type AvatarField =
  | (FieldBase & { kind: 'enum' | 'color'; options: readonly string[]; /** what an absent optional style choice reads as */ default?: string })
  | (FieldBase & { kind: 'bool'; options: readonly boolean[] })
  | (FieldBase & { kind: 'number'; min: number; max: number; default?: number })
  | (FieldBase & { kind: 'int' });
export type FieldKind = AvatarField['kind'];
export interface FieldOption { value: string | boolean; allowed: boolean; reason?: string | null }
/** in document order */
export const AVATAR_FIELDS: readonly AvatarField[];
/** the field at a path; undefined for one a form does not edit (`v`) */
export function fieldAt(path: AvatarPath): AvatarField;
export function fieldAt(path: string): AvatarField | undefined;
/** `nose.style` reads through a plain-string nose. Throws on a path that is not a field */
export function getField(avatar: Avatar, path: AvatarPath): unknown;
/** the document with `value` at `path` (undefined removes an optional key), normalized — so it may not
 *  carry the value written, and may differ elsewhere (the cross-field rules). Throws on a path that is not a field */
export function setField(avatar: Avatar, path: AvatarPath, value: unknown): Avatar;
/** every value the field may take, `allowed` false where normalize would refuse it on this head; [] for a number */
export function optionsFor(avatar: Avatar, path: string): FieldOption[];
/** Safe picker transaction. Rejected headwear conflicts return the original document. */
export function planAvatarEdit(avatar: Avatar, path: AvatarPath, value: unknown): { doc: Avatar; accepted: boolean; reason: string | null; effects: readonly { id: string; reason: string }[] };
export function editOptionsFor(avatar: Avatar, path: string): FieldOption[];
/** case-insensitive; prefix matches first; a whole '#rrggbb' on a colour field becomes an option */
export function searchOptions(options: FieldOption[], query: string, field?: AvatarField): FieldOption[];
/** a hex for a colour chip beside a skin / hair / eye / accessory colour, or undefined */
export function swatchHex(path: AvatarPath, value: unknown): string | undefined;
export const GLOSS_FACES: readonly GlossFace[];

/** one frame of a recorded line's mouth: what a `performance` source hands back as `mouth`, plus the loudness that drove it */
export interface MouthFrame { open: number; width: number; round: number; level: number }
/** A RECORDED LINE'S MOUTH (the engine's mouthTrack): the whole clip's mono PCM (−1…1, e.g. an AudioBuffer's
 *  getChannelData(0)) → one mouth per `fps` frame (60), lips meeting on m/b/p and shapes leading the sound by
 *  `lead` s (0.07). Frame k is the mouth at k / fps seconds into the clip. The homepage's lines are made with it */
export function mouthTrack(pcm: Float32Array, sampleRate: number, opts?: { fps?: number; articulate?: boolean; lead?: number }): MouthFrame[];

/** one part of an editor: the pictured field, the colour slots it owns, its toggles (@minimoji/core editorCategories.js) */
export interface EditorCategory {
  id: string; group: string; label: string; /** the SF Symbol the native rail draws */ symbol: string;
  style?: AvatarPath; colors?: readonly (readonly [AvatarPath, string])[]; toggles?: readonly (readonly [AvatarPath, string])[]; controls?: readonly (readonly [AvatarPath, string])[];
  /** a row of words under the tiles (the glasses' lens), hidden while `style` is one of `choicesUnless` */
  choices?: readonly (readonly [AvatarPath, string])[]; choicesUnless?: readonly string[];
}
export const EDITOR_GROUPS: readonly { id: string; label: string; symbol: string }[];
export const EDITOR_CATEGORIES: readonly EditorCategory[];
export const THUMB_FIELDS: readonly AvatarPath[];
/** what a person reads on an editor tile, by option value (@minimoji/core option-labels.js; the Kit's editor reads the same table) */
export const OPTION_LABELS: Readonly<Record<string, string>>;
/** the words on a tile for one option value: `fullLight` → "Light + stache", `coilsCrop` → "Coils Crop" */
export function optionLabel(value: unknown): string;

// ---- SAYING A LINE (src/line.js, src/MinimojiCaptions.js; the format: docs/speech-line-format.md) ----
export type { SpeechLine, LineCue, LineLetter, ProviderAlignment, AuthoredCue, CueAt, LookTarget, CueStage } from './engine/line';
/** directing a head: a cue track with no line (a game's NPC, a party host), on its own clock; `cueStage(head.life)` plays it on a head
 *  (give that <MinimojiHead> `look="manual"`) */
export { playCues, cueStage, TAG_CUES, LOOK_HOLD } from './engine/line';
/** a line's captions sized for a speech bubble, one at a time (a presenter deck): sentence-sized, split near 64
 *  characters at punctuation, never a lone word. <MinimojiCaptions> keeps its 4-word phrases for a caption strip */
export { capsFromLine, captionAt, wordTime, BUBBLE_CAPTION_CHARS } from './engine/line';
export type { BubbleCaption } from './engine/line';
/** the share of the viewport's shorter side that turns the eyes all the way in `lookTargetFor` */
export const LOOK_SPAN: number;
/** a look cue's `{ x, y }` (-1..1, + right / up) for an element on the page, from the head's anchor (a look at a card is code, not a tag) */
export function lookTargetFor(el: Element | { left: number; top: number; width: number; height: number }, anchorEl: Element | { left: number; top: number; width: number; height: number }, opts?: { span?: number }): { x: number; y: number };
/** a TTS provider's character alignment (ElevenLabs': one object or an array of chunks) → a clip's `letters`: the lips land on the letters */
export { lettersFromAlignment, lettersFromWords, wordsFromAlignment, wordsFromMs, wordsFromAzure, wordsFromPolly, wordsFromCartesia } from './engine/line';
export type { SpeechClip, ClipCache, ClipTranscriber, TextClip, ClipSynthesizer } from './engine/clip';
/** why a line ended: played to its end, cut (stop, or a newer say), or a clip that could not load, decode or build */
export type LineEndReason = 'ended' | 'stopped' | 'failed';
/** a line's audio: an element of your own (an HTMLAudioElement), a URL the player makes one for, or none (the silent clock) */
export type LineAudioInput = LineAudio | string | null;
export interface LineState {
  /** the line said last (kept after it ends, for the captions' last words), or null */
  line: SpeechLine | null;
  /** the line now playing's generation; null when none plays */
  generation: number | null;
  playing: boolean;
  /** true while a plain clip is fetched, decoded and built (the head stays as it is; `playing` follows) */
  preparing: boolean;
  /** why the last clip failed (its say ended 'failed'), until the next say; null otherwise */
  error: Error | null;
  /** true while the silent clock runs it: play() was refused (autoplay blocked), the audio stalled, or there is none */
  silent: boolean;
  /** seconds on the line's clock, as of the last word spoken (not every frame) */
  time: number;
  /** how many of the line's words have been spoken */
  spoken: number;
  /** the face the line's mood cues name, for `<MinimojiHead expression>`; null when no line holds one (yours applies) */
  expression: GlossFace | null;
  /** the emote or gesture to play, for `<MinimojiHead cue>` */
  cue: { mood: GlossFace; generation: number } | { gesture: string; generation: number } | null;
  /** the point a look cue holds the eyes on (it rides in `performance` too), or null */
  look: { x: number; y: number } | null;
}
export interface LinePlayerApi extends LineState {
  /** start a line, cutting any before it (the newest say wins). Call it in the click: play() runs inside the gesture.
   *  Returns the line's generation */
  say(line: SpeechLine, opts?: { audio?: LineAudioInput }): number | null;
  /** SAY PLAIN AUDIO: the clip is fetched, decoded and built into a line here (cached), then played. A clip not yet
   *  prepared starts when it is built; a failure never throws: it ends 'failed' with the error. Returns its generation */
  say(clip: SpeechClip): number | null;
  /** SAY A LINE FROM TEXT: `{ text, voice, mood? }` is spoken by Minimoji's POST /lines/say (useLine's `synthesize`, or the
   *  clip's own), then its audio plays with the letters the voice was timed on. Returns its generation */
  say(clip: TextClip): number | null;
  /** fetch, decode and build a clip (or speak a text clip) ahead of time, so a later say starts at once (rejects on a failure) */
  prepare(clip: SpeechClip | TextClip): Promise<SpeechLine>;
  stop(): void;
  /** the head's PerformanceInput: stable; reads the line's clock once per rendered frame */
  performance: PerformanceInput;
}
/** a line player: wire `performance`, `cue` and `expression` to a <MinimojiHead>, and pass it to <MinimojiCaptions player>.
 *  `onCue` hears every cue (a brow accent has no head prop); `onEnd` hears each line end, with the error when it failed */
export function useLine(opts?: {
  onCue?: (cue: LineCue, quiet: boolean) => void;
  onEnd?: (generation: number, reason: LineEndReason, error?: Error) => void;
  /** TALK FROM A RECORDING: your publishable key and the service origin. A clip with no words or transcript (or one saying
   *  `transcribe: true`) is sent to Minimoji's POST /lines first and plays with captions and word cues. The audio goes to
   *  Minimoji and ElevenLabs for transcription and is not stored */
  transcribe?: ClipTranscriber | null;
  /** SAY A LINE FROM TEXT: your publishable key and the service origin (plus `elevenLabsKey` to speak on your own
   *  ElevenLabs account). A clip `{ text, voice }` is spoken by Minimoji's POST /lines/say and plays its answer */
  synthesize?: ClipSynthesizer | null;
  /** the stage's stepped clock (`<MinimojiStage clock>`): the line runs on its time and plays no sound; a clip still
   *  building is held on it (`clock.ready`). Read at the first render */
  clock?: ManualClock | null;
}): LinePlayerApi;
/** the hook's logic without React */
export function createLineSession(opts?: {
  onState?: (state: LineState) => void;
  createAudio?: (url: string) => LineAudio;
  onCue?: (cue: LineCue, quiet: boolean) => void;
  onEnd?: (generation: number, reason: LineEndReason, error?: Error) => void;
  now?: () => number;
  /** the clip cache (`createClipCache()` from `@minimoji/react/clip`) */
  clips?: ClipCache;
  /** the AudioContext an AudioBuffer clip plays through */
  audioContext?: () => AudioContext;
  /** where a clip with no words is transcribed (useLine's `transcribe`), or a function read at each say */
  transcribe?: ClipTranscriber | null | (() => ClipTranscriber | null);
  /** where a text clip is spoken (useLine's `synthesize`), or a function read at each say */
  synthesize?: ClipSynthesizer | null | (() => ClipSynthesizer | null);
  /** a stepped clock (createManualClock): the line on its time, no sound */
  clock?: ManualClock | null;
}): { say: LinePlayerApi['say']; prepare: LinePlayerApi['prepare']; stop(): void; tick(): unknown; performance: PerformanceInput; readonly state: LineState; dispose(): void };

export interface TextMouthApi {
  /** more of the reply, as it streams in. After the mouth has closed, or after `cancel`, this starts a new reply */
  append(text: string): void;
  /** that is all of it: the mouth uses the text up, then closes */
  finish(): void;
  /** close now */
  cancel(): void;
  /** the head's PerformanceInput: stable. Pass `speaking ? performance : null` to keep the head's `look` when it is quiet */
  performance: PerformanceInput;
  /** how much of what you sent has been mouthed, now: `text.slice(0, spoken())` */
  spoken(): number;
  /** from the first text until the mouth has closed (the hook re-renders when this changes) */
  speaking: boolean;
}
/** MOUTH A STREAMING REPLY WITH NO AUDIO: `append` the text as it arrives and hand `performance` to a <MinimojiHead>.
 *  Paced like speech (about 15 characters a second, never more than `lag` behind the text), shaped by the letter
 *  rules. `onSpoken` hears `spoken` each time it moves, for a caption that keeps up with the mouth */
export function useTextMouth(opts?: {
  onSpoken?: (spoken: number) => void;
  /** seconds (default 1.5): the most the mouth may trail the newest text before it skips forward to a word's start.
   *  Smaller follows the text closer and drops more letters. A change takes hold at the next reply; a bad value throws */
  lag?: number;
  /** where the eyes go while it speaks, in -1..1 (+ x to the head's right, + y up). The head does not read its own
   *  `look` prop while a performance is set, so this keeps the host's gaze; null (default): the head's own */
  look?: { x: number; y: number } | null;
  /** the stage's stepped clock (`<MinimojiStage clock>`): the reply is paced on its steps. Read at the first render */
  clock?: ManualClock | null;
}): TextMouthApi;
/** the pacer itself, on your own frame step: `append`, `finish`, `cancel`, `sample(dt)` (a mouth `{ open, width, round, level }`, or null once closed).
 *  `lag` (seconds, default 1.5) is the most it may trail the newest text; a non-finite or non-positive one throws a RangeError */
export function createTextMouth(opts?: { lag?: number }): {
  append(text: string): void;
  finish(): void;
  cancel(): void;
  sample(dt: number): { open: number; width: number; round: number; level: number } | null;
  readonly spoken: number;
  readonly speaking: boolean;
};
/** the hook's logic without React */
export function createTextMouthSession(opts?: {
  onState?: (state: { speaking: boolean }) => void;
  onSpoken?: (spoken: number) => void;
  lag?: number;
  look?: { x: number; y: number } | null;
  now?: () => number;
  /** a stepped clock (createManualClock): paced on its steps */
  clock?: ManualClock | null;
}): { append(text: string): void; finish(): void; cancel(): void; setLag(lag: number | undefined): void; setLook(look: { x: number; y: number } | null): void; tick(): void; performance: PerformanceInput; spoken(): number; readonly speaking: boolean };

/** why a live mic failed: `denied` (the person or the site said no), `no-device`, `busy` (another app has it),
 *  `unsupported` (no mic API: an http:// page, an old browser), `blocked` (the browser kept audio off: start() was not
 *  called from a gesture), `ended` (unplugged mid-talk), `failed` (anything else) */
export type LiveMicErrorCode = 'unsupported' | 'denied' | 'no-device' | 'busy' | 'blocked' | 'ended' | 'failed';
export interface LiveMicError extends Error { code: LiveMicErrorCode }
export type LiveMicState = 'idle' | 'starting' | 'live';
export interface LiveMicOptions {
  /** a mic from `navigator.mediaDevices.enumerateDevices()`; null (default): the system's */
  deviceId?: string | null;
  /** seconds the host delays its own playout of this voice for the mouth's sake (0: the speaker hears themselves) */
  lookAhead?: number;
  onState?: (state: LiveMicState) => void;
  onError?: (error: LiveMicError) => void;
}
export interface LiveMicSession {
  /** open the mic (call it from a click or a key press). Resolves true once live, false when `stop()` came first;
   *  rejects with a LiveMicError */
  start(): Promise<boolean>;
  /** close the mic and let the mouth go */
  stop(): void;
  /** the head's PerformanceInput: the mouth while you talk, inactive in the silences */
  performance: PerformanceInput;
  /** how loud the voice is now, 0..1 (0 when off): a meter */
  level(): number;
  /** 'error' hears every failure, the start's included. Answers the unsubscribe */
  on(kind: 'state', fn: (state: LiveMicState) => void): () => void;
  on(kind: 'error', fn: (error: LiveMicError) => void): () => void;
  /** another mic for the next start */
  setDevice(deviceId: string | null): void;
  readonly state: LiveMicState;
  readonly live: boolean;
  /** which sample path reads the mic: an AudioWorklet, or the ScriptProcessorNode fallback (null when off) */
  readonly path: 'worklet' | 'script-processor' | null;
}
/** TALK WITH YOUR VOICE: the mic (echo cancelling, noise suppression, auto gain) on a head's mouth, analysed in the page
 *  by the same live viseme analyser as MinimojiKit. Nothing is played, stored or sent.
 *  `<MinimojiHead performance={mic.live ? mic.performance : null} />`; `start()` from a user gesture */
export function useLiveMic(opts?: { deviceId?: string | null; onError?: (error: LiveMicError) => void }): {
  /** true once live; false when it failed (see `error`) or `stop()` came first. Never rejects */
  start(): Promise<boolean>;
  stop(): void;
  on: LiveMicSession['on'];
  level(): number;
  performance: PerformanceInput;
  state: LiveMicState;
  live: boolean;
  /** the last failure (cleared by the next start) */
  error: LiveMicError | null;
};
/** the hook's logic without React */
export function createLiveMicSession(opts?: LiveMicOptions): LiveMicSession;
/** a session, started: `const mic = await liveMic()` from a click */
export function liveMic(opts?: LiveMicOptions): Promise<LiveMicSession>;
/** the audio constraints every start asks for */
export const LIVE_MIC_CONSTRAINTS: Readonly<{ echoCancellation: true; noiseSuppression: true; autoGainControl: true }>;

export interface MinimojiCaptionsProps {
  /** a useLine() player: its line, time and playing state */
  player?: Pick<LineState, 'line' | 'time' | 'playing'> | null;
  /** or a line and a time of your own */
  line?: SpeechLine | null;
  time?: number;
  playing?: boolean;
  /** overrides prefers-reduced-motion: true shows the whole line at once, still */
  reduceMotion?: boolean;
  /** clear the words when no line plays (default true), after holding the last phrase CAPTION_HOLD s */
  hideWhenIdle?: boolean;
  /** 'phrases' (default): the phrase being said, its word lit, moving up; 'window': Kit 9.44's sliding window */
  mode?: 'phrases' | 'window';
  /** under reduced motion, the whole line in at most this many lines (then an ellipsis) */
  maxLines?: number | null;
  className?: string;
  style?: CSSProperties;
}
/** a line's words as it is said: a phrase of up to four words with its word lit (or 9.44's window); the whole line
 *  under reduced motion; a screen reader hears the whole line once per line */
export function MinimojiCaptions(props: MinimojiCaptionsProps): ReactNode;
export function captionView(opts: { line: SpeechLine | null; time?: number; playing?: boolean; reduceMotion?: boolean; style?: 'phrases' | 'window' }): { words: { text: string; opacity: number; lit?: boolean }[]; phrase: number | null; announce: string };
/** what the captions draw from: the given line, or the last one seen playing where it stood while it is held */
export function captionSource(memo: { line: SpeechLine | null; n: number; seen: { line: SpeechLine; time: number; n: number } | null },
  opts: { line: SpeechLine | null; time: number; playing: boolean; mode?: 'phrases' | 'window'; expiredFor?: number | null }):
  { line: SpeechLine | null; time: number; n: number; holding: boolean };
/** the words' box: clamped to `maxLines` under reduced motion */
export function captionWordsStyle(opts?: { reduceMotion?: boolean; maxLines?: number | null }): CSSProperties | undefined;
export const CAPTION_HOLD: number;
export const CAPTIONS_CSS: string;
