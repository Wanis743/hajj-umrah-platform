/**
 * The two states a 360 pane is in when it has nothing to describe.
 *
 * They are here, in one file both `detail.tsx` and `lineage.tsx` import, for a sharper
 * reason than tidiness. These are the two states this app is most tempted to conflate —
 * *the read has not come back* and *there is nothing to read* — and having exactly one
 * rendering of each is what keeps a loading inspector from ever drawing as an empty one.
 * An analyst who reads "this dataset has no metrics" off a pane that is still fetching
 * closes it and builds on something else.
 *
 * Both files needed them and neither could own them without importing from the other,
 * which is a cycle. The style objects they share live next door in `styles.ts`, a `.ts`
 * module because an exported object literal is what `allowConstantExport` does not cover.
 */
import { EmptyState, Spinner, useLocale } from '@/platform/sdk';
import type { LucideIcon } from 'lucide-react';

import type { BiShell } from './shell';
import { CAPTION, PANE } from './styles';

/** What a pane needs and all it needs: the shell it reads and commands through. */
export interface Desk {
  readonly shell: BiShell;
}

/** A read that has been asked for and has not answered. Never an empty state. */
export function Waiting() {
  const { tr } = useLocale();
  return (
    <div style={{ ...PANE, placeItems: 'center', paddingTop: 40, color: 'var(--fx-text-tertiary)' }}>
      <Spinner size={20} />
      <span style={CAPTION}>{tr('جارٍ القراءة…', 'Lecture…', 'Reading…')}</span>
    </div>
  );
}

export interface NothingProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly hint: string;
}

/** A pane with nothing in it because nothing is selected, which is not a failure. */
export function Nothing({ icon, title, hint }: NothingProps) {
  return <EmptyState icon={icon} title={title} description={hint} compact />;
}
