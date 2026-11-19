export * from './character-catalog';
export function characterRecipe(value: import('./character-catalog').CharacterSelection): { kit: Record<string, string>; species: string; [key: string]: any };
export function characterFromQuery(query: string | URLSearchParams): import('./character-catalog').CharacterSelection | null;
export function characterQuery(value: import('./character-catalog').CharacterSelection): string;
