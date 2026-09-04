/**
 * The agency's display name, per language.
 *
 * It was computed inline — identically — in the header and the footer, which
 * is how the two drifted apart: the footer had a third branch for `fr` that
 * returned the same string as its fallback. One function, one answer.
 */
import { agencyConfig } from '@/config/agency';

export interface AgencyNames {
  /** The agency's own name, configured or falling back to a localised default. */
  readonly name: string;
  /** The line under it — a descriptor in Arabic, the short brand elsewhere. */
  readonly sub: string;
}

export function agencyNames(lang: string): AgencyNames {
  const arabic = lang === 'ar';
  const fallback = arabic ? 'وكالة بوسالم' : lang === 'fr' ? 'Agence BouSalem' : 'BouSalem Agency';
  return {
    name: agencyConfig.name || fallback,
    sub: arabic ? 'لخدمات الحج والعمرة' : 'BouSalem',
  };
}
