/**
 * Relevance ranking for the Start menu and Search.
 *
 * Kept out of both components because they must agree: typing "jou" into Start
 * and into Search should put the Journal app first in the same way. Pure
 * functions over manifests — no kernel, no React, so the rule about components
 * not exporting helpers does not bite either.
 */
import type { AppCommandDef, Localized } from '../kernel/abi';
import type { InstalledApp } from '../kernel/contracts';
import type { AppLocale } from '../sdk';

/** Exact match beats prefix beats substring; keywords rank below names. */
const NAME_EXACT = 100;
const NAME_PREFIX = 80;
const NAME_PART = 60;
const KEYWORD_PREFIX = 45;
const KEYWORD_PART = 30;
const DESCRIPTION_PART = 15;

const forms = (text: Localized, locale: AppLocale): readonly string[] => [
  text.en,
  text.fr,
  text.ar,
  locale.t(text),
];

/** Score for a localised label. `needle` must already be lower-cased. */
export function scoreLabel(label: Localized, needle: string, locale: AppLocale): number {
  let best = 0;
  for (const form of forms(label, locale)) {
    const lower = form.toLowerCase();
    if (lower === needle) return NAME_EXACT;
    if (lower.startsWith(needle)) best = Math.max(best, NAME_PREFIX);
    else if (lower.includes(needle)) best = Math.max(best, NAME_PART);
  }
  return best;
}

/** Higher is better; 0 means "no match at all". */
export function scoreApp(app: InstalledApp, needle: string, locale: AppLocale): number {
  const { manifest } = app;
  const byName = scoreLabel(manifest.name, needle, locale);
  if (byName > 0) return byName;
  for (const keyword of manifest.keywords ?? []) {
    const lower = keyword.toLowerCase();
    if (lower.startsWith(needle)) return KEYWORD_PREFIX;
    if (lower.includes(needle)) return KEYWORD_PART;
  }
  if (locale.t(manifest.description).toLowerCase().includes(needle)) return DESCRIPTION_PART;
  return 0;
}

export interface RankedApp {
  readonly app: InstalledApp;
  readonly rank: number;
}

/** Matching apps, best first, ties broken by how often they are launched. */
export function rankApps(
  apps: readonly InstalledApp[],
  needle: string,
  locale: AppLocale,
  limit: number,
): readonly RankedApp[] {
  return apps
    .map((app) => ({ app, rank: scoreApp(app, needle, locale) }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank || b.app.launches - a.app.launches)
    .slice(0, limit);
}

export interface RankedCommand {
  readonly app: InstalledApp;
  readonly command: AppCommandDef;
  readonly rank: number;
}

/** Commands published by manifests — the palette half of Search. */
export function rankCommands(
  apps: readonly InstalledApp[],
  needle: string,
  locale: AppLocale,
  limit: number,
): readonly RankedCommand[] {
  const found: RankedCommand[] = [];
  for (const app of apps) {
    for (const command of app.manifest.commands ?? []) {
      const rank = scoreLabel(command.title, needle, locale);
      if (rank > 0) found.push({ app, command, rank });
    }
  }
  return found.sort((a, b) => b.rank - a.rank).slice(0, limit);
}
