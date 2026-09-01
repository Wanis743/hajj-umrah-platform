/**
 * The studio landing screen: what is defined, what is unhealthy, and what it costs to run.
 *
 * One RPC (`get_bi_studio_overview`) composes all five sections, so the counts, the health
 * checks and the usage numbers were measured against the same rows at the same instant --
 * a tile and the table under it cannot disagree.
 *
 * Two things this screen refuses to do. It does not zero the usage section when the caller
 * may not read the query ledger: `visible: false` prints a stated refusal, because "no
 * denials in seven days" and "you may not know how many there were" are different facts.
 * And it does not infer what the caller may do from a role name -- `capabilities` is the
 * server's own answer, and every write button in this workspace is gated on it.
 *
 * The health section is the reason the screen exists. Counting definitions is vanity; a
 * dataset nobody has ever queried is a dataset nobody maintains, and it will be wrong
 * before anybody notices.
 */
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { biAnalytics } from '@/services/biAnalytics';
import type {
  BiMostQueriedDataset, BiStudioCapabilities, BiStudioCounts, BiStudioHealth,
  BiStudioOverview, BiStudioUsage,
} from '@/types/bi';
import {
  DeniedBox, GroupLabel, InlineNote, Meter, Panel, Pill, StatusPill, Tile,
} from './atoms';
import {
  fmtDateTime, fmtInt, fmtMs, useBiI18n, useBiLabels, useBiRead, type Tone,
} from './biFormat';

