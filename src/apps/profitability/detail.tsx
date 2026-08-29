/**
 * Profitability — the two panes.
 *
 * The report pane is the case for the figures on screen: by what they were sliced, over
 * what window, against what, and — before any of it — how much of the book they actually
 * describe. It is what the export writes into the file and what the clipboard writes into
 * a message, shown on screen so nobody has to export a report to find out what it was
 * about.
 *
 * The member pane is the same courtesy for one row, and it exists because a margin invites
 * exactly one reply: why. The answer is nearly always in the first three accounts, so the
 * accounts that made the figure are printed under it rather than left behind a drill-down,
 * and on a package the departures booked against it are printed too — those are what an
 * operator recognises, and they are the only reason a package id has a name at all.
 *
 * The remainder gets the same pane as any member and one extra sentence, because it is the
 * one row where the right next action is not analysis but tagging.
 */
import {
  AlertTriangle,
  Boxes,
  Building2,
  CalendarRange,
  ChartPie,
  CircleHelp,
  ClipboardCopy,
  ClipboardList,
  ExternalLink,
  FileDown,
  Gauge,
  Landmark,
  Percent,
  Sigma,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Button, Card, fmt, InfoBar, KpiTile, PropertyRow, Section, useLocale } from '@/platform/sdk';
import type { ProfitabilityBusy } from './actions';
import {
  coverageTone,
  type Dimension,
  isUntagged,
  type MemberFigure,
  type Slice,
  variance,
} from './figures';
import type { Departure } from './model';
import { DIMENSION_LABEL, DIMENSION_UNIT } from './question';
import { basisLine, type Provenance } from './report';
/** A margin is the one figure here whose sign is the point, so its sign picks the tone. */
const marginTone = (value: number): 'success' | 'danger' => (value < 0 ? 'danger' : 'success');

/**
 * A coverage grade as the colour that grade already means everywhere else in the OS.
 *
 * Spelled out rather than built by interpolation so that a reader — and the stylesheet
 * audit — can see every token this file can possibly paint with.
 */
const GRADE_COLOR: Readonly<Record<'success' | 'warning' | 'danger', string>> = {
  success: 'var(--fx-success)',
  warning: 'var(--fx-warning)',
  danger: 'var(--fx-danger)',
};

/**
 * What the window adds up to: the two sides, their difference, and that as a rate.
 *
 * The book's totals rather than the allocated ones, because these are the figures that have
 * to agree with the income statement over the same window. What the members between them
 * account for is a property row below, beside the coverage that explains the difference.
 */
function SliceTiles({ slice }: { readonly slice: Slice }) {
  const { tr, lang } = useLocale();
  const cash = (value: number) => fmt.money(value, 'DZD', lang);
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      <KpiTile
        label={tr('الإيرادات', 'Produits', 'Revenue')}
        value={cash(slice.totals.revenue)}
        icon={TrendingUp}
      />
      <KpiTile
        label={tr('التكاليف', 'Charges', 'Cost')}
        value={cash(slice.totals.cost)}
        icon={TrendingDown}
        tone="warning"
      />
      <KpiTile
        label={tr('الهامش', 'Marge', 'Margin')}
        value={cash(slice.totals.margin)}
        icon={Sigma}
        tone={marginTone(slice.totals.margin)}
      />
      <KpiTile
        label={tr('نسبة الهامش', 'Taux de marge', 'Margin rate')}
        value={
          slice.totals.rate === null
            ? tr('لا ينطبق', 'S. O.', 'n/a')
            : fmt.percent(slice.totals.rate, lang, 1)
        }
        icon={Percent}
        tone="neutral"
      />
    </div>
  );
}
/**
 * Coverage, in the words the figure deserves — and only when it deserves any.
 *
 * At nine tenths and above the percentage in the card says everything there is to say, and
 * a bar that appears on every single report is a bar nobody reads. Below six tenths the
 * sentence stops being a caveat about the figures and becomes the finding: the report is
 * then about the tagging rather than about the business, and the next action is not analysis.
 */
