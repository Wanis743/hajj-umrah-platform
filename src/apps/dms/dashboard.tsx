/**
 * The dashboard tab: what the six reads add up to, before anybody opens a row.
 *
 * The exported component is `DmsOverview` rather than `DmsDashboard` because `types.ts`
 * already owns that name for the RPC's payload, and a component sharing a name with the
 * shape it renders makes every import in `App.tsx` ambiguous to a reader. The type is
 * imported here unaliased; the component took the other name.
 *
 * Five sections, in the order `export.ts`'s `dashboardTable` writes them — totals, review
 * status, document type, confidentiality, activity. That agreement is deliberate and worth
 * keeping: somebody who exports this tab and opens the CSV should find the rows in the order
 * they just read them on screen, not have to hunt for the section they cared about.
 *
 * Two readings are drawn rather than tabulated because a shape answers them faster than a
 * number does. The status ring answers *what is the queue made of*; the day series answers
 * *is the desk keeping up*. The other three are counts, and counts are shown as counts.
 *
 * Nothing here invents a fact the report did not carry. The donut's centre is the sum of its
 * own slices and not `totals.documents`, because the two need not agree — a slice table is
 * whatever the server grouped, and a centre that quietly disagreed with its ring would be a
 * claim nobody made. Shares are suppressed rather than shown as `0%` when their denominator
 * is zero. And a report that has not arrived is drawn as *arriving*, never as *empty*: an
 * empty state on a loading window reads as "this workspace has no documents", which is a lie
 * with a very short shelf life and real consequences for whoever believes it.
 */
import type { CSSProperties } from 'react';
import {
  Activity,
  Archive,
  BadgeCheck,
  CalendarClock,
  CalendarX2,
  Clock,
  FileCheck2,
  FileStack,
  Files,
  Layers,
  LayoutDashboard,
  ShieldCheck,
} from 'lucide-react';
import {
  type AppLang,
  BarChart,
  type BarDatum,
  Card,
  DonutChart,
  type DonutSlice,
  EmptyState,
  fmt,
  KpiTile,
  LineChart,
  type LineSeries,
  Spinner,
  StackedBar,
  toneColor,
  useLocale,
} from '@/platform/sdk';
import { DASH } from './format';
import { CONFIDENTIALITY_LABEL, humanize, labelFor, REVIEW_LABEL } from './labels';
import type { DmsShell } from './shell';
import { CONFIDENTIALITY_TONE, REVIEW_TONE, type BadgeTone } from './tones';
import type { DmsDashboard } from './types';

const PAGE: CSSProperties = { display: 'grid', gap: 16, alignContent: 'start' };
const KPI_GRID: CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(212px, 1fr))',
};
const CARD_GRID: CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
};

/**
 * How many document types the ranking draws.
 *
 * `documentType` is free text each workspace defines for itself, so this list has no natural
 * ceiling — a workspace with sixty types would otherwise push the activity trend below the
 * fold. Ten is what fits beside the ring without scrolling, the card says so when it has
 * cut anything, and the CSV carries every one of them.
 */
const TYPE_ROWS = 10;

/** Roughly how many dates the day axis spells out. See {@link axisLabels}. */
const AXIS_TICKS = 6;

/** Approved shares at or above these read as healthy and as fine respectively. */
const APPROVAL_GOOD = 0.85;
const APPROVAL_FAIR = 0.6;

/* ------------------------------------------------------------------ *
 * Private helpers
 * ------------------------------------------------------------------ */

/**
 * A part of a whole, or nothing when there is no whole.
 *
 * `0%` and "there is nothing to take a percentage of" are different statements, and a tile
 * that prints the first when it means the second invites somebody to go looking for the
 * documents that were rejected.
 */
function share(part: number, whole: number, lang: AppLang): string {
  if (whole <= 0) return DASH;
  return fmt.percent(part / whole, lang, 0);
}

