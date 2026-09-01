/**
 * The two ledgers, read.
 *
 * `bi_query_log` and `bi_events` are gated on separate permissions -- `bi_query_log.read`
 * and `bi_events.read` -- so the two halves of this screen are two independent reads with
 * two independent refusals. A role allowed to see which definitions were published is not
 * thereby entitled to see who was refused a query, and one section saying "not permitted"
 * while the other lists rows is a true picture rather than a broken page.
 *
 * The query ledger prints `compiled_sql`, which is the whole reason that column is kept:
 * "why does this chart say 412" has exactly one honest answer, and it is the text that ran.
 *
 * Nothing here writes. Reading the ledger does not add a row to it -- only running a query
 * does, which is why the builder's Run button is a command and this screen is not.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, History, ScrollText } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { biAnalytics } from '@/services/biAnalytics';
import {
  BI_QUERY_OUTCOMES, type BiEntityKind, type BiEventRow, type BiLoggedRequest,
  type BiQueryLogRow, type BiQueryOutcome, type BiStatus,
} from '@/types/bi';
import { GroupLabel, InlineNote, Panel, Pill, SqlBlock, StatusPill } from './atoms';
import {
  OUTCOME_TONE, actorLabel, filterText, fmtDateTime, fmtInt, fmtMs, useBiI18n, useBiLabels,
  useBiRead,
} from './biFormat';

/** One shared empty array per ledger, so an unloaded payload does not hand the derived
 *  values a fresh identity on every render. */
const NO_QUERIES: readonly BiQueryLogRow[] = [];
const NO_EVENTS: readonly BiEventRow[] = [];

/** What either ledger may be asked for. Both functions clamp to 1..1000 whatever they are
 *  sent, so the largest choice here is the largest answer that exists. */
const LIMITS: readonly number[] = [50, 100, 250, 500, 1000];

const ENTITY_KINDS: readonly BiEntityKind[] = [
  'DATASET', 'DIMENSION', 'METRIC', 'REPORT', 'VISUALIZATION', 'DASHBOARD', 'SOURCE',
];

/**
 * The row limit the compiler applied, which is not always the number the ledger stored.
 *
 * `bi_query_log.request` holds the caller's own `limit`, possibly null, because the row is
 * written before the clamp happens. Re-applying the compiler's own
 * `least(greatest(coalesce(limit, 500), 1), 5000)` is what lets this screen's truncation
 * mark agree with the overview's `truncated_7d`, which counts rows against that expression.
 */
function effectiveLimit(limit: number | null): number {
  return Math.min(Math.max(limit ?? 500, 1), 5000);
}

/** A result that stopped at the limit rather than at the end of the data. Every value in
 *  such an answer is true and the shape of it is not, which is why it is said out loud. */
function wasTruncated(row: BiQueryLogRow): boolean {
  return row.outcome === 'OK' && row.row_count >= effectiveLimit(row.request.limit);
}

export function BiQueryLogPanel() {
  return (
    <div className="space-y-4">
      <QueryLedger />
      <DefinitionLedger />
    </div>
  );
}

/**
 * Every attempt, including the refused ones.
 *
 * The outcome filter is applied by the server rather than by this component. DENIED is the
 * interesting case and also the rarest, so filtering a hundred fetched rows in the browser
 * would usually show nothing while the ledger held plenty.
 */
