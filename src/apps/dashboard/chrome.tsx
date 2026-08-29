/**
 * Dashboard — page rail, command bar and status bar.
 *
 * Stateless chrome: each piece takes what it shows and reports what was pressed.
 *
 * The command bar carries the range control only on the pages the range actually
 * moves. Position and performance come from the trial balance, which the broker
 * aggregates over the whole book with no date dimension at all, so a range selector
 * sitting above them would be a control that silently does nothing — the worst kind.
 * On those pages the same slot says "book to date" instead, which is what the numbers
 * under it are.
 *
 * The rail's badges count work rather than rows: what is waiting on a person, what
 * does not add up, what is left on the checklist. A badge that counted accounts would
 * be a number nobody ever needs to act on.
 */
import {
  ClipboardCopy,
  Clock,
  Database,
  FileDown,
  History,
  Layout,
  ListChecks,
  RefreshCw,
  Scale,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Badge,
  Button,
  fmt,
  NavGroupLabel,
  NavItem,
  Segmented,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  useApp,
} from '@/platform/sdk';
import type { Currency } from '../shared/ledger';
import type { DashboardBusy } from './actions';
import {
  PAGE_LABEL,
  type PageId,
  PAGES,
  RANGE_LABEL,
  RANGED_PAGES,
  RANGES,
  type RangeId,
  type Snapshot,
} from './metrics';

/** The five pages, each with the glyph its jump-list entry and rail row share. */
const PAGE_ICON = {
  overview: Layout,
  position: Scale,
  performance: TrendingUp,
  activity: History,
  close: ListChecks,
} as const;

/* ------------------------------------------------------------------ *
 * Command bar
 * ------------------------------------------------------------------ */

export interface DashboardToolbarProps {
  readonly page: PageId;
  readonly range: RangeId;
  readonly onRange: (next: RangeId) => void;
  readonly onCommand: (id: string) => void;
  readonly busy: DashboardBusy;
  readonly loading: boolean;
  /** The current window as a person reads it — a period name, or two dates. */
  readonly windowText: string;
}