function CoverageBar({
  coverage,
  dimension,
}: {
  readonly coverage: number;
  readonly dimension: Dimension;
}) {
  const { t, tr, lang } = useLocale();
  const tone = coverageTone(coverage);
  if (tone === 'success') return null;
  const unit = t(DIMENSION_LABEL[dimension]).toLowerCase();
  const shown = fmt.percent(coverage, lang, 1);
  if (tone === 'danger') {
    return (
      <InfoBar
        icon={AlertTriangle}
        tone="danger"
        title={tr('التقرير عن التخصيص لا عن النشاط', 'Ce rapport porte sur l’affectation', 'This report is about the tagging')}
      >
        {tr(
          `${shown} فقط من حركة النافذة تحمل ${unit}. الهامش المحسوب على الباقي ليس أدقّ، بل أصغر — ابدأ بترقيم القيود في السطر غير المخصَّص.`,
          `Seuls ${shown} de l’activité de la fenêtre portent un ${unit}. La marge calculée sur le reste n’est pas plus juste, elle est plus petite — commencez par affecter les écritures de la ligne non affectée.`,
          `Only ${shown} of the window's activity carries a ${unit}. A margin computed over the rest is not a truer figure, it is a smaller one — start by tagging the postings in the unallocated row.`,
        )}
      </InfoBar>
    );
  }
  return (
    <InfoBar
      icon={ChartPie}
      tone="warning"
      title={tr('اقرأه مع السطر غير المخصَّص', 'À lire avec la ligne non affectée', 'Read this with the unallocated row')}
    >
      {tr(
        `${shown} من حركة النافذة تحمل ${unit}. الباقي في السطر الأخير من الجدول، وهو غير موزَّع على الأعضاء أعلاه.`,
        `${shown} de l’activité de la fenêtre portent un ${unit}. Le reste figure à la dernière ligne du tableau et n’est pas réparti sur les membres au-dessus.`,
        `${shown} of the window's activity carries a ${unit}. The rest is on the last row of the table, and it is not spread across the members above it.`,
      )}
    </InfoBar>
  );
}
/* ------------------------------------------------------------------ *
 * The report's case
 * ------------------------------------------------------------------ */

/**
 * The part of the book the members do not speak for, in money.
 *
 * "38% unallocated" and "1 240 000 DZD unallocated" land very differently on the person who
 * has to go and tag it, so the remainder is given as an amount here and as a percentage in
 * the card above. It is a plain section rather than a warning, because on a well-tagged book
 * it is a small true fact — the bar above decides when it stops being one.
 */
function Remainder({ member }: { readonly member: MemberFigure }) {
  const { tr, lang } = useLocale();
  const cash = (value: number) => fmt.money(value, 'DZD', lang);
  return (
    <Section title={tr('غير مخصَّص', 'Non affecté', 'Unallocated')}>
      <PropertyRow label={tr('الإيرادات', 'Produits', 'Revenue')} mono>
        {cash(member.revenue)}
      </PropertyRow>
      <PropertyRow label={tr('التكاليف', 'Charges', 'Cost')} mono>
        {cash(member.cost)}
      </PropertyRow>
      <PropertyRow label={tr('الهامش', 'Marge', 'Margin')} mono>
        <span style={{ fontWeight: 600 }}>{cash(member.margin)}</span>
      </PropertyRow>
      <PropertyRow label={tr('عدد القيود', 'Écritures', 'Postings')} mono>
        {fmt.integer(member.postings, lang)}
      </PropertyRow>
    </Section>
  );
}
interface SlicePaneProps {
  readonly slice: Slice;
  /** Exactly what the export writes into the file, shown before anybody writes it. */
  readonly source: Provenance;
  /** The oldest posted date the page reached, when it did not reach them all. */
  readonly coveredFrom: string | null;
  readonly busy: ProfitabilityBusy;
  onCommand: (id: string) => void;
}

