import type { Lang, Translation } from './types';
import { ar } from './ar';
import { fr } from './fr';
import { en } from './en';

// Re-exported, not re-declared. These two used to be a second, independent copy
// of the union and the array, which meant every language change had to be made
// twice and the two could silently drift apart -- removing Darija had to touch
// both. `./types` is the one declaration now.
export type { Translation, Lang } from './types';
export { languages } from './types';

export const translations: Record<Lang, Translation> = { ar, fr, en };