function QueryLedger() {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const [outcome, setOutcome] = useState<BiQueryOutcome | null>(null);
  const [limit, setLimit] = useState(100);
  const { data, loading, error, reload } = useBiRead<BiQueryLogRow[]>(
    () => biAnalytics.queryLog(limit, outcome), [limit, outcome],
  );

  const rows = data ?? NO_QUERIES;
  const truncated = useMemo(() => rows.filter(wasTruncated).length, [rows]);

  const byOutcome = useMemo(
    () => BI_QUERY_OUTCOMES.map((o) => ({ outcome: o, count: rows.filter((r) => r.outcome === o).length })),
    [rows],
  );

  return (
    <Panel
      title={t('سجل الاستعلامات', 'Journal des requêtes', 'Query ledger')}
      subtitle={t('كل محاولة، بما فيها المرفوضة، والنص الذي نُفِّذ',
        'Chaque tentative, refus compris, et le texte exécuté',
        'Every attempt, refusals included, and the text that ran')}
      actions={
        <Pill tone="neutral">
          <ScrollText className="me-1 inline h-3 w-3" aria-hidden="true" />
          {fmtInt(rows.length)}
        </Pill>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:max-w-xl">
        <div>
          <GroupLabel>{t('النتيجة', 'Résultat', 'Outcome')}</GroupLabel>
          <Select
            value={outcome ?? ''}
            onChange={(e) => setOutcome(e.target.value === '' ? null : e.target.value as BiQueryOutcome)}
            className="input"
            aria-label={t('النتيجة', 'Résultat', 'Outcome')}
          >
            <option value="">{t('الكل', 'Tous', 'All')}</option>
            {BI_QUERY_OUTCOMES.map((value) => (
              <option key={value} value={value}>{labels.outcome[value]}</option>
            ))}
          </Select>
        </div>
        <div>
          <GroupLabel>{t('كم صفًا', 'Combien de lignes', 'How many')}</GroupLabel>
          <Select
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="input"
            aria-label={t('كم صفًا', 'Combien de lignes', 'How many')}
          >
            {LIMITS.map((n) => <option key={n} value={String(n)}>{fmtInt(n)}</option>)}
          </Select>
        </div>
      </div>

      {error !== null && (
        <div className="mt-3"><ErrorBanner message={error} onRetry={reload} /></div>
      )}
      {loading && data === null && <Spinner className="py-10" />}
      {data !== null && rows.length === 0 && (
        <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا محاولة مسجَّلة بهذا الوصف',
            'Aucune tentative enregistrée sous ce filtre',
            'No attempt recorded under this filter')}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
            {byOutcome.map(({ outcome: value, count }) => (
              <span key={value} className="tabular">
                {`${labels.outcome[value]} ${fmtInt(count)}`}
              </span>
            ))}
            {truncated > 0 && (
              <Pill tone="warn">
                {t(`${fmtInt(truncated)} مقتطعة عند الحد`,
                  `${fmtInt(truncated)} coupées à la limite`,
                  `${fmtInt(truncated)} cut at the limit`)}
              </Pill>
            )}
            <span>
              {t('محسوبة على الصفوف المعروضة فقط', 'comptées sur les lignes affichées seulement',
                'counted over the rows shown only')}
            </span>
          </p>
          <ul className="mt-2 space-y-2">
            {rows.map((row) => <li key={row.id}><LogRow row={row} /></li>)}
          </ul>
        </>
      )}
    </Panel>
  );
}

/**
 * One attempt, closed and opened.
 *
 * Closed it answers "what happened": the outcome, the dataset, who asked, how long it took,
 * how much came back. Opened it answers "what exactly was asked, and what exactly ran" --
 * the pair a disputed number is settled with.
 */
function LogRow({ row }: { row: BiQueryLogRow }) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const [open, setOpen] = useState(false);
  const bodyId = `bi-query-log-${row.id}`;
  const dataset = row.dataset_name ?? row.dataset_key
    ?? t('مجموعة محذوفة', 'Jeu supprimé', 'Deleted dataset');

  return (
    <div className="rounded-lg border border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full flex-col items-start gap-1 p-2.5 text-start hover:bg-[var(--bg-hover)]"
      >
        <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
          {open
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />}
          <Pill tone={OUTCOME_TONE[row.outcome]}>{labels.outcome[row.outcome]}</Pill>
          <span className="text-[13px] text-[var(--text-primary)]">{dataset}</span>
          {row.dataset_key !== null && (
            <span className="font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
              {row.dataset_key}
            </span>
          )}
          {row.visualization_title !== null && (
            <Pill tone="info">{row.visualization_title}</Pill>
          )}
          {wasTruncated(row) && (
            <Pill tone="warn">{t('مقتطع عند الحد', 'Coupé à la limite', 'Cut at the limit')}</Pill>
          )}
        </span>
        <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
          <span className="tabular">{fmtDateTime(row.created_at)}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono" dir="ltr" title={row.actor_id ?? undefined}>
            {actorLabel(row.actor_id)}
          </span>
          {row.actor_role !== null && <span>{row.actor_role}</span>}
          {row.is_mine && <Pill tone="neutral">{t('أنت', 'Vous', 'You')}</Pill>}
          <span aria-hidden="true">·</span>
          <span className="tabular">{fmtMs(row.duration_ms)}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">
            {t(`${fmtInt(row.row_count)} صف × ${fmtInt(row.column_count)} عمود`,
              `${fmtInt(row.row_count)} lignes × ${fmtInt(row.column_count)} colonnes`,
              `${fmtInt(row.row_count)} rows × ${fmtInt(row.column_count)} cols`)}
          </span>
          {row.error_code !== null && <span className="font-mono" dir="ltr">{row.error_code}</span>}
        </span>
      </button>
      {open && (
        <div id={bodyId} className="space-y-2 border-t border-[var(--border)] p-2.5">
          <RequestSummary request={row.request} />
          {row.error_message !== null && <InlineNote tone="bad">{row.error_message}</InlineNote>}
          <SqlBlock sql={row.compiled_sql} copyLabel={t('انسخ', 'Copier', 'Copy')} />
        </div>
      )}
    </div>
  );
}

