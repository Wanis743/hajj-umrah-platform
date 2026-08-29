/**
 * Statements — the two panes.
 *
 * The statement pane is the case for the figures on screen: which statement, on which basis,
 * over which window, proven by how many postings, and whether the book balances. It is what
 * the export writes into the file and what the clipboard writes into a message, shown on
 * screen so that nobody has to export a statement to discover what it was about.
 *
 * The account pane is the same courtesy for one row. A balance says nothing about how much
 * of the book it rests on: the same figure can come off one posting or four hundred, and
 * only one of those is worth hunting a mistake in by eye. So the posting count sits beside
 * the balance rather than behind a tooltip, and an account with none says so in words —
 * a zero on the period basis is a fact about the window, not about the account.
 */
import {
  AlertTriangle,
  ClipboardCopy,
  ClipboardList,
  ExternalLink,
  FileDown,
  Gauge,
  Landmark,
  Percent,
  Scale,
  Sigma,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Button,
  Card,
  fmt,
  InfoBar,
  KpiTile,
  PropertyRow,
  Section,
  useLocale,
} from '@/platform/sdk';
import { ACCOUNT_TYPE_LABEL, EPSILON, toCurrency } from '../shared/ledger';
import type { StatementsBusy } from './actions';
import type { AccountFigure } from './balances';
import { basisLine, type Provenance } from './report';
import { type StatementView, type Summary, VIEW_LABEL } from './statement';
/** The headline figures of whichever statement is open, two by two. */
function HeadlineTiles({ view, summary }: { readonly view: StatementView; readonly summary: Summary }) {
  const { tr, lang } = useLocale();
  const cash = (value: number) => fmt.money(value, 'DZD', lang);
  const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } as const;
  if (view === 'trial') {
    return (
      <div style={grid}>
        <KpiTile label={tr('مدين', 'Débit', 'Debit')} value={cash(summary.debit)} icon={Sigma} tone="neutral" />
        <KpiTile label={tr('دائن', 'Crédit', 'Credit')} value={cash(summary.credit)} icon={Sigma} tone="neutral" />
      </div>
    );
  }
  if (view === 'balance') {
    return (
      <div style={grid}>
        <KpiTile label={tr('الأصول', 'Actif', 'Assets')} value={cash(summary.assets)} icon={Wallet} />
        <KpiTile
          label={tr('الخصوم', 'Passif', 'Liabilities')}
          value={cash(summary.liabilities)}
          icon={Landmark}
          tone="warning"
        />
        <KpiTile label={tr('رأس المال', 'Capitaux propres', 'Equity')} value={cash(summary.equity)} tone="neutral" />
        <KpiTile
          label={tr('نتيجة الفترة', 'Résultat', 'Result')}
          value={cash(summary.result)}
          tone={summary.result < 0 ? 'danger' : 'success'}
        />
      </div>
    );
  }
  return (
    <div style={grid}>
      <KpiTile label={tr('الإيرادات', 'Produits', 'Revenue')} value={cash(summary.revenue)} icon={TrendingUp} />
      <KpiTile
        label={tr('التكاليف', 'Charges', 'Expenses')}
        value={cash(summary.expense)}
        icon={TrendingDown}
        tone="warning"
      />
      <KpiTile
        label={tr('النتيجة', 'Résultat', 'Result')}
        value={cash(summary.result)}
        tone={summary.result < 0 ? 'danger' : 'success'}
      />
      <KpiTile
        label={tr('الهامش', 'Marge', 'Margin')}
        value={summary.margin === null ? tr('لا ينطبق', 'S. O.', 'n/a') : fmt.percent(summary.margin, lang, 1)}
        icon={Percent}
        tone="neutral"
      />
    </div>
  );
}
/* ------------------------------------------------------------------ *
 * The statement's case
 * ------------------------------------------------------------------ */

interface StatementPaneProps {
  readonly view: StatementView;
  readonly summary: Summary;
  /** Exactly what the export writes into the file, shown before it is written. */
  readonly source: Provenance;
  /** Postings the basis proved, which is not always `summary.lines`. */
  readonly postings: number;
  readonly coveredFrom: string | null;
  readonly busy: StatementsBusy;
  onCommand: (id: string) => void;
}

