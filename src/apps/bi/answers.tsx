/**
 * The two dialogs that answer instead of asking.
 *
 * Both are opened by a verb that has already run or is running: a drill-through that
 * went to the server for the rows behind a mark, and a request whose compiled statement
 * came back with the result. Neither collects anything, so neither has a form, a patch
 * setter, or a commit — which is why they live apart from `./dialogs.tsx`, whose whole
 * subject is refusing a save that cannot succeed.
 *
 * They are also the two whose primary button is conditional on the *answer* rather than
 * on what was typed: "Open in …" appears only for the four drill kinds that have
 * somewhere to land, and "Copy" only ever has one thing to copy.
 */
import type { CSSProperties, ReactElement } from 'react';
import { Copy } from 'lucide-react';

import {
  Button,
  Dialog,
  InfoBar,
  PropertyRow,
  Spinner,
  useLocale,
} from '@/platform/sdk';

import { int } from './format';
import { DRILL_LABEL } from './labels';
import { DRILL_JUMP } from './shell';
import type { BiDialog, BiShell } from './shell';

const GRID: CSSProperties = { display: 'grid', gap: 12 };
const CAPTION: CSSProperties = { color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' };

/** A scrollable block for text nobody types — a compiled statement, a list of ids.
 *  `pre-wrap` because SQL arrives with its own line breaks and re-flowing it would lose
 *  the shape the compiler gave it. */
const BLOCK: CSSProperties = {
  margin: 0,
  maxHeight: 320,
  overflow: 'auto',
  padding: 10,
  borderRadius: 6,
  background: 'var(--fx-card-secondary)',
  border: '1px solid var(--fx-divider)',
  fontFamily: 'var(--fx-font-mono)',
  fontSize: 'var(--fx-caption)',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

interface Arm<K extends BiDialog['kind']> {
  readonly shell: BiShell;
  readonly dialog: Extract<BiDialog, { kind: K }>;
}

/**
 * Which rows a mark stood for.
 *
 * Opened before the answer arrives, so the reader sees the question they clicked while
 * it is still travelling — which is why `result` and `error` are both nullable and why
 * the waiting state is a spinner rather than an "empty" illustration.
 *
 * The primary button is an "Open in …" only for the four drill kinds that have somewhere
 * to land. The other seven get the id list and a copy button, which is the honest offer:
 * nothing in this OS yet opens a booking or a pilgrim by id, and a button that quietly
 * did nothing would be worse than no button at all.
 */
export function BiDrillDialog({ shell, dialog }: Arm<'drill'>): ReactElement {
  const { t, tr, lang } = useLocale();
  const result = dialog.result;
  const jump = result === null || result.kind === null ? undefined : DRILL_JUMP[result.kind];
  const ids = result?.entityIds ?? [];

  return (
    <Dialog
      open
      width={520}
      title={dialog.label}
      onClose={shell.closeDialog}
      secondaryLabel={tr('إغلاق', 'Fermer', 'Close')}
      primary={jump === undefined || result === null || ids.length === 0 ? undefined : {
        label: tr('فتح', 'Ouvrir', 'Open'),
        onClick: () => shell.openDrillTarget(result),
      }}
    >
      <div style={GRID}>
        {dialog.error !== null ? <InfoBar tone="danger">{dialog.error}</InfoBar> : null}
        {dialog.error === null && result === null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...CAPTION }}>
            <Spinner size={14} />
            {tr('جارٍ القراءة…', 'Lecture…', 'Reading…')}
          </div>
        ) : null}
        {result !== null ? (
          <>
            <PropertyRow label={tr('البُعد', 'Dimension', 'Dimension')} mono>
              {dialog.dimensionKey}
            </PropertyRow>
            <PropertyRow label={tr('الوجهة', 'Cible', 'Target')}>
              {result.kind === null
                ? tr('غير مرتبط', 'Non reliée', 'Not linked')
                : t(DRILL_LABEL[result.kind])}
            </PropertyRow>
            <PropertyRow label={tr('الصفوف', 'Lignes', 'Rows')}>
              {int(result.entityCount, lang)}
            </PropertyRow>
            {result.truncated ? (
              <InfoBar tone="warning">
                {tr(
                  'القائمة أقصر من العدد: عُرضت المعرّفات الأولى فقط.',
                  'La liste est plus courte que le compte : seuls les premiers identifiants sont montrés.',
                  'The list is shorter than the count: only the first ids are shown.',
                )}
              </InfoBar>
            ) : null}
            {ids.length > 0 ? (
              <>
                <pre style={BLOCK}>{ids.join('\n')}</pre>
                <div>
                  <Button
                    icon={Copy}
                    variant="subtle"
                    size="sm"
                    onClick={() => shell.copyText(ids.join('\n'))}
                  >
                    {tr('نسخ المعرّفات', 'Copier les identifiants', 'Copy ids')}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** The statement a request compiled to, as the server wrote it. Read-only and never
 *  re-indented: what is shown is what ran. */
export function BiSqlDialog({ shell, dialog }: Arm<'sql'>): ReactElement {
  const { tr } = useLocale();

  return (
    <Dialog
      open
      width={720}
      title={dialog.title}
      onClose={shell.closeDialog}
      secondaryLabel={tr('إغلاق', 'Fermer', 'Close')}
      primary={{
        label: tr('نسخ', 'Copier', 'Copy'),
        onClick: () => shell.copyText(dialog.sql),
      }}
    >
      <pre style={BLOCK}>{dialog.sql}</pre>
    </Dialog>
  );
}