/**
 * How healthy a document type's approved share is, as a tone.
 *
 * Written out here rather than borrowed from `confidenceTone`, whose bands happen to sit at
 * the same two numbers but mean something else entirely — an extraction engine's own
 * certainty about a field it read. Two readings that share a threshold today would drift the
 * first time either one is tuned, and a reader following the import would be told the wrong
 * story about what the colour means.
 */
function approvalTone(approved: number, count: number): BadgeTone {
  if (count <= 0) return 'neutral';
  const ratio = approved / count;
  if (ratio >= APPROVAL_GOOD) return 'success';
  if (ratio >= APPROVAL_FAIR) return 'warning';
  return 'danger';
}

/**
 * Dates for the day axis, with most of them blanked.
 *
 * `LineChart` draws one label per point, each taking an equal share of the width — which is
 * right for twelve months and unreadable for ninety days. Blanking the labels rather than
 * thinning the *points* keeps the line, the hover readout and the CSV describing exactly the
 * same series: only the axis is sparse, and every day is still there to hover.
 *
 * The first and last days always get their date, since between them they are the window the
 * card's subtitle is talking about.
 */
function axisLabels(days: readonly string[], lang: AppLang): readonly string[] {
  const step = Math.max(1, Math.ceil(days.length / AXIS_TICKS));
  const last = days.length - 1;
  return days.map((day, index) =>
    index === 0 || index === last || index % step === 0 ? fmt.date(day, lang) : '',
  );
}

/** Every section below draws one field of an already-resolved report. */
interface Panel {
  readonly report: DmsDashboard;
}

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

/**
 * Seven tiles for eight numbers.
 *
 * `createdInWindow` rides along as the documents tile's second line rather than taking a tile
 * of its own, because it is the same number in a narrower frame — how much of the library
 * arrived recently — and an eighth tile would push the row onto two lines at the width most
 * of these windows actually open at.
 *
 * Four of the seven are doors. The three queue counts land on the tab that lists them, which
 * is the next thing anybody does after reading them; versions and archived are not doors
 * because no tab lists either one on its own. A tile that looks clickable and answers nothing
 * is worse than a tile that plainly does not.
 *
 * The tones say whether a number is a problem, and they are not decoration: zero documents
 * awaiting review is genuinely good news and green says so, while any number of expired
 * documents is a compliance fact somebody has to answer for and red says that too.
 */