export function StatementPane(props: StatementPaneProps) {
  const { t, tr, lang } = useLocale();
  const { source, summary, view } = props;
  const gap = summary.debit - summary.credit;
  const sided = Math.abs(gap) >= EPSILON;
  const span =
    source.basis === 'book' || source.period === null
      ? tr('كل التواريخ', 'Toutes dates', 'All dates')
      : `${source.period.start} → ${source.period.end}`;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={Scale} title={t(VIEW_LABEL[view])} subtitle={basisLine(source, tr)}>
        <PropertyRow label={tr('الأساس', 'Base', 'Basis')}>
          {source.basis === 'book'
            ? tr('الدفتر بالكامل', 'Livre entier', 'Whole book')
            : tr('فترة', 'Période', 'Period')}
        </PropertyRow>
        <PropertyRow label={tr('النافذة', 'Fenêtre', 'Window')} mono>
          {span}
        </PropertyRow>
        {source.comparison === null ? null : (
          <PropertyRow label={tr('مقابل', 'Face à', 'Against')} mono>
            {`${source.comparison.start} → ${source.comparison.end}`}
          </PropertyRow>
        )}
        <PropertyRow label={tr('حسابات بحركة', 'Comptes actifs', 'Accounts with activity')} mono>
          {fmt.integer(summary.accounts, lang)}
        </PropertyRow>
        <PropertyRow label={tr('قيود', 'Écritures', 'Postings')} mono>
          {fmt.integer(props.postings, lang)}
        </PropertyRow>
      </Card>

      <HeadlineTiles view={view} summary={summary} />
      <Section title={tr('البرهان', 'La preuve', 'The proof')}>
        <PropertyRow label={tr('مدين ناقص دائن', 'Débit moins crédit', 'Debit less credit')} mono>
          <span style={{ color: sided ? 'var(--fx-danger)' : 'var(--fx-success)', fontWeight: 600 }}>
            {fmt.money(gap, 'DZD', lang)}
          </span>
        </PropertyRow>
        <PropertyRow
          label={tr('الأصول ناقص المطالبات', 'Actif moins engagements', 'Assets less claims')}
          mono
        >
          <span
            style={{ color: summary.balanced ? 'var(--fx-success)' : 'var(--fx-danger)', fontWeight: 600 }}
          >
            {fmt.money(summary.drift, 'DZD', lang)}
          </span>
        </PropertyRow>
      </Section>

      {summary.balanced && !sided ? (
        <InfoBar icon={Scale} tone="success" title={tr('الدفتر متوازن', 'Le livre est équilibré', 'The book balances')}>
          {tr(
            'المدين يساوي الدائن، والأصول تساوي كل ما يُطالَب بها. الأرقام أعلاه حساب، لا رأي.',
            'Débit égale crédit, et l’actif égale l’ensemble des engagements. Les nombres ci-dessus sont un calcul, pas un avis.',
            'Debit equals credit and assets equal everything claimed against them. The figures above are arithmetic, not opinion.',
          )}
        </InfoBar>
      ) : (
        <InfoBar
          icon={AlertTriangle}
          tone="danger"
          title={tr('الدفتر غير متوازن', 'Le livre n’est pas équilibré', 'The book does not balance')}
        >
          {tr(
            'الفرق مطبوع في سطره الخاص أسفل البيان. هذه واقعة عن الدفتر، ولن تُدفن هنا في رأس المال.',
            'L’écart est imprimé sur sa propre ligne au bas de l’état. C’est un fait sur le livre : il ne sera pas enterré dans les capitaux propres.',
            'The difference prints on its own line at the foot of the statement. It is a fact about the book, and it will not be buried in equity here.',
          )}
        </InfoBar>
      )}
      {source.bounded ? (
        <InfoBar
          icon={Gauge}
          tone="warning"
          title={tr('حدّ أدنى لا حصيلة', 'Un minorant, pas un total', 'A floor, not a total')}
        >
          {props.coveredFrom === null
            ? tr(
                'صفحة وصلت إلى سقفها: كل مجموع أعلاه قد يكون أكبر.',
                'Une page a atteint son plafond : chaque total ci-dessus peut être plus grand.',
                'A page came back at its ceiling, so every total above may be larger.',
              )
            : tr(
                `القيود مقروءة إلى ${props.coveredFrom} فقط. ما قبله لم يُقرأ، وهو ليس صفرًا.`,
                `Les écritures ne sont lues que jusqu’au ${props.coveredFrom}. Avant, rien n’a été lu — ce n’est pas zéro.`,
                `Entries were read back to ${props.coveredFrom} only. Before that nothing was read, which is not the same as zero.`,
              )}
        </InfoBar>
      ) : null}

      <div style={{ display: 'grid', gap: 8 }}>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => props.onCommand('copy')}>
          {tr('نسخ الملخّص', 'Copier la synthèse', 'Copy the summary')}
        </Button>
        <Button
          block
          icon={FileDown}
          busy={props.busy === 'export'}
          disabled={props.busy !== null}
          onClick={() => props.onCommand('export')}
        >
          {tr('تصدير البيان', 'Exporter l’état', 'Export the statement')}
        </Button>
      </div>
    </div>
  );
}
/* ------------------------------------------------------------------ *
 * One account
 * ------------------------------------------------------------------ */

