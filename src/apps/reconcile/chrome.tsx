/**
 * Reconciliation — command bar, rail, status bar and the row menu.
 *
 * Stateless chrome: each piece takes what it shows and reports what was pressed.
 *
 * The rail carries three groups because the exercise has three questions in order —
 * which bank, which statement, and which side of it am I looking at. Collapsing them
 * into one list would be tidier and would make "the March statement of the BNA
 * account, unmatched lines only" a thing you navigate to by guessing.
 *
 * The status bar's centre of gravity is the difference. Every other number here is
 * context for it: a reconciliation is finished when that number is zero, and a
 * window that makes somebody hunt for it has buried the only thing they came for.
 */
import {
  Ban,
  BadgeCheck,
  BookOpen,
  CalendarRange,
  Check,
  CheckCheck,
  CircleSlash,
  ClipboardCopy,
  FileDown,
  Landmark,
  ListChecks,
  Lock,
  RefreshCw,
  RefreshCw as Rotate,
  Scale,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import type { Ref } from 'react';
import {
  Badge,
  Button,
  fmt,
  type MenuEntry,
  MenuFlyout,
  NavGroupLabel,
  NavItem,
  SearchBox,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  useApp,
} from '@/platform/sdk';
import {
  type BankAccount,
  type BankStatement,
  type BankTransaction,
  type Currency,
  MATCH_STATE_LABEL,
  STATEMENT_STATUS_LABEL,
  statementTone,
} from '../shared/ledger';
import type { ReconcileBusy } from './actions';
import { isAgreed, isEligible, type LedgerRow, type Reconciliation } from './match';
import type { ReconcileView } from './model';

/* ------------------------------------------------------------------ *
 * Command bar
 * ------------------------------------------------------------------ */

export interface ReconcileToolbarProps {
  readonly view: ReconcileView;
  readonly search: string;
  readonly onSearch: (next: string) => void;
  /** Held by the shell so Ctrl+F can put the caret here. */
  readonly searchRef: Ref<HTMLInputElement>;
  readonly onCommand: (id: string) => void;
  readonly busy: ReconcileBusy;
  readonly loading: boolean;
  readonly canMatch: boolean;
  readonly canUnmatch: boolean;
  readonly canExport: boolean;
  /** Pairings the sweep would make right now. */
  readonly planCount: number;
}

export function ReconcileToolbar({
  view,
  search,
  onSearch,
  searchRef,
  onCommand,
  busy,
  loading,
  canMatch,
  canUnmatch,
  canExport,
  planCount,
}: ReconcileToolbarProps) {
  const { tr, lang } = useApp().locale;
  const count = fmt.integer(planCount, lang);
  return (
    <>
      {view === 'matched' ? (
        <Button
          size="sm"
          icon={Ban}
          busy={busy === 'unmatch'}
          disabled={!canUnmatch}
          onClick={() => onCommand('unmatch')}
          title={tr(
            'إلغاء المطابقة وإرجاع سطر الدفتر (Ctrl+Backspace)',
            'Annuler le rapprochement et libérer la ligne (Ctrl+Retour arrière)',
            'Reverse the match and release the ledger line (Ctrl+Backspace)',
          )}
        >
          {tr('إلغاء المطابقة', 'Annuler', 'Unmatch')}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="accent"
          icon={Check}
          busy={busy === 'match'}
          disabled={!canMatch}
          onClick={() => onCommand('match')}
          title={tr(
            'مطابقة السطر مع أفضل مرشّح (Ctrl+Enter)',
            'Rapprocher la ligne avec le meilleur candidat (Ctrl+Entrée)',
            'Match the line with its best candidate (Ctrl+Enter)',
          )}
        >
          {tr('مطابقة', 'Rapprocher', 'Match')}
        </Button>
      )}
      <ToolbarSeparator />
      <Button
        size="sm"
        icon={CheckCheck}
        busy={busy === 'auto'}
        disabled={planCount === 0}
        onClick={() => onCommand('auto')}
        title={tr(
          'المؤكد فقط: مبلغ مطابق واتجاه واحد ومرشّح واحد لا ثاني له.',
          'Uniquement les certitudes : montant exact, même sens, un seul candidat.',
          'The certain ones only: exact amount, same direction, and no second candidate.',
        )}
      >
        {tr(`مطابقة تلقائية (${count})`, `Automatique (${count})`, `Auto-match (${count})`)}
      </Button>
      <ToolbarSeparator />
      <Button size="sm" icon={RefreshCw} busy={loading} onClick={() => onCommand('refresh')}>
        {tr('تحديث', 'Actualiser', 'Refresh')}
      </Button>
      <ToolbarSeparator />
      <SearchBox
        ref={searchRef}
        value={search}
        onChange={onSearch}
        width={244}
        placeholder={tr('المرجع أو الوصف أو المبلغ', 'Référence, libellé ou montant', 'Reference, detail or amount')}
      />
      <ToolbarSpacer />
      <Button
        size="sm"
        icon={FileDown}
        busy={busy === 'export'}
        disabled={!canExport}
        onClick={() => onCommand('export')}
        title={tr(
          'تصدير ما لم يُطابق من الجانبين',
          'Exporter ce qui n’est rapproché d’aucun côté',
          'Export what did not match, on either side',
        )}
      >
        {tr('تصدير CSV', 'Exporter CSV', 'Export CSV')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Rail
 * ------------------------------------------------------------------ */

export interface ReconcileRailProps {
  readonly accounts: readonly BankAccount[];
  readonly account: BankAccount | null;
  readonly statements: readonly BankStatement[];
  readonly statement: BankStatement | null;
  readonly view: ReconcileView;
  readonly summary: Reconciliation;
  readonly ledgerRows: readonly LedgerRow[];
  readonly onAccount: (id: string) => void;
  readonly onStatement: (id: string) => void;
  readonly onView: (next: ReconcileView) => void;
}

export function ReconcileRail({
  accounts,
  account,
  statements,
  statement,
  view,
  summary,
  ledgerRows,
  onAccount,
  onStatement,
  onView,
}: ReconcileRailProps) {
  const { tr, lang } = useApp().locale;
  const loose = ledgerRows.filter(isEligible).length;
  return (
    <>
      <NavGroupLabel>{tr('البنوك', 'Banques', 'Banks')}</NavGroupLabel>
      {accounts.map((row) => (
        <NavItem
          key={row.id}
          icon={Landmark}
          label={row.name}
          selected={row.id === account?.id}
          onClick={() => onAccount(row.id)}
        />
      ))}
      <NavGroupLabel>{tr('الكشوف', 'Relevés', 'Statements')}</NavGroupLabel>
      {statements.length === 0 ? (
        <NavItem icon={CalendarRange} label={tr('لا كشوف', 'Aucun relevé', 'No statements')} disabled />
      ) : (
        statements.map((row) => (
          <NavItem
            key={row.id}
            icon={row.status === 'locked' ? Lock : CalendarRange}
            label={fmt.date(row.date, lang)}
            selected={row.id === statement?.id}
            onClick={() => onStatement(row.id)}
            depth={1}
          />
        ))
      )}
      <NavGroupLabel>{tr('العرض', 'Affichage', 'View')}</NavGroupLabel>
      <NavItem
        icon={CircleSlash}
        label={tr('غير مطابقة', 'Non rapprochées', 'Unmatched')}
        badge={summary.open === 0 ? null : summary.open}
        selected={view === 'open'}
        onClick={() => onView('open')}
      />
      <NavItem
        icon={BadgeCheck}
        label={tr('مطابقة', 'Rapprochées', 'Matched')}
        badge={summary.matched + summary.ignored === 0 ? null : summary.matched + summary.ignored}
        selected={view === 'matched'}
        onClick={() => onView('matched')}
      />
      <NavItem
        icon={BookOpen}
        label={tr('الدفتر', 'Le livre', 'Ledger')}
        badge={loose === 0 ? null : loose}
        selected={view === 'ledger'}
        onClick={() => onView('ledger')}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */

export interface ReconcileStatusProps {
  readonly shown: number;
  readonly summary: Reconciliation;
  readonly ledgerRows: readonly LedgerRow[];
  readonly currency: Currency;
  /** One of the pages came back at its ceiling, so suggestions are partial. */
  readonly truncated: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

export function ReconcileStatus({
  shown,
  summary,
  ledgerRows,
  currency,
  truncated,
  error,
  fetchedAt,
}: ReconcileStatusProps) {
  const { t, tr, lang } = useApp().locale;
  const counts = `${fmt.integer(shown, lang)} / ${fmt.integer(summary.total, lang)}`;
  const agreed = isAgreed(summary.difference);
  const loose = ledgerRows.filter(isEligible).length;
  return (
    <>
      <StatusItem icon={ListChecks} title={tr('المعروض من الكشف', 'Affichées sur le relevé', 'Shown of statement')}>
        {tr(`${counts} سطر`, `${counts} lignes`, `${counts} lines`)}
      </StatusItem>
      <StatusItem
        icon={BadgeCheck}
        tone={summary.open === 0 ? 'success' : undefined}
        title={tr('نسبة ما تمّ حسمه', 'Part des lignes décidées', 'Share of lines decided')}
      >
        {fmt.percent(summary.ratio, lang)}
      </StatusItem>
      {summary.open === 0 ? null : (
        <StatusItem
          tone="warning"
          icon={CircleSlash}
          title={tr('أسطر كشف بلا مقابل', 'Lignes du relevé sans contrepartie', 'Statement lines with no counterpart')}
        >
          {tr(
            `${fmt.integer(summary.open, lang)} معلّقة`,
            `${fmt.integer(summary.open, lang)} en suspens`,
            `${fmt.integer(summary.open, lang)} open`,
          )}
        </StatusItem>
      )}
      {loose === 0 ? null : (
        <StatusItem
          icon={BookOpen}
          title={tr(
            'قيود معتمدة على الحساب لم تُطابق بعد.',
            'Écritures comptabilisées sur le compte, pas encore rapprochées.',
            'Posted entries on the account, not yet reconciled.',
          )}
        >
          {tr(
            `${fmt.integer(loose, lang)} في الدفتر`,
            `${fmt.integer(loose, lang)} au livre`,
            `${fmt.integer(loose, lang)} in the ledger`,
          )}
        </StatusItem>
      )}
      {summary.drift === null || isAgreed(summary.drift) ? null : (
        <StatusItem
          tone="danger"
          icon={ShieldAlert}
          title={tr(
            'الرصيد الافتتاحي زائد الحركة لا يساوي الرصيد الختامي: الكشف نفسه لا يتوازن.',
            'Solde initial plus mouvement ≠ solde final : le relevé ne s’équilibre pas lui-même.',
            'Opening plus movement does not equal closing: the statement does not add up.',
          )}
        >
          {tr('الكشف غير متوازن', 'Relevé incohérent', 'Statement does not add up')}
        </StatusItem>
      )}
      {truncated ? (
        <StatusItem
          tone="warning"
          title={tr(
            'الوسيط يحمّل صفحة واحدة لكل مصدر، والمرشّحات تُحسب على ما حُمّل.',
            'Le courtier charge une page par source ; les candidats sont calculés sur cette page.',
            'The broker loads one page per source, and candidates are computed over what was loaded.',
          )}
        >
          {tr('صفحة مقتطعة', 'Page tronquée', 'Page truncated')}
        </StatusItem>
      ) : null}
      {error === null ? null : <StatusItem tone="danger">{error}</StatusItem>}
      <ToolbarSpacer />
      {summary.statement === null ? null : (
        <StatusItem icon={Wallet} title={tr('الرصيد الختامي للكشف', 'Solde final du relevé', 'Statement closing balance')}>
          {fmt.money(summary.statement.closing, currency, lang)}
        </StatusItem>
      )}
      <StatusItem
        icon={Scale}
        tone={agreed ? 'success' : 'danger'}
        title={tr(
          'حركة الكشف ناقص حركة الدفتر. صفر يعني أن المطابقة تمّت.',
          'Mouvement du relevé moins mouvement du livre. Zéro : le rapprochement est fait.',
          'Statement movement less book movement. Zero means the reconciliation is done.',
        )}
      >
        {agreed
          ? tr('متوازن', 'Rapproché', 'Agreed')
          : fmt.money(summary.difference, currency, lang)}
      </StatusItem>
      {summary.statement === null ? null : (
        <StatusItem title={t(STATEMENT_STATUS_LABEL[summary.statement.status])}>
          <Badge tone={statementTone(summary.statement.status)}>
            {t(STATEMENT_STATUS_LABEL[summary.statement.status])}
          </Badge>
        </StatusItem>
      )}
      {fetchedAt === null ? null : (
        <StatusItem icon={Rotate} title={fmt.dateTime(fetchedAt, lang)}>
          {fmt.time(fetchedAt, lang)}
        </StatusItem>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Row menu
 * ------------------------------------------------------------------ */

export interface LineMenuProps {
  readonly x: number;
  readonly y: number;
  readonly transaction: BankTransaction;
  readonly canMatch: boolean;
  readonly canUnmatch: boolean;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

/**
 * Right-click on a statement line.
 *
 * The line's own state leads, as a disabled header rather than a greyed-out act with
 * no explanation beside it: "already matched" is the answer to why Match is dim, and
 * a menu that withholds it is how an application makes somebody feel they did
 * something wrong.
 */
export function LineMenu({ x, y, transaction, canMatch, canUnmatch, onSelect, onDismiss }: LineMenuProps) {
  const { t, tr } = useApp().locale;
  const entries: MenuEntry[] = [
    { id: 'head', kind: 'header', label: `${transaction.date} · ${transaction.reference}` },
    { id: 'state', label: t(MATCH_STATE_LABEL[transaction.state]), icon: BadgeCheck, disabled: true },
    {
      id: 'match',
      label: tr('مطابقة مع أفضل مرشّح', 'Rapprocher avec le meilleur candidat', 'Match with the best candidate'),
      icon: Check,
      accelerator: 'Ctrl+Enter',
      disabled: !canMatch,
    },
    {
      id: 'unmatch',
      label: tr('إلغاء المطابقة', 'Annuler le rapprochement', 'Unmatch'),
      icon: Ban,
      accelerator: 'Ctrl+Backspace',
      danger: true,
      disabled: !canUnmatch,
    },
    { id: 'sep1', kind: 'separator' },
    { id: 'copy', label: tr('نسخ السطر', 'Copier la ligne', 'Copy line'), icon: ClipboardCopy },
    {
      id: 'open-account',
      label: tr('فتح الحساب في الدفتر', 'Ouvrir le compte dans le livre', 'Open the account in Ledger'),
      icon: BookOpen,
    },
    {
      id: 'export',
      label: tr('تصدير الفروق…', 'Exporter les écarts…', 'Export the differences…'),
      icon: FileDown,
      accelerator: 'Ctrl+E',
    },
  ];
  return (
    <MenuFlyout position="fixed" x={x} y={y} onDismiss={onDismiss} onSelect={onSelect} minWidth={264} entries={entries} />
  );
}