export function DashboardToolbar({
  page,
  range,
  onRange,
  onCommand,
  busy,
  loading,
  windowText,
}: DashboardToolbarProps) {
  const { t, tr } = useApp().locale;
  const ranged = RANGED_PAGES.includes(page);
  return (
    <>
      <Button
        size="sm"
        icon={RefreshCw}
        busy={loading}
        onClick={() => onCommand('refresh')}
        title={tr('إعادة القراءة (F5)', 'Relire les données (F5)', 'Read the book again (F5)')}
      >
        {tr('تحديث', 'Actualiser', 'Refresh')}
      </Button>
      <ToolbarSeparator />
      {ranged ? (
        <>
          <Segmented
            size="sm"
            value={range}
            onChange={onRange}
            options={RANGES.map((id) => ({ value: id, label: t(RANGE_LABEL[id]) }))}
          />
          <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>{windowText}</span>
        </>
      ) : (
        <Badge
          tone="neutral"
          icon={Database}
          title={tr(
            'يجمع الوسيط سطور القيود المعتمدة على الدفتر كله، دون بعد زمني — فلا يمكن تحديد نطاق لهذه الصفحة.',
            'Le courtier agrège les lignes comptabilisées sur tout le livre, sans dimension de date : cette page ne peut pas être bornée.',
            'The broker aggregates posted lines over the whole book, with no date dimension — this page cannot be windowed.',
          )}
        >
          {tr('حتى تاريخه', 'À ce jour', 'Book to date')}
        </Badge>
      )}
      <ToolbarSpacer />
      <Button
        size="sm"
        icon={ClipboardCopy}
        onClick={() => onCommand('copy')}
        title={tr('نسخ الملخص (Ctrl+Shift+C)', 'Copier le résumé (Ctrl+Maj+C)', 'Copy the summary (Ctrl+Shift+C)')}
      >
        {tr('نسخ الملخص', 'Copier le résumé', 'Copy summary')}
      </Button>
      <Button
        size="sm"
        icon={FileDown}
        busy={busy === 'export'}
        onClick={() => onCommand('export')}
        title={tr('تصدير هذه الصفحة (Ctrl+E)', 'Exporter cette page (Ctrl+E)', 'Export this page (Ctrl+E)')}
      >
        {tr('تصدير CSV', 'Exporter CSV', 'Export CSV')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Page rail
 * ------------------------------------------------------------------ */

export interface PageRailProps {
  readonly page: PageId;
  readonly onPage: (next: PageId) => void;
  readonly snap: Snapshot;
  readonly windowText: string;
}

/**
 * The five pages, and one paragraph saying what the range does.
 *
 * The note is not decoration. A person who changes the range on the overview and then
 * clicks through to position would otherwise be entitled to believe the balance sheet
 * moved with it, and it did not — so the rail says which pages the window scopes,
 * in the same place the window is named.
 */
export function PageRail({ page, onPage, snap, windowText }: PageRailProps) {
  const { t, tr } = useApp().locale;
  const remaining = snap.close.total - snap.close.certified;
  const badge: Readonly<Record<PageId, number | null>> = {
    overview: snap.attention.length === 0 ? null : snap.attention.length,
    position: snap.position.accounts > 0 && !snap.position.balanced ? 1 : null,
    performance: null,
    activity: snap.activity.waiting.length === 0 ? null : snap.activity.waiting.length,
    close: remaining <= 0 ? null : remaining,
  };
  return (
    <>
      <NavGroupLabel>{tr('الصفحات', 'Pages', 'Pages')}</NavGroupLabel>
      {PAGES.map((id) => (
        <NavItem
          key={id}
          icon={PAGE_ICON[id]}
          label={t(PAGE_LABEL[id])}
          selected={page === id}
          badge={badge[id]}
          onClick={() => onPage(id)}
        />
      ))}
      <NavGroupLabel>{tr('النطاق', 'Portée', 'Scope')}</NavGroupLabel>
      <div
        style={{
          display: 'grid',
          gap: 6,
          padding: '2px 12px 12px',
          fontSize: 'var(--fx-caption)',
          color: 'var(--fx-text-secondary)',
          lineHeight: 1.5,
        }}
      >
        <span className="fx-mono" style={{ color: 'var(--fx-text-primary)' }}>
          {windowText}
        </span>
        <span>
          {tr(
            'النطاق يحدّد «نظرة عامة» و«الحركة».',
            'La portée s’applique à « Vue d’ensemble » et « Activité ».',
            'The range scopes Overview and Activity.',
          )}
        </span>
        <span>
          {tr(
            '«المركز» و«الأداء» حتى تاريخه دائمًا.',
            '« Situation » et « Performance » sont toujours à ce jour.',
            'Position and Performance are always book to date.',
          )}
        </span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */

export interface DashboardStatusProps {
  readonly snap: Snapshot;
  readonly currency: Currency;
  /** One of the reads came back at its ceiling, so a total may be short. */
  readonly truncated: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

/**
 * What the numbers rest on.
 *
 * The drift item is the one that matters: when the two columns of the trial balance
 * disagree, every figure above it is suspect, and a dashboard that drew a tidy donut
 * over that would be actively misleading. It is stated in money, because "unbalanced"
 * without an amount tells nobody whether it is a rounding artefact or a missing line.
 */
export function DashboardStatus({ snap, currency, truncated, error, fetchedAt }: DashboardStatusProps) {
  const { tr, lang } = useApp().locale;
  const unbalanced = snap.position.accounts > 0 && !snap.position.balanced;
  return (
    <>
      <StatusItem icon={Database} title={tr('حسابات في الميزان', 'Comptes dans la balance', 'Accounts in the balance')}>
        {tr(
          `${fmt.integer(snap.position.accounts, lang)} حساب`,
          `${fmt.integer(snap.position.accounts, lang)} comptes`,
          `${fmt.integer(snap.position.accounts, lang)} accounts`,
        )}
      </StatusItem>
      <StatusItem
        tone={unbalanced ? 'danger' : 'success'}
        icon={unbalanced ? ShieldAlert : undefined}
        title={tr(
          'الأصول ناقص (الخصوم + رأس المال + النتيجة).',
          'Actif moins (passif + capitaux propres + résultat).',
          'Assets less (liabilities + equity + result).',
        )}
      >
        {unbalanced
          ? tr(
              `فرق ${fmt.money(snap.position.drift, currency, lang)}`,
              `Écart ${fmt.money(snap.position.drift, currency, lang)}`,
              `Off by ${fmt.money(snap.position.drift, currency, lang)}`,
            )
          : tr('الميزان متوازن', 'Balance équilibrée', 'Balanced')}
      </StatusItem>
      <StatusItem icon={History} title={tr('قيود في النطاق', 'Écritures dans la portée', 'Entries in range')}>
        {tr(
          `${fmt.integer(snap.activity.total, lang)} قيد`,
          `${fmt.integer(snap.activity.total, lang)} écritures`,
          `${fmt.integer(snap.activity.total, lang)} entries`,
        )}
      </StatusItem>
      {snap.close.total === 0 ? null : (
        <StatusItem
          icon={ListChecks}
          tone={snap.close.certified === snap.close.total ? 'success' : undefined}
          title={tr('خطوات الإقفال المصدّقة', 'Étapes de clôture certifiées', 'Certified close steps')}
        >
          {`${fmt.integer(snap.close.certified, lang)} / ${fmt.integer(snap.close.total, lang)}`}
        </StatusItem>
      )}
      {truncated ? (
        <StatusItem
          tone="warning"
          title={tr(
            'الوسيط يحمّل صفحة واحدة لكل مصدر؛ قد يكون مجموع ما فوق ناقصًا.',
            'Le courtier charge une page par source ; un total ci-dessus peut être incomplet.',
            'The broker loads one page per source, so a total above may be short.',
          )}
        >
          {tr('صفحة مقتطعة', 'Page tronquée', 'Page truncated')}
        </StatusItem>
      ) : null}
      {error === null ? null : <StatusItem tone="danger">{error}</StatusItem>}
      <ToolbarSpacer />
      {snap.cash.accounts === 0 ? null : (
        <StatusItem
          icon={Wallet}
          title={tr(
            'النقد بعملة الدفتر فقط؛ باقي العملات على صفحة المركز.',
            'Trésorerie en devise du livre uniquement ; les autres devises sont sur la page Situation.',
            'Cash in the book currency only; the other currencies are on the Position page.',
          )}
        >
          {fmt.money(snap.cash.total, currency, lang)}
        </StatusItem>
      )}
      {fetchedAt === null ? null : (
        <StatusItem icon={Clock} title={fmt.dateTime(fetchedAt, lang)}>
          {fmt.time(fetchedAt, lang)}
        </StatusItem>
      )}
    </>
  );
}