/** One asked-for thing, or the fact that it was not asked for. An empty shelf prints a
 *  word rather than nothing, so "no metric" is distinguishable from "not recorded". */
function Asked({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-[var(--text-secondary)]">{children}</dd>
    </div>
  );
}

/**
 * What was asked for, as the ledger stored it.
 *
 * Keys rather than display names, deliberately: the ledger holds keys, the statement below
 * names the same keys, and resolving them to today's display names would label a row with
 * a definition that may have been renamed since it was written.
 *
 * The row limit is shown twice when the two differ, because the caller's number and the
 * number the compiler used are different facts and the second is the one that cut the tail.
 */
function RequestSummary({ request }: { request: BiLoggedRequest }) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const applied = effectiveLimit(request.limit);
  const none = t('لا شيء', 'Aucun', 'None');

  return (
    <dl className="grid gap-2 text-[11px] sm:grid-cols-2">
      <Asked label={t('الأبعاد', 'Dimensions', 'Dimensions')}>
        <span className="font-mono" dir="ltr">
          {request.dimensions.length === 0 ? none : request.dimensions.join(', ')}
        </span>
      </Asked>
      <Asked label={t('المقاييس', 'Mesures', 'Metrics')}>
        <span className="font-mono" dir="ltr">
          {request.metrics.length === 0 ? none : request.metrics.join(', ')}
        </span>
      </Asked>
      <Asked label={t('الحبيبة الزمنية', 'Granularité', 'Time grain')}>
        {request.time_grain === null ? none : labels.grain[request.time_grain]}
      </Asked>
      <Asked label={t('الترتيب', 'Tri', 'Order by')}>
        {request.order_by === null ? none : (
          <span className="font-mono" dir="ltr">
            {`${request.order_by} ${request.order_desc ? '↓' : '↑'}`}
          </span>
        )}
      </Asked>
      <Asked label={t('حد الصفوف', 'Limite de lignes', 'Row limit')}>
        <span className="tabular">
          {request.limit === null
            ? t(`${fmtInt(applied)} (افتراضي)`, `${fmtInt(applied)} (par défaut)`,
              `${fmtInt(applied)} (default)`)
            : (request.limit === applied
              ? fmtInt(applied)
              : `${fmtInt(request.limit)} → ${fmtInt(applied)}`)}
        </span>
      </Asked>
      <Asked label={t('تحليل محفوظ', 'Analyse enregistrée', 'Saved analysis')}>
        {request.visualization_id === null
          ? t('استعلام مؤقت', 'Requête ad hoc', 'Ad-hoc query')
          : t('نعم', 'Oui', 'Yes')}
      </Asked>
      <div className="sm:col-span-2">
        <dt className="uppercase tracking-wide text-[var(--text-muted)]">
          {t('المرشِّحات', 'Filtres', 'Filters')}
        </dt>
        <dd className="mt-0.5 text-[var(--text-secondary)]">
          {request.filters.length === 0 ? none : (
            <span className="flex flex-wrap gap-1">
              {request.filters.map((filter, index) => (
                <Pill key={`${index}:${filterText(filter)}`} tone="neutral">
                  {filterText(filter)}
                </Pill>
              ))}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** The seven kinds the event ledger records. `bi_events.entity_kind` has no check
 *  constraint, so a value outside this list is still rendered -- as itself, by `EventRow`. */
function useEntityKindLabels(): Record<BiEntityKind, string> {
  const { t } = useBiI18n();
  return {
    DATASET: t('مجموعة', 'Jeu', 'Dataset'),
    DIMENSION: t('بعد', 'Dimension', 'Dimension'),
    METRIC: t('مقياس', 'Mesure', 'Metric'),
    REPORT: t('تقرير', 'Rapport', 'Report'),
    VISUALIZATION: t('تحليل', 'Analyse', 'Analysis'),
    DASHBOARD: t('لوحة', 'Tableau', 'Dashboard'),
    SOURCE: t('مصدر', 'Source', 'Source'),
  };
}

/**
 * Every status transition, with who and when.
 *
 * Gated on `bi_events.read`, which is not the permission the ledger above needs. This
 * section listing rows while that one is refused -- or the reverse -- is a correct picture
 * of two grants, not a half-loaded screen.
 *
 * `entity_id` is printed as its first segment rather than resolved to a name: a deprecated
 * definition may since have been renamed, and the ledger's job is to say what happened to
 * the row that existed then.
 */
function DefinitionLedger() {
  const { t } = useBiI18n();
  const kindLabels = useEntityKindLabels();
  const [kind, setKind] = useState<BiEntityKind | null>(null);
  const [limit, setLimit] = useState(100);
  const { data, loading, error, reload } = useBiRead<BiEventRow[]>(
    () => biAnalytics.events(kind, null, limit), [kind, limit],
  );

  const rows = data ?? NO_EVENTS;

  return (
    <Panel
      title={t('سجل التعريفات', 'Journal des définitions', 'Definition history')}
      subtitle={t('كل انتقال حالة، ومن أجراه، ومتى',
        'Chaque transition de statut, par qui, et quand',
        'Every status transition, by whom, and when')}
      actions={
        <Pill tone="neutral">
          <History className="me-1 inline h-3 w-3" aria-hidden="true" />
          {fmtInt(rows.length)}
        </Pill>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:max-w-xl">
        <div>
          <GroupLabel>{t('النوع', 'Type', 'Kind')}</GroupLabel>
          <Select
            value={kind ?? ''}
            onChange={(e) => setKind(e.target.value === '' ? null : e.target.value as BiEntityKind)}
            className="input"
            aria-label={t('النوع', 'Type', 'Kind')}
          >
            <option value="">{t('الكل', 'Tous', 'All')}</option>
            {ENTITY_KINDS.map((value) => (
              <option key={value} value={value}>{kindLabels[value]}</option>
            ))}
          </Select>
        </div>
        <div>
          <GroupLabel>{t('كم صفًا', 'Combien de lignes', 'How many')}</GroupLabel>
          <Select
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="input"
            aria-label={t('كم صفًا', 'Combien de lignes', 'How many')}
          >
            {LIMITS.map((n) => <option key={n} value={String(n)}>{fmtInt(n)}</option>)}
          </Select>
        </div>
      </div>

      {error !== null && (
        <div className="mt-3"><ErrorBanner message={error} onRetry={reload} /></div>
      )}
      {loading && data === null && <Spinner className="py-10" />}
      {data !== null && rows.length === 0 && (
        <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا انتقال مسجَّل بهذا الوصف', 'Aucune transition sous ce filtre',
            'No transition recorded under this filter')}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((event) => (
            <li key={event.id}>
              <EventRow event={event} kindLabels={kindLabels} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One transition.
 *
 * `from` and `to` are read into typed locals rather than used from the payload directly:
 * `payload` is an index signature intersected with these three names, so the property type
 * that comes out of it has already lost the `undefined` that makes an absent transition
 * distinguishable from a status of DRAFT.
 *
 * A `note` is printed whenever there is one. The reason a definition was deprecated is
 * worth more six months later than the fact that it was.
 */
function EventRow({ event, kindLabels }: {
  event: BiEventRow;
  kindLabels: Record<BiEntityKind, string>;
}) {
  const labels = useBiLabels();
  const from: BiStatus | undefined = event.payload.from;
  const to: BiStatus | undefined = event.payload.to;
  const note: string | null | undefined = event.payload.note;

  return (
    <div className="rounded-lg border border-[var(--border)] p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Pill tone="neutral">{kindLabels[event.entity_kind] ?? event.entity_kind}</Pill>
        {from !== undefined && <StatusPill status={from} label={labels.status[from]} />}
        {from !== undefined && to !== undefined && (
          <ArrowRight className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
        )}
        {to !== undefined && <StatusPill status={to} label={labels.status[to]} />}
        <span className="font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
          {event.event_type}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span className="tabular">{fmtDateTime(event.created_at)}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono" dir="ltr" title={event.actor_id ?? undefined}>
          {actorLabel(event.actor_id)}
        </span>
        {event.actor_role !== null && <span>{event.actor_role}</span>}
        <span aria-hidden="true">·</span>
        <span className="font-mono" dir="ltr" title={event.entity_id}>
          {actorLabel(event.entity_id)}
        </span>
      </div>
      {note !== undefined && note !== null && note !== '' && (
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{note}</p>
      )}
    </div>
  );
}