export function SlicePane(props: SlicePaneProps) {
  const { t, tr, lang } = useLocale();
  const { slice, source } = props;
  const span =
    source.basis === 'book' || source.period === null
      ? tr('كل التواريخ', 'Toutes dates', 'All dates')
      : `${source.period.start} → ${source.period.end}`;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card
        icon={ChartPie}
        title={`${tr('الهامش حسب', 'Marge par', 'Margin by')} ${t(DIMENSION_LABEL[source.dimension])}`}
        subtitle={basisLine(source, t, tr)}
      >
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
        <PropertyRow label={t(DIMENSION_UNIT[source.dimension])} mono>
          {fmt.integer(slice.members.length, lang)}
        </PropertyRow>
        <PropertyRow label={tr('هامش الأعضاء', 'Marge des membres', 'Members account for')} mono>
          {fmt.money(slice.allocated.margin, 'DZD', lang)}
        </PropertyRow>
        <PropertyRow label={tr('التغطية', 'Couverture', 'Coverage')} mono>
          {source.coverage === null ? (
            <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
          ) : (
            <span
              style={{
                color: GRADE_COLOR[coverageTone(source.coverage)],
                fontWeight: 600,
              }}
            >
              {fmt.percent(source.coverage, lang, 1)}
            </span>
          )}
        </PropertyRow>
        <PropertyRow label={tr('قيود', 'Écritures', 'Postings')} mono>
          {fmt.integer(slice.lines, lang)}
        </PropertyRow>
      </Card>
      <SliceTiles slice={slice} />
      {source.coverage === null ? null : (
        <CoverageBar coverage={source.coverage} dimension={source.dimension} />
      )}
      {slice.untagged === null ? null : <Remainder member={slice.untagged} />}
      {source.bounded ? (
        <InfoBar
          icon={Gauge}
          tone="warning"
          title={tr('حدّ أدنى لا حصيلة', 'Un minorant, pas un total', 'A floor, not a total')}
        >
          {props.coveredFrom === null
            ? tr(
                'صفحة وصلت إلى سقفها: كل هامش أعلاه قد يكون أكبر.',
                'Une page a atteint son plafond : chaque marge ci-dessus peut être plus grande.',
                'A page came back at its ceiling, so every margin above may be larger.',
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
          {tr('تصدير الجدول', 'Exporter le tableau', 'Export the table')}
        </Button>
      </div>
    </div>
  );
}
/* ------------------------------------------------------------------ *
 * One member
 * ------------------------------------------------------------------ */

/** How many accounts a pane prints before the list stops being an explanation. */
const TOP_ACCOUNTS = 8;

/**
 * The accounts that made the margin, biggest first.
 *
 * Printed here rather than hidden behind a drill-down, because a margin invites exactly one
 * reply — why — and this is the answer to it. Each amount is signed the way its own account
 * reads it, so an expense that comes back negative was credited on balance: a correction,
 * and worth seeing as one rather than being folded into a smaller cost.
 */
function AccountLines({ member }: { readonly member: MemberFigure }) {
  const { tr, lang } = useLocale();
  const rest = member.accounts.length - TOP_ACCOUNTS;
  return (
    <Card
      icon={Landmark}
      title={tr('أكبر الحسابات', 'Principaux comptes', 'Largest accounts')}
      subtitle={
        rest > 0
          ? tr(
              `أكبر ${TOP_ACCOUNTS} من ${member.accounts.length}`,
              `Les ${TOP_ACCOUNTS} plus gros sur ${member.accounts.length}`,
              `The ${TOP_ACCOUNTS} largest of ${member.accounts.length}`,
            )
          : tr('بترتيب الحجم', 'Par ordre de grandeur', 'In order of size')
      }
    >
      {member.accounts.slice(0, TOP_ACCOUNTS).map((row) => (
        <PropertyRow key={row.accountId} label={`${row.code} · ${row.name}`} mono>
          <span style={{ color: row.type === 'REVENUE' ? undefined : 'var(--fx-text-secondary)' }}>
            {fmt.money(row.amount, 'DZD', lang)}
          </span>
          <span style={{ color: 'var(--fx-text-tertiary)', marginInlineStart: 6 }}>
            {`×${fmt.integer(row.postings, lang)}`}
          </span>
        </PropertyRow>
      ))}
    </Card>
  );
}
/** How many departures a pane lists before the list stops being a label. */
const TOP_DEPARTURES = 6;

/**
 * The departures booked against this package.
 *
 * The only place in the app where a package id turns into something an operator recognises,
 * so it prints the code, the date and how full each departure is rather than a bare count.
 * None of it is money: `groups` carries no amount, and a margin per departure would have to
 * be invented rather than read.
 */
function DepartureLines({ departures }: { readonly departures: readonly Departure[] }) {
  const { tr, lang } = useLocale();
  const shown = departures.slice(0, TOP_DEPARTURES);
  const rest = departures.length - shown.length;
  const count = tr(
    `${departures.length} رحلة`,
    `${departures.length} départ(s)`,
    `${departures.length} departure(s)`,
  );
  return (
    <Card
      icon={CalendarRange}
      title={tr('الرحلات', 'Départs', 'Departures')}
      subtitle={
        rest > 0
          ? `${count} · ${tr(`أول ${shown.length}`, `les ${shown.length} premiers`, `first ${shown.length} shown`)}`
          : count
      }
    >
      {shown.map((one) => (
        <PropertyRow key={one.id} label={one.code === '' ? one.name : `${one.code} · ${one.name}`} mono>
          {one.departure === null
            ? tr('بلا تاريخ', 'Sans date', 'No date')
            : one.departure.slice(0, 10)}
          <span style={{ color: 'var(--fx-text-tertiary)', marginInlineStart: 6 }}>
            {`${fmt.integer(one.booked, lang)}/${fmt.integer(one.capacity, lang)}`}
          </span>
        </PropertyRow>
      ))}
    </Card>
  );
}
/**
 * The remainder's one sentence.
 *
 * The figures on this pane are accurate; what they lack is an owner. So the note reads as an
 * instruction rather than as a caveat — this is the one row in the table whose right next
 * action is tagging a posting rather than reading a margin.
 */
function RemainderNote({ dimension }: { readonly dimension: Dimension }) {
  const { t, tr } = useLocale();
  const unit = t(DIMENSION_LABEL[dimension]).toLowerCase();
  return (
    <InfoBar
      icon={AlertTriangle}
      tone="warning"
      title={tr('لا يُنسب إلى أحد', 'Attribuable à personne', 'Attributable to nobody')}
    >
      {tr(
        `هذه القيود لا تحمل ${unit}. الأرقام أعلاه صحيحة، لكنها بلا صاحب حتى يُخصَّص القيد نفسه.`,
        `Ces écritures ne portent aucun ${unit}. Les nombres ci-dessus sont exacts, mais ils n’ont pas de propriétaire tant que l’écriture elle-même n’est pas affectée.`,
        `These postings carry no ${unit}. The figures above are accurate; they simply belong to nobody until the entry itself is tagged.`,
      )}
    </InfoBar>
  );
}

/** A row that only exists because of its comparison column, said out loud. */
function QuietNote({ windowed }: { readonly windowed: boolean }) {
  const { tr } = useLocale();
  return (
    <InfoBar
      icon={AlertTriangle}
      tone="warning"
      title={tr('لا حركة في النافذة', 'Aucun mouvement dans la fenêtre', 'No movement in the window')}
    >
      {windowed
        ? tr(
            'لا قيد مُرحَّل داخل النافذة يحمل هذا المعرّف. السطر موجود لأن عمود المقارنة وجد حركة في الفترة السابقة.',
            'Aucune écriture comptabilisée dans la fenêtre ne porte cet identifiant. La ligne existe parce que la colonne de comparaison a trouvé un mouvement sur la période précédente.',
            'No posted entry inside the window carries this id. The row exists because the comparison column found movement in the period before it.',
          )
        : tr(
            'لا قيد مُرحَّل في الدفتر كله يحمل هذا المعرّف.',
            'Aucune écriture comptabilisée du livre entier ne porte cet identifiant.',
            'No posted entry anywhere in the book carries this id.',
          )}
    </InfoBar>
  );
}
/**
 * Why the row above is titled by an id.
 *
 * A reader who sees `9f3c1a44` where a name belongs will assume the app is broken. It is not:
 * nothing an app can read names a branch at all, and a package is named by the departures
 * booked against it, so one with none has nothing to be called.
 */
function NamingNote({ dimension }: { readonly dimension: Dimension }) {
  const { tr } = useLocale();
  return (
    <InfoBar
      icon={CircleHelp}
      tone="info"
      title={tr('هذا المعرّف بلا اسم', 'Cet identifiant n’a pas de nom', 'This id has no name')}
    >
      {dimension === 'package'
        ? tr(
            'لا رحلة في الدفتر مسجَّلة على هذه الباقة، فتُطبع بمعرّفها.',
            'Aucun départ du livre n’est rattaché à ce forfait : il s’imprime donc par son identifiant.',
            'No departure in the book is booked against this package, so it prints by its id.',
          )
        : tr(
            'لا شيء متاح للتطبيقات يسمّي الفروع، فتُطبع ببداية معرّفها.',
            'Rien de ce qui est exposé aux applications ne nomme les succursales : elles s’impriment par le début de leur identifiant.',
            'Nothing exposed to an app names a branch, so it prints by the stem of its id.',
          )}
    </InfoBar>
  );
}
/** The four figures one row is: its margin, that as a rate, its weight, and its evidence. */
function MemberTiles({ member }: { readonly member: MemberFigure }) {
  const { tr, lang } = useLocale();
  const none = tr('لا ينطبق', 'S. O.', 'n/a');
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      <KpiTile
        label={tr('الهامش', 'Marge', 'Margin')}
        value={fmt.money(member.margin, 'DZD', lang)}
        icon={Sigma}
        tone={marginTone(member.margin)}
      />
      <KpiTile
        label={tr('نسبة الهامش', 'Taux de marge', 'Margin rate')}
        value={member.rate === null ? none : fmt.percent(member.rate, lang, 1)}
        icon={Percent}
        tone="neutral"
      />
      <KpiTile
        label={tr('الحصة من الإيرادات', 'Part des produits', 'Share of revenue')}
        value={member.share === null ? none : fmt.percent(member.share, lang, 1)}
        icon={ChartPie}
        tone="neutral"
      />
      <KpiTile
        label={tr('قيود', 'Écritures', 'Postings')}
        value={fmt.integer(member.postings, lang)}
        icon={ClipboardList}
        tone={member.postings === 0 ? 'warning' : 'neutral'}
      />
    </div>
  );
}
interface MemberPaneProps {
  readonly member: MemberFigure;
  readonly source: Provenance;
  /** Every departure the app read. The pane keeps the ones this package holds. */
  readonly departures: readonly Departure[];
  onCommand: (id: string) => void;
}

export function MemberPane({ member, source, departures, onCommand }: MemberPaneProps) {
  const { t, tr, lang } = useLocale();
  const cash = (value: number) => fmt.money(value, 'DZD', lang);
  const remainder = isUntagged(member);
  const gap = variance(member);
  const label = t(DIMENSION_LABEL[source.dimension]);
  // Filtered here rather than in the model: which departures matter depends on which row is
  // open, and a model that knew that would re-walk the list on every click in the table.
  const mine =
    source.dimension === 'package' && member.id !== null
      ? departures.filter((one) => one.packageId === member.id)
      : [];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <MemberTiles member={member} />
      <Card
        icon={source.dimension === 'package' ? Boxes : Building2}
        title={member.label}
        subtitle={member.detail === '' ? label : `${label} · ${member.detail}`}
      >
        <PropertyRow label={tr('الإيرادات', 'Produits', 'Revenue')} mono>
          {cash(member.revenue)}
        </PropertyRow>
        <PropertyRow label={tr('التكاليف', 'Charges', 'Cost')} mono>
          {cash(member.cost)}
        </PropertyRow>
        <PropertyRow label={tr('الهامش', 'Marge', 'Margin')} mono>
          {/* Red on a loss and nothing on a profit, exactly as the grid paints it: the tile
              above already carries the tone, and a second green would be saying it twice. */}
          <span style={{ color: member.margin < 0 ? 'var(--fx-danger)' : undefined, fontWeight: 600 }}>
            {cash(member.margin)}
          </span>
        </PropertyRow>
        {member.prior === null ? null : (
          <PropertyRow label={tr('المقارنة', 'Comparaison', 'Prior')} mono>
            {cash(member.prior)}
          </PropertyRow>
        )}
        {gap === null ? null : (
          <PropertyRow label={tr('الفرق', 'Écart', 'Variance')} mono>
            <span style={{ fontWeight: 600 }}>{cash(gap)}</span>
          </PropertyRow>
        )}
      </Card>
      {mine.length === 0 ? null : <DepartureLines departures={mine} />}
      {member.accounts.length === 0 ? null : <AccountLines member={member} />}
      {remainder ? <RemainderNote dimension={source.dimension} /> : null}
      {!remainder && member.postings === 0 ? (
        <QuietNote windowed={source.basis === 'period'} />
      ) : null}
      {!remainder && member.detail === '' ? <NamingNote dimension={source.dimension} /> : null}
      <Section title={tr('الأساس', 'Base', 'Basis')}>
        <span style={{ color: 'var(--fx-text-secondary)', fontSize: 'var(--fx-caption)' }}>
          {basisLine(source, t, tr)}
        </span>
      </Section>

      <div style={{ display: 'grid', gap: 8 }}>
        <Button
          block
          variant="accent"
          icon={ExternalLink}
          disabled={member.accounts.length === 0}
          title={tr(
            'يفتح أكبر حساب وراء هذا السطر في دفتر اليومية.',
            'Ouvre le plus gros compte derrière cette ligne dans le grand livre.',
            'Opens the largest account behind this row in the ledger.',
          )}
          onClick={() => onCommand('ledger')}
        >
          {tr('فتح أكبر حساب', 'Ouvrir le plus gros compte', 'Open the largest account')}
        </Button>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copyRow')}>
          {tr('نسخ هذا السطر', 'Copier cette ligne', 'Copy this row')}
        </Button>
      </div>
    </div>
  );
}