export function BiStudioPanel({ onOpenTab }: { onOpenTab?: (tab: string) => void }) {
  const { t } = useBiI18n();
  const { data, loading, error, reload } = useBiRead<BiStudioOverview>(
    () => biAnalytics.overview(), [],
  );

  if (loading && !data) return <Spinner className="p-10" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {data && (
        <>
          <CountsGrid counts={data.counts} onOpenTab={onOpenTab} />
          <div className="grid gap-4 lg:grid-cols-2">
            <HealthPanel health={data.health} onOpenTab={onOpenTab} />
            <UsagePanel usage={data.usage_7d} />
          </div>
          <MostQueriedPanel rows={data.most_queried} onOpenTab={onOpenTab} />
          <CapabilitiesPanel capabilities={data.capabilities} />
          <p className="px-1 text-[11px] text-[var(--text-muted)]">
            {t(`قيست هذه الأرقام في ${fmtDateTime(data.generated_at)}`,
              `Mesuré le ${fmtDateTime(data.generated_at)}`,
              `Measured at ${fmtDateTime(data.generated_at)}`)}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * What is defined, by kind.
 *
 * Each tile carries its own status split as a hint rather than getting a tile per status:
 * "41 metrics" is the useful number and "of which 12 are still drafts" is the caveat on
 * it, and splitting them into two tiles invites reading the draft count as a total.
 */
function CountsGrid({ counts, onOpenTab }: {
  counts: BiStudioCounts;
  onOpenTab?: (tab: string) => void;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const published = (n: number) => `${fmtInt(n)} ${labels.status.PUBLISHED}`;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      <Tile
        label={t('المصادر', 'Sources', 'Sources')}
        value={fmtInt(counts.sources)}
        hint={t('جداول مسموح بها', 'Tables autorisées', 'Allow-listed tables')}
        onClick={() => onOpenTab?.('datasets')}
      />
      <Tile
        label={t('مجموعات البيانات', 'Jeux de données', 'Datasets')}
        value={fmtInt(counts.datasets)}
        hint={`${published(counts.datasets_published)} · ${fmtInt(counts.datasets_draft)} ${labels.status.DRAFT} · ${fmtInt(counts.datasets_deprecated)} ${labels.status.DEPRECATED}`}
        onClick={() => onOpenTab?.('datasets')}
      />
      <Tile
        label={t('الأبعاد', 'Dimensions', 'Dimensions')}
        value={fmtInt(counts.dimensions)}
        hint={t('أعمدة التجميع', 'Colonnes de regroupement', 'Grouping columns')}
        onClick={() => onOpenTab?.('datasets')}
      />
      <Tile
        label={t('المقاييس', 'Mesures', 'Metrics')}
        value={fmtInt(counts.metrics)}
        hint={published(counts.metrics_published)}
        onClick={() => onOpenTab?.('datasets')}
      />
      <Tile
        label={t('التقارير', 'Rapports', 'Reports')}
        value={fmtInt(counts.reports)}
        onClick={() => onOpenTab?.('reports')}
      />
      <Tile
        label={t('الرسوم المحفوظة', 'Visualisations', 'Visualizations')}
        value={fmtInt(counts.visualizations)}
        onClick={() => onOpenTab?.('reports')}
      />
      <Tile
        label={t('لوحات المعلومات', 'Tableaux de bord', 'Dashboards')}
        value={fmtInt(counts.dashboards)}
        hint={published(counts.dashboards_published)}
        onClick={() => onOpenTab?.('dashboards')}
      />
    </div>
  );
}

/** One check, its count, and how bad a non-zero count is. */
interface HealthCheck {
  key: keyof BiStudioHealth;
  label: string;
  note: string;
  severe: boolean;
}

/**
 * The six states a semantic layer drifts into.
 *
 * Zero is the good reading for all six, so this is a list to clear rather than a chart to
 * compare -- there is no interesting ratio between "datasets with no metric" and "orphan
 * visualizations". `published_on_deprecated` is the severe one: `bi_set_status` can refuse
 * to deprecate a definition a dashboard depends on, but it cannot stop a dashboard from
 * being published afterwards, so this is the only check that reports a live promise made
 * over a number somebody already withdrew.
 */
function HealthPanel({ health, onOpenTab }: {
  health: BiStudioHealth;
  onOpenTab?: (tab: string) => void;
}) {
  const { t } = useBiI18n();
  const checks = useHealthChecks();
  const open = checks.filter((c) => health[c.key] > 0).length;

  return (
    <Panel
      title={t('صحة الطبقة الدلالية', 'Santé de la couche', 'Semantic layer health')}
      subtitle={t('الصفر هو القراءة السليمة في كل سطر',
        'Zéro est la bonne valeur pour chaque ligne',
        'Zero is the healthy reading on every line')}
      actions={(
        <Pill tone={open === 0 ? 'good' : 'warn'}>
          {open === 0
            ? t('لا ملاحظات', 'Aucun signalement', 'Nothing open')
            : t(`${open} من 6`, `${open} sur 6`, `${open} of 6`)}
        </Pill>
      )}
    >
      <ul className="space-y-2.5">
        {checks.map((check) => (
          <HealthRow key={check.key} check={check} count={health[check.key]} />
        ))}
      </ul>
      {health.published_on_deprecated > 0 && (
        <InlineNote tone="bad">
          {t('لوحة منشورة تقرأ تعريفاً مُهملاً — افتح الأثر لمعرفة أيّها',
            'Un tableau publié lit une définition dépréciée — voir la traçabilité',
            'A published dashboard reads a deprecated definition — open lineage to see which')}
        </InlineNote>
      )}
      {open > 0 && onOpenTab && (
        <button
          type="button"
          onClick={() => onOpenTab('lineage')}
          className="mt-3 text-[12px] font-medium text-[var(--accent)] underline underline-offset-2"
        >
          {t('افتح الأثر والتبعيات', 'Ouvrir la traçabilité', 'Open lineage and dependents')}
        </button>
      )}
    </Panel>
  );
}

/** The six checks, named. Each note says why the state is a problem rather than
 *  restating the label, because "3 datasets never queried" is only actionable next to
 *  the reason a never-queried dataset is a liability. */
function useHealthChecks(): readonly HealthCheck[] {
  const { t } = useBiI18n();
  return [
    {
      key: 'datasets_without_source',
      severe: true,
      label: t('مجموعات بلا مصدر', 'Jeux sans source', 'Datasets with no source'),
      note: t('لا يمكن تصريفها إلى استعلام',
        'Impossible à compiler en requête', 'Cannot compile into a query at all'),
    },
    {
      key: 'datasets_without_metric',
      severe: false,
      label: t('مجموعات بلا مقياس', 'Jeux sans mesure', 'Datasets with no metric'),
      note: t('أبعاد بلا رقم يُجمع', 'Des dimensions sans nombre à agréger',
        'Dimensions with nothing to aggregate'),
    },
    {
      key: 'datasets_never_queried',
      severe: false,
      label: t('لم تُستعلم مطلقاً', 'Jamais interrogés', 'Never queried'),
      note: t('ما لا يُقرأ لا يُصان', 'Ce que personne ne lit, personne ne maintient',
        'What nobody reads, nobody maintains'),
    },
    {
      key: 'datasets_stale_30d',
      severe: false,
      label: t('بلا استعلام 30 يوماً', 'Inactifs 30 jours', 'Idle for 30 days'),
      note: t('كانت مقروءة ثم توقفت', 'Lus autrefois, plus maintenant',
        'Read once, and no longer'),
    },
    {
      key: 'orphan_visualizations',
      severe: false,
      label: t('رسوم بلا لوحة', 'Visualisations orphelines', 'Orphan visualizations'),
      note: t('محفوظة ولا تظهر لأحد', 'Enregistrées et affichées nulle part',
        'Saved and shown to nobody'),
    },
    {
      key: 'published_on_deprecated',
      severe: true,
      label: t('منشور على مُهمل', 'Publié sur déprécié', 'Published on deprecated'),
      note: t('وعد قائم على رقم مسحوب', 'Une promesse sur un chiffre retiré',
        'A live promise over a withdrawn number'),
    },
  ];
}

/** One check as a line. The count carries the colour, so a healthy layer reads as six
 *  green zeros rather than as an empty panel that could also mean "not measured". */
function HealthRow({ check, count }: { check: HealthCheck; count: number }) {
  const tone: Tone = count === 0 ? 'good' : (check.severe ? 'bad' : 'warn');
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] text-[var(--text-primary)]">{check.label}</p>
        <p className="text-[11px] text-[var(--text-muted)]">{check.note}</p>
      </div>
      <Pill tone={tone}>{fmtInt(count)}</Pill>
    </li>
  );
}

/**
 * What the layer cost to run over the last seven days, when the caller may know.
 *
 * `visible: false` is the whole payload for a role without `bi_query_log.read`, and it
 * prints a refusal rather than zeros: a reader who sees "0 denied" concludes nobody was
 * refused, which is a stronger claim than the server made.
 *
 * p95 rather than an average, because the average of a hundred 20 ms dashboard tiles and
 * three 9-second table scans is a number that describes neither.
 */
function UsagePanel({ usage }: { usage: BiStudioUsage }) {
  const { t } = useBiI18n();
  const title = t('الاستخدام (7 أيام)', 'Utilisation (7 jours)', 'Usage (7 days)');

  if (!usage.visible) {
    return (
      <Panel
        title={title}
        subtitle={t('من سجل الاستعلامات', 'Depuis le journal des requêtes',
          'From the query ledger')}
      >
        <DeniedBox message={t(
          'لا تملك صلاحية قراءة سجل الاستعلامات، فلا تُعرض هذه الأرقام أصلاً',
          'Vous n’avez pas accès au journal des requêtes ; cette section n’est pas affichée',
          'You may not read the query ledger, so this section is absent rather than zeroed',
        )} />
      </Panel>
    );
  }

  const refused = usage.denied_7d + usage.errors_7d;
  return (
    <Panel
      title={title}
      subtitle={t('كل استعلام مُسجَّل، الناجح والمرفوض',
        'Chaque requête est journalisée, réussie ou refusée',
        'Every query is logged, the granted ones and the refused')}
      actions={(
        <Pill tone={refused === 0 ? 'good' : 'warn'}>
          {t(`${fmtInt(refused)} غير ناجح`, `${fmtInt(refused)} en échec`,
            `${fmtInt(refused)} not served`)}
        </Pill>
      )}
    >
      <UsageTiles usage={usage} />
    </Panel>
  );
}

/** The six usage numbers. Typed on the visible arm so a reader of this function cannot
 *  reach a field the server withheld. */
function UsageTiles({ usage }: { usage: Extract<BiStudioUsage, { visible: true }> }) {
  const { t } = useBiI18n();
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile
          label={t('استعلامات', 'Requêtes', 'Queries')}
          value={fmtInt(usage.queries_7d)}
        />
        <Tile
          label={t('مرفوضة', 'Refusées', 'Denied')}
          value={fmtInt(usage.denied_7d)}
          tone={usage.denied_7d > 0 ? 'warn' : 'good'}
          hint={t('نطاق غير مسموح', 'Portée refusée', 'Out of scope')}
        />
        <Tile
          label={t('أخطاء', 'Erreurs', 'Errors')}
          value={fmtInt(usage.errors_7d)}
          tone={usage.errors_7d > 0 ? 'bad' : 'good'}
          hint={t('تعريف مكسور', 'Définition cassée', 'A broken definition')}
        />
        <Tile
          label={t('الوسيط 95', 'p95', 'p95')}
          value={fmtMs(usage.p95_duration_ms)}
          hint={t('لا المتوسط', 'Pas la moyenne', 'Not the average')}
        />
        <Tile
          label={t('الأبطأ', 'La plus lente', 'Slowest')}
          value={fmtMs(usage.slowest_ms)}
        />
        <Tile
          label={t('مقطوعة', 'Tronquées', 'Truncated')}
          value={fmtInt(usage.truncated_7d)}
          tone={usage.truncated_7d > 0 ? 'warn' : 'good'}
          hint={t('بلغت حدّ الصفوف', 'Limite de lignes atteinte', 'Hit the row limit')}
        />
      </div>
      {usage.truncated_7d > 0 && (
        <InlineNote>
          {t('نتيجة مقطوعة تعني ترتيباً لم يكن هو الترتيب — راجع تلك الاستعلامات',
            'Un résultat tronqué donne un classement qui n’en est pas un',
            'A truncated result is a top-N that was never the top — worth reviewing those queries')}
        </InlineNote>
      )}
    </>
  );
}