function Totals({ report, shell }: Panel & { readonly shell: DmsShell }) {
  const { tr, lang } = useLocale();
  const total = report.totals;
  const n = (value: number): string => fmt.integer(value, lang);
  return (
    <div style={KPI_GRID}>
      <KpiTile
        label={tr('المستندات', 'Documents', 'Documents')}
        value={n(total.documents)}
        secondary={tr(
          `${n(total.createdInWindow)} جديدة في ${n(report.windowDays)} يوم`,
          `${n(total.createdInWindow)} nouveaux en ${n(report.windowDays)} jours`,
          `${n(total.createdInWindow)} new in ${n(report.windowDays)} days`,
        )}
        icon={FileStack}
        onClick={() => shell.changeView('library')}
      />
      <KpiTile
        label={tr('معتمدة', 'Approuvés', 'Approved')}
        value={n(total.approved)}
        secondary={share(total.approved, total.documents, lang)}
        icon={BadgeCheck}
        tone="success"
      />
      <KpiTile
        label={tr('في انتظار المراجعة', 'En attente de revue', 'Awaiting review')}
        value={n(total.awaitingReview)}
        secondary={tr('في طابور المراجعة', 'Dans la file de revue', 'Sitting in the review queue')}
        icon={Clock}
        tone={total.awaitingReview === 0 ? 'success' : 'warning'}
        onClick={() => shell.changeView('review')}
      />
      <KpiTile
        label={tr('تقارب الانقضاء', 'Bientôt échus', 'Expiring soon')}
        value={n(total.expiringSoon)}
        secondary={tr('حسب نافذة الإشعار', 'Selon leur préavis', 'Inside their notice window')}
        icon={CalendarClock}
        tone={total.expiringSoon === 0 ? 'success' : 'warning'}
        onClick={() => shell.changeView('expiry')}
      />
      <KpiTile
        label={tr('منقضية', 'Échus', 'Expired')}
        value={n(total.expired)}
        secondary={tr('تجاوزت تاريخها', 'Date dépassée', 'Past their date')}
        icon={CalendarX2}
        tone={total.expired === 0 ? 'success' : 'danger'}
        onClick={() => shell.changeView('expiry')}
      />
      <KpiTile
        label={tr('الإصدارات', 'Révisions', 'Versions')}
        value={n(total.versions)}
        secondary={tr('كل الإصدارات المحفوظة', 'Toutes révisions confondues', 'Every revision on file')}
        icon={Files}
        tone="neutral"
      />
      <KpiTile
        label={tr('مؤرشفة', 'Archivés', 'Archived')}
        value={n(total.archived)}
        secondary={share(total.archived, total.documents, lang)}
        icon={Archive}
        tone="neutral"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * By review status
 * ------------------------------------------------------------------ */

/**
 * The library as a ring of review states.
 *
 * A ring rather than bars because the question this answers is compositional — *how much of
 * the library is still in flight* — and the eight states are a closed union whose colours are
 * already fixed by `REVIEW_TONE`. Reusing those tones means the slice for `REJECTED` is the
 * same red as the badge on the row, which is the whole reason the tone table is a table and
 * not eight scattered literals.
 *
 * Zero-count states are dropped. A closed union means the report can legitimately carry a row
 * of zero, and a legend entry for a state nothing is in costs a line of width to say nothing.
 */
function StatusRing({ report }: Panel) {
  const { t, tr, lang } = useLocale();
  const slices: readonly DonutSlice[] = report.byStatus
    .filter((row) => row.count > 0)
    .map((row) => ({
      label: labelFor(REVIEW_LABEL, row.status, t),
      value: row.count,
      color: toneColor(REVIEW_TONE[row.status]),
    }));
  const counted = slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <Card
      title={tr('حالة المراجعة', 'État de revue', 'Review status')}
      subtitle={tr('توزيع المكتبة', 'Répartition de la bibliothèque', 'How the library breaks down')}
      icon={FileCheck2}
    >
      {slices.length === 0 ? (
        <EmptyState
          compact
          icon={FileCheck2}
          title={tr('لا مستندات', 'Aucun document', 'No documents')}
          description={tr(
            'لا مستند في أي حالة مراجعة بعد.',
            'Aucun document dans aucun état de revue.',
            'Nothing sits in any review state yet.',
          )}
        />
      ) : (
        <DonutChart
          slices={slices}
          size={168}
          thickness={20}
          format={(value) => fmt.integer(value, lang)}
          center={
            <div style={{ textAlign: 'center' }}>
              <div className="fx-mono" style={{ fontWeight: 600 }}>
                {fmt.integer(counted, lang)}
              </div>
              <div style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>
                {tr('مستند', 'documents', 'documents')}
              </div>
            </div>
          }
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * By document type
 * ------------------------------------------------------------------ */

/**
 * Which kinds of document there are most of, and which kinds are behind on approval.
 *
 * Two facts on one row: the bar's length is how many documents carry the type, its colour is
 * what share of them is approved. That pairing is the reading worth having — a type with two
 * hundred documents and a third of them approved is a backlog, while the same colour on a
 * type with three documents is a rounding error, and a chart carrying only one of the two
 * numbers cannot tell them apart.
 *
 * `documentType` is workspace-defined free text with no label table behind it, so `humanize`
 * does what it can with the token. Sorted by count and cut at {@link TYPE_ROWS}, with the
 * subtitle saying so whenever anything was cut.
 */
function TypeRanking({ report }: Panel) {
  const { tr, lang } = useLocale();
  const ranked = [...report.byType].sort((left, right) => right.count - left.count);
  const shown = ranked.slice(0, TYPE_ROWS);
  const data: readonly BarDatum[] = shown.map((row) => ({
    label: humanize(row.documentType),
    value: row.count,
    color: toneColor(approvalTone(row.approved, row.count)),
  }));
  const cut = ranked.length - shown.length;
  return (
    <Card
      title={tr('نوع المستند', 'Type de document', 'Document type')}
      subtitle={
        cut === 0
          ? tr('الطول عدد، اللون نسبة الاعتماد', 'Longueur : nombre · couleur : taux d’approbation', 'Length is count, colour is approved share')
          : tr(
              `أكبر ${fmt.integer(shown.length, lang)} من ${fmt.integer(ranked.length, lang)} نوعًا`,
              `Les ${fmt.integer(shown.length, lang)} premiers de ${fmt.integer(ranked.length, lang)} types`,
              `Top ${fmt.integer(shown.length, lang)} of ${fmt.integer(ranked.length, lang)} types`,
            )
      }
      icon={Layers}
    >
      {data.length === 0 ? (
        <EmptyState
          compact
          icon={Layers}
          title={tr('لا أنواع', 'Aucun type', 'No types')}
          description={tr(
            'لم يُصنَّف أي مستند بنوع بعد.',
            'Aucun document n’a encore de type.',
            'Nothing has been filed under a type yet.',
          )}
        />
      ) : (
        <BarChart data={data} orientation="horizontal" format={(value) => fmt.integer(value, lang)} />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * By confidentiality
 * ------------------------------------------------------------------ */

/**
 * How much of the library is classified, as one bar.
 *
 * A `StackedBar` rather than the horizontal `BarChart` the other two counts use, because the
 * four levels are mutually exclusive and add up to the library — which is a *mix*, and a mix
 * reads better as one bar of four bands than as four bars of unrelated length. `StackedBar`
 * brings its own legend with the count beside each band, so the card needs nothing else.
 *
 * Empty levels are dropped for the same reason the ring drops them: a zero band is zero pixels
 * wide, so all it would add is a legend row asserting nothing.
 */
function Confidentiality({ report }: Panel) {
  const { t, tr, lang } = useLocale();
  const segments: readonly BarDatum[] = report.byConfidentiality
    .filter((row) => row.count > 0)
    .map((row) => ({
      label: labelFor(CONFIDENTIALITY_LABEL, row.confidentiality, t),
      value: row.count,
      color: toneColor(CONFIDENTIALITY_TONE[row.confidentiality]),
    }));
  return (
    <Card
      title={tr('السرية', 'Confidentialité', 'Confidentiality')}
      subtitle={tr('من له حق القراءة', 'Qui a le droit de lire', 'Who is allowed to read what')}
      icon={ShieldCheck}
    >
      {segments.length === 0 ? (
        <EmptyState
          compact
          icon={ShieldCheck}
          title={tr('لا تصنيف', 'Aucun niveau', 'Nothing classified')}
          description={tr(
            'لا مستند يحمل مستوى سرية بعد.',
            'Aucun document ne porte encore de niveau.',
            'No document carries a level yet.',
          )}
        />
      ) : (
        <StackedBar segments={segments} height={14} format={(value) => fmt.integer(value, lang)} />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Activity
 * ------------------------------------------------------------------ */

/**
 * Whether the desk is keeping up, as three lines over the window.
 *
 * Uploads is what arrived, approvals is what cleared, returns is what came back for changes.
 * The reading worth having is the *gap*: uploads running above approvals for a fortnight is a
 * queue growing, and no single number on this page says that. The area under uploads is shaded
 * because `LineChart` shades its first series, and volume is the right thing to shade.
 *
 * The tones are the same three the queue's badges use, so a reader who has been looking at
 * amber "changes requested" chips all morning finds the returns line already amber.
 *
 * One point is not a trend, so a window holding a single day says so rather than drawing a
 * line with nothing to compare against.
 */
function ActivityTrend({ report }: Panel) {
  const { tr, lang } = useLocale();
  const days = report.activity.map((row) => row.day);
  const series: readonly LineSeries[] = [
    {
      label: tr('تحميلات', 'Téléversements', 'Uploads'),
      values: report.activity.map((row) => row.uploads),
      color: toneColor('accent'),
    },
    {
      label: tr('اعتمادات', 'Approbations', 'Approvals'),
      values: report.activity.map((row) => row.approvals),
      color: toneColor('success'),
    },
    {
      label: tr('إرجاعات', 'Retours', 'Returns'),
      values: report.activity.map((row) => row.returns),
      color: toneColor('warning'),
    },
  ];
  return (
    <Card
      title={tr('النشاط', 'Activité', 'Activity')}
      subtitle={tr(
        `آخر ${fmt.integer(report.windowDays, lang)} يوم`,
        `Les ${fmt.integer(report.windowDays, lang)} derniers jours`,
        `The last ${fmt.integer(report.windowDays, lang)} days`,
      )}
      icon={Activity}
    >
      {days.length < 2 ? (
        <EmptyState
          compact
          icon={Activity}
          title={tr('لا يكفي للرسم', 'Pas assez pour tracer', 'Not enough to draw')}
          description={tr(
            'يحتاج المنحنى إلى يومين على الأقل داخل النافذة.',
            'Une courbe demande au moins deux jours dans la fenêtre.',
            'A trend needs at least two days inside the window.',
          )}
        />
      ) : (
        <LineChart
          categories={axisLabels(days, lang)}
          series={series}
          height={200}
          format={(value) => fmt.integer(value, lang)}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * The tab
 * ------------------------------------------------------------------ */

export interface DmsOverviewProps {
  readonly shell: DmsShell;
}

/**
 * The dashboard tab.
 *
 * Three states, and the middle one is the reason this component exists rather than the five
 * sections being dropped straight into `App.tsx`: a report that has not arrived is *arriving*,
 * a report that resolved to nothing has not been read, and only the third state has sections
 * to draw. The distinction matters because every section below would happily render an empty
 * state off an absent report, and five of them at once reads as a workspace with no documents
 * in it — which, on a window that has been open for four hundred milliseconds, is false.
 *
 * The failure case says only that the report is missing, not why. Why is `model.dashboard.error`,
 * and `chrome.tsx`'s status bar is already showing it; repeating it here would put the same
 * sentence on screen twice.
 */
export function DmsOverview({ shell }: DmsOverviewProps) {
  const { tr } = useLocale();
  const { value, loading } = shell.model.dashboard;
  if (value === null) {
    return loading ? (
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          color: 'var(--fx-text-secondary)',
        }}
      >
        <Spinner size={18} />
        <span>{tr('يجري قراءة التقرير…', 'Lecture du rapport…', 'Reading the report…')}</span>
      </div>
    ) : (
      <EmptyState
        icon={LayoutDashboard}
        title={tr('لا تقرير', 'Aucun rapport', 'No report')}
        description={tr(
          'لم تُقرأ لوحة المستندات. أعد المحاولة من شريط الأدوات.',
          'Le tableau de bord n’a pas été lu. Réessayez depuis la barre d’outils.',
          'The dashboard was not read. Try again from the toolbar.',
        )}
      />
    );
  }
  return (
    <div style={PAGE}>
      <Totals report={value} shell={shell} />
      <div style={CARD_GRID}>
        <StatusRing report={value} />
        <TypeRanking report={value} />
      </div>
      <div style={CARD_GRID}>
        <Confidentiality report={value} />
        <ActivityTrend report={value} />
      </div>
    </div>
  );
}