interface AccountPaneProps {
  readonly figure: AccountFigure;
  readonly source: Provenance;
  onCommand: (id: string) => void;
}

export function AccountPane({ figure, source, onCommand }: AccountPaneProps) {
  const { t, tr, lang } = useLocale();
  // The book stores a currency string; the formatter takes one of the two this OS knows. An
  // account carrying anything else is shown in the book's own currency rather than being
  // printed with a symbol nothing here could total.
  const currency = toCurrency(figure.currency);
  const cash = (value: number) => fmt.money(value, currency, lang);
  const moved = figure.prior === null ? null : figure.balance - figure.prior;
  const quiet = figure.lines === 0;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <KpiTile
          label={tr('الرصيد', 'Solde', 'Balance')}
          value={cash(figure.balance)}
          icon={Wallet}
          tone={figure.balance < 0 ? 'warning' : 'neutral'}
        />
        <KpiTile
          label={tr('قيود', 'Écritures', 'Postings')}
          value={fmt.integer(figure.lines, lang)}
          icon={ClipboardList}
          tone={quiet ? 'warning' : 'neutral'}
        />
      </div>

      <Card
        icon={Landmark}
        title={`${figure.code} · ${figure.name}`}
        subtitle={`${t(ACCOUNT_TYPE_LABEL[figure.type])} · ${currency}`}
      >
        <PropertyRow label={tr('مدين', 'Débit', 'Debit')} mono>
          {cash(figure.debit)}
        </PropertyRow>
        <PropertyRow label={tr('دائن', 'Crédit', 'Credit')} mono>
          {cash(figure.credit)}
        </PropertyRow>
        {figure.prior === null ? null : (
          <PropertyRow label={tr('المقارنة', 'Comparaison', 'Prior')} mono>
            {cash(figure.prior)}
          </PropertyRow>
        )}
        {moved === null ? null : (
          <PropertyRow label={tr('الفرق', 'Écart', 'Variance')} mono>
            <span style={{ fontWeight: 600 }}>{cash(moved)}</span>
          </PropertyRow>
        )}
      </Card>
      {quiet ? (
        <InfoBar
          icon={AlertTriangle}
          tone="warning"
          title={tr('لا حركة', 'Aucun mouvement', 'No movement')}
        >
          {source.basis === 'book'
            ? tr(
                'لا قيد مُرحَّل على هذا الحساب في الدفتر كله.',
                'Aucune écriture comptabilisée sur ce compte dans tout le livre.',
                'No posted line touches this account anywhere in the book.',
              )
            : tr(
                'الحساب لم يتحرّك داخل النافذة. الصفر واقعة عن النافذة، لا عن الحساب.',
                'Le compte n’a pas bougé dans la fenêtre. Le zéro est un fait sur la fenêtre, pas sur le compte.',
                'The account did not move inside the window. The zero is a fact about the window, not about the account.',
              )}
        </InfoBar>
      ) : null}

      <Section title={tr('الأساس', 'Base', 'Basis')}>
        <span style={{ color: 'var(--fx-text-secondary)', fontSize: 'var(--fx-caption)' }}>
          {basisLine(source, tr)}
        </span>
      </Section>

      <div style={{ display: 'grid', gap: 8 }}>
        <Button block variant="accent" icon={ExternalLink} onClick={() => onCommand('ledger')}>
          {tr('فتح في الدفتر', 'Ouvrir dans le grand livre', 'Open in the ledger')}
        </Button>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copyRow')}>
          {tr('نسخ الحساب', 'Copier le compte', 'Copy this account')}
        </Button>
      </div>
    </div>
  );
}