/**
 * Which datasets are actually load-bearing.
 *
 * The list is the maintenance order: the dataset at the top is the one whose definition
 * being wrong costs the most, and the status pill beside it is there because a DRAFT at the
 * top of this list means readers are already depending on a number nobody promised.
 */
function MostQueriedPanel({ rows, onOpenTab }: {
  rows: readonly BiMostQueriedDataset[];
  onOpenTab?: (tab: string) => void;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const max = Math.max(1, ...rows.map((r) => r.query_count));

  return (
    <Panel
      title={t('الأكثر استعلاماً', 'Les plus interrogés', 'Most queried datasets')}
      subtitle={t('ترتيب الصيانة، لا ترتيب الشعبية',
        'L’ordre de maintenance, pas de popularité',
        'The maintenance order, not a popularity ranking')}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          {t('لم يُستعلم أي مجموعة بعد', 'Aucun jeu de données interrogé',
            'No dataset has been queried yet')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[560px]">
            <thead>
              <tr>
                <th>{t('المجموعة', 'Jeu de données', 'Dataset')}</th>
                <th>{t('الحالة', 'Statut', 'Status')}</th>
                <th className="end">{t('استعلامات', 'Requêtes', 'Queries')}</th>
                <th>{t('آخر استعلام', 'Dernière requête', 'Last queried')}</th>
                <th>{/* meter */}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.dataset_id}
                  className={onOpenTab ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : ''}
                  onClick={onOpenTab ? () => onOpenTab('datasets') : undefined}
                >
                  <td>
                    <span className="font-medium text-[var(--text-primary)]">{row.name}</span>
                    <span className="ms-2 font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
                      {row.dataset_key}
                    </span>
                  </td>
                  <td><StatusPill status={row.status} label={labels.status[row.status]} /></td>
                  <td className="end tabular">{fmtInt(row.query_count)}</td>
                  <td className="text-[12px] text-[var(--text-secondary)]">
                    {fmtDateTime(row.last_queried_at)}
                  </td>
                  <td className="w-32">
                    <Meter value={row.query_count} max={max} tone="info" label={row.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** The seven capability flags, named. `can_sync_sources` is ADMIN-only: re-measuring the
 *  allowlist against information_schema is a schema-wide act, not an authoring one. */
function useCapabilityRows(): ReadonlyArray<{ key: keyof BiStudioCapabilities; label: string }> {
  const { t } = useBiI18n();
  return [
    { key: 'can_define', label: t('تعريف المجموعات والمقاييس', 'Définir jeux et mesures', 'Define datasets and metrics') },
    { key: 'can_publish_definitions', label: t('نشر التعريفات', 'Publier les définitions', 'Publish definitions') },
    { key: 'can_save_analysis', label: t('حفظ التحليلات', 'Enregistrer des analyses', 'Save analyses') },
    { key: 'can_build_dashboards', label: t('بناء اللوحات', 'Construire des tableaux', 'Build dashboards') },
    { key: 'can_publish_dashboards', label: t('نشر اللوحات', 'Publier les tableaux', 'Publish dashboards') },
    { key: 'can_read_query_log', label: t('قراءة سجل الاستعلامات', 'Lire le journal', 'Read the query ledger') },
    { key: 'can_sync_sources', label: t('مزامنة المصادر', 'Synchroniser les sources', 'Sync sources') },
  ];
}

/**
 * What this caller may do, as the server answered it.
 *
 * Stated rather than kept internal, because a screen with no Save button and no reason for
 * its absence reads as broken. Every write control in this workspace is gated on these same
 * seven booleans, so this list is exactly what is enabled elsewhere -- and a role that may
 * read a dashboard but not publish one can see that that is by design.
 */
function CapabilitiesPanel({ capabilities }: { capabilities: BiStudioCapabilities }) {
  const { t } = useBiI18n();
  const rows = useCapabilityRows();
  const yes = t('مسموح', 'Autorisé', 'Allowed');
  const no = t('غير مسموح', 'Refusé', 'Not allowed');

  return (
    <Panel title={t('صلاحياتك هنا', 'Vos droits ici', 'What you may do here')}>
      <GroupLabel>
        {t('جواب الخادم، لا استنتاج من اسم الدور',
          'La réponse du serveur, pas une déduction du rôle',
          'The server’s answer, not an inference from a role name')}
      </GroupLabel>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
          >
            <span className="text-[13px] text-[var(--text-secondary)]">{row.label}</span>
            <Pill tone={capabilities[row.key] ? 'good' : 'neutral'}>
              {capabilities[row.key] ? yes : no}
            </Pill>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
