export interface CharacterSelection { id: string; seed?: number; pick?: Record<string, string> }
export interface CharacterInfo { id: string; name: string; family: string; color: string }
export const CHARACTERS: readonly CharacterInfo[];
/** the animal families a photo can show; the photo rung offers one species per family */
export const ANIMAL_FAMILIES: readonly string[];
/** the species ids a photo can offer, one per animal family, each a plain English noun */
export const PHOTO_SUBJECTS: readonly string[];
export const ALIEN_KIT: Record<string, readonly string[]>;
export const DASH_KIT: Record<string, readonly string[]>;
export function characterInfo(id: string): CharacterInfo | null;
export function normalizeCharacter(value: unknown): CharacterSelection | null;
export function characterKit(id: string): 'alien' | 'dash' | null;
