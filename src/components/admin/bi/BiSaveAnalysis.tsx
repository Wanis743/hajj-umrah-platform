/**
 * The one write that makes a report or a dashboard possible: turning the request on
 * screen into a `bi_visualizations` row.
 *
 * Until this panel existed the builder could compile, run and drill a query and then lose
 * it on unmount, and `BiReportsPanel` / `BiDashboardsPanel` could only ever arrange rows
 * the seed had put there. A saved analysis is the unit both of those screens arrange, so
 * this is the seam between exploring and publishing.
 *
 * Three decisions carry the design.
 *
 * 1. Save is gated on a matching run, not on a field check. `stale` is true when the
 *    request on screen is not the one that produced the result above it, and Save is
 *    blocked while it is. A matching signature means `bi_compile_query` has already
 *    accepted this exact request, and `trg_bi_validate_visualization` validates a save by
 *    calling that same compiler -- so a structural check here would be a second
 *    implementation of the compiler's rules, which the migration says in as many words is
 *    the thing not to build. What is left to check is what the compiler never sees: the
 *    key's shape, and a title that is not blank.
 * 2. Uniqueness is not pre-checked. `get_bi_reports` returns analyses bound to a report,
 *    so it is not a complete list of keys -- an unbound analysis is invisible to it. A
 *    collision therefore arrives as `23505` and is reported as one. A lookup that can miss
 *    is worse than no lookup, because it teaches the reader to trust it.
 * 3. What gets saved is what ran, drill filters included. `state.filters` carries the
 *    trail's own filters, so saving a drilled view saves the drilled view -- which is the
 *    useful behaviour and a surprising one, so the panel says so while a trail is open.
 */
import { useState } from 'react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { biAnalytics } from '@/services/biAnalytics';
import { biCommands } from '@/services/domainCommands';
import type { BiReport, BiStudioOverview, BiVisualizationInput } from '@/types/bi';
import { GroupLabel, InlineNote, NoticeBar, Panel, Pill } from './atoms';
import { AreaRow, FormActions, TextRow } from './BiFormFields';
import type { BuilderState } from './biBuilderState';
import { BI_KEY_SHAPE } from './biDefinitionState';
import { fmtInt, useBiChartLabels, useBiI18n, useBiLabels, useBiRead } from './biFormat';
import { useBiCommand } from './useBiCommand';

/** The five fields a save needs that the builder does not already hold. */
interface AnalysisSaveForm {
  key: string;
  title: string;
  titleAr: string;
  description: string;
  /** `''` is "in no report", which is a real and saveable choice: an analysis can sit on a
   *  dashboard without appearing in any document. */
  reportId: string;
}

const emptySaveForm = (): AnalysisSaveForm => ({
  key: '', title: '', titleAr: '', description: '', reportId: '',
});

/** Blank optional text is `null` in the row, never `''`. Two spellings of "absent" in one
 *  column means every reader downstream has to test for both. */
const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Stable empty list, so the form card is handed the same identity on every keystroke. */
const NO_REPORTS: readonly BiReport[] = [];

/**
 * What stops a save. Four members, and the shortness of the list is the point -- decision 1
 * above is what removed the rest of them.
 *
 * `NOT_THE_RUN` is the one the server would also catch. It is checked here anyway because a
 * refusal after a round trip is a poor way to learn that the chart above is not the chart
 * being saved.
 */
type SaveIssue = 'KEY_BLANK' | 'KEY_SHAPE' | 'TITLE_BLANK' | 'NOT_THE_RUN';

function saveIssues(form: AnalysisSaveForm, stale: boolean): readonly SaveIssue[] {
  const issues: SaveIssue[] = [];
  const key = form.key.trim();
  if (key === '') issues.push('KEY_BLANK');
  else if (!BI_KEY_SHAPE.test(key)) issues.push('KEY_SHAPE');
  if (form.title.trim() === '') issues.push('TITLE_BLANK');
  if (stale) issues.push('NOT_THE_RUN');
  return issues;
}

/** Each issue as the sentence a reader can act on. `KEY_SHAPE` spells the rule out rather
 *  than printing the regex, because `^[a-z][a-z0-9_]{1,60}$` is not an instruction. */
function useSaveIssueText(): (issue: SaveIssue) => string {
  const { t } = useBiI18n();
  const text: Record<SaveIssue, string> = {
    KEY_BLANK: t('المفتاح مطلوب', 'La clé est requise', 'A key is required'),
    KEY_SHAPE: t('يبدأ المفتاح بحرف صغير، ثم حروف صغيرة أو أرقام أو شرطة سفلية',
      'La clé commence par une minuscule, puis minuscules, chiffres ou tirets bas',
      'A key starts with a lowercase letter, then lowercase letters, digits or underscores'),
    TITLE_BLANK: t('العنوان مطلوب', 'Le titre est requis', 'A title is required'),
    NOT_THE_RUN: t('الطلب على الشاشة ليس الذي أنتج هذه النتيجة — شغّله مرة أخرى ثم احفظ',
      'La requête affichée n’est pas celle qui a produit ce résultat — relancez, puis enregistrez',
      'The request on screen is not the one that produced this result — run it again, then save'),
  };
  return (issue) => text[issue];
}

/**
 * The row, from the form and the state that ran.
 *
 * `measures` is the column name; the builder calls the same list `metrics`. This function is
 * the one place the two names meet, which is why the mapping lives here rather than being
 * spread across the call site.
 *
 * `options` and `sort_order` are left out so the column defaults stand. Sending `{}` and `0`
 * would be sending the defaults back, and a row that later gains a real default would
 * silently stop getting it.
 */
function visualizationInput(
  form: AnalysisSaveForm, datasetId: string, state: BuilderState,
): BiVisualizationInput {
  return {
    key: form.key.trim(),
    title: form.title.trim(),
    title_ar: orNull(form.titleAr),
    description: orNull(form.description),
    report_id: form.reportId === '' ? null : form.reportId,
    dataset_id: datasetId,
    chart_type: state.chartType,
    dimensions: state.dimensions,
    measures: state.metrics,
    filters: state.filters,
    time_grain: state.timeGrain,
    order_by: state.orderBy,
    order_desc: state.orderDesc,
    row_limit: state.limit,
  };
}

/**
 * The panel, mounted under a result that exists.
 *
 * It reads `overview()` for itself rather than having `can_save_analysis` threaded down from
 * the builder: `BiAnalysisBuilder` reads only the catalog, so threading would mean a second
 * read there and a prop through two components that need it for nothing else. The panel only
 * mounts once a run has succeeded, so the read fires once, late, and never on a screen that
 * has nothing to save.
 */
export function BiSaveAnalysis({ datasetId, state, stale }: {
  datasetId: string;
  state: BuilderState;
  stale: boolean;
}) {
  const { t } = useBiI18n();
  const cmd = useBiCommand();
  const caps = useBiRead<BiStudioOverview>(() => biAnalytics.overview(), []);
  const reports = useBiRead<BiReport[]>(() => biAnalytics.reports(), []);
  const [form, setForm] = useState<AnalysisSaveForm>(emptySaveForm);

  // The server's own answer, and `false` until it arrives -- including the moment before the
  // first read resolves, when a Save rendered on optimism would be pressable.
  const canSave = caps.data?.capabilities.can_save_analysis ?? false;
  const issues = saveIssues(form, stale);

  const save = () => {
    void cmd.run(
      () => biCommands.visualization.create(visualizationInput(form, datasetId, state)),
      {
        // Two different sentences, because the consequence differs: an analysis in no report
        // is saved and invisible until a dashboard picks it up, and saying "saved" alone
        // would let the reader believe somebody can now find it.
        notice: form.reportId === ''
          ? t('حُفظ التحليل — أضِفه إلى لوحة ليراه أحد',
            'Analyse enregistrée — ajoutez-la à un tableau de bord pour qu’elle soit vue',
            'Analysis saved — add it to a dashboard for anyone to see it')
          : t('حُفظ التحليل في التقرير المختار',
            'Analyse enregistrée dans le rapport choisi',
            'Analysis saved into the chosen report'),
        // The report binding survives the reset: several analyses commonly go into one
        // report, and re-choosing it each time is the friction that ends in the wrong one.
        onSuccess: () => {
          setForm((prev) => ({ ...emptySaveForm(), reportId: prev.reportId }));
          reports.reload();
        },
      },
    );
  };

  return (
    <Panel
      title={t('احفظ هذا التحليل', 'Enregistrer cette analyse', 'Save this analysis')}
      subtitle={t('تحليل محفوظ يمكن وضعه في تقرير أو على لوحة',
        'Une analyse enregistrée peut aller dans un rapport ou sur un tableau de bord',
        'A saved analysis can go into a report or onto a dashboard')}
    >
      {caps.loading && caps.data === null ? <Spinner className="p-6" /> : (
        <>
          {cmd.notice !== null && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}
          {cmd.error !== null && <ErrorBanner message={cmd.error} />}
          {canSave ? (
            <SaveFormCard
              form={form}
              state={state}
              reports={reports.data ?? NO_REPORTS}
              issues={issues}
              busy={cmd.busy}
              onChange={setForm}
              onSave={save}
            />
          ) : (
            <InlineNote tone="neutral">
              {t('حفظ التحليلات صلاحية منفصلة — الاستكشاف والتنقيب متاحان دون حفظ',
                'Enregistrer une analyse est un privilège distinct — explorer et forer restent possibles',
                'Saving an analysis is a separate privilege — exploring and drilling stay open to you')}
            </InlineNote>
          )}
        </>
      )}
    </Panel>
  );
}

/**
 * What is about to be saved, in the terms the row will hold.
 *
 * Save is not a blind button. The chart above shows the data; this shows the definition that
 * will be stored beside it, so a reader can see that the grain they set and the limit they
 * raised are part of what they are naming.
 */
function RequestSummary({ state }: { state: BuilderState }) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const chartLabels = useBiChartLabels();
  const dims = fmtInt(state.dimensions.length);
  const mets = fmtInt(state.metrics.length);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill tone="info">{chartLabels[state.chartType]}</Pill>
      <Pill>{t(`${dims} بُعد`, `${dims} dimension(s)`, `${dims} dimension(s)`)}</Pill>
      <Pill>{t(`${mets} مقياس`, `${mets} mesure(s)`, `${mets} measure(s)`)}</Pill>
      {state.filters.length > 0 && (
        <Pill>
          {t(`${fmtInt(state.filters.length)} مرشّح`,
            `${fmtInt(state.filters.length)} filtre(s)`,
            `${fmtInt(state.filters.length)} filter(s)`)}
        </Pill>
      )}
      {state.timeGrain !== null && <Pill>{labels.grain[state.timeGrain]}</Pill>}
      {state.orderBy !== null && (
        <Pill title={t('الترتيب', 'Tri', 'Order')}>
          <span className="font-mono" dir="ltr">
            {`${state.orderBy} ${state.orderDesc ? '↓' : '↑'}`}
          </span>
        </Pill>
      )}
      <Pill>
        {t(`حدّ ${fmtInt(state.limit)}`, `Limite ${fmtInt(state.limit)}`,
          `Limit ${fmtInt(state.limit)}`)}
      </Pill>
    </div>
  );
}

/** The blockers, named. Deliberately not `IssueList` from `BiFormFields`: that one is typed
 *  to `DefinitionIssue`, and widening it would let a definition's issues reach this list. */
function SaveIssueList({ issues }: { issues: readonly SaveIssue[] }) {
  const text = useSaveIssueText();
  if (issues.length === 0) return null;

  return (
    <ul className="space-y-1">
      {issues.map((issue) => (
        <li key={issue} className="flex items-start gap-2 text-[12px] text-[var(--danger)]">
          <span aria-hidden="true">•</span>
          <span>{text(issue)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Which report the analysis goes into, if any.
 *
 * "No report" leads the list and is the default, because it is the honest starting point: a
 * report is a document somebody assembled, and filing into one is a decision, not a
 * formality. Each option carries the report's status and how many analyses it already holds
 * -- filing a fourth analysis into a DEPRECATED report is a thing worth noticing before the
 * save, not after.
 */
function ReportChoice({ value, reports, busy, onChange }: {
  value: string;
  reports: readonly BiReport[];
  busy: boolean;
  onChange: (reportId: string) => void;
}) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const label = t('التقرير', 'Rapport', 'Report');

  return (
    <div>
      <GroupLabel>{label}</GroupLabel>
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input"
        disabled={busy}
        aria-label={label}
      >
        <option value="">{t('— بلا تقرير —', '— Aucun rapport —', '— No report —')}</option>
        {reports.map((report) => (
          <option key={report.id} value={report.id}>
            {`${(isAr && report.title_ar) ? report.title_ar : report.title}`
              + ` · ${labels.status[report.status]}`
              + ` · ${fmtInt(report.visualizations.length)}`}
          </option>
        ))}
      </Select>
      <p className="mt-1 px-1 text-[11px] text-[var(--text-muted)]">
        {t('بلا تقرير: يُحفظ التحليل ويبقى متاحاً للوحات',
          'Sans rapport : l’analyse est enregistrée et reste disponible pour les tableaux de bord',
          'With no report the analysis is still saved, and still available to dashboards')}
      </p>
    </div>
  );
}

/**
 * The fields, and the one button.
 *
 * `FormActions` is handed `onCancel: null` and `onDelete: null` on purpose. There is nothing
 * to cancel -- the panel is not a modal, and clearing a key and a title is what the fields
 * themselves are for -- and nothing to delete: this form has never saved the row it is
 * looking at. Deleting a saved analysis belongs where saved analyses are listed.
 */
function SaveFormCard({ form, state, reports, issues, busy, onChange, onSave }: {
  form: AnalysisSaveForm;
  state: BuilderState;
  reports: readonly BiReport[];
  issues: readonly SaveIssue[];
  busy: boolean;
  onChange: (form: AnalysisSaveForm) => void;
  onSave: () => void;
}) {
  const { t } = useBiI18n();
  const patch = (part: Partial<AnalysisSaveForm>) => onChange({ ...form, ...part });

  return (
    <div className="space-y-3">
      <RequestSummary state={state} />

      {state.trail.length > 0 && (
        <InlineNote tone="warn">
          {t(`سيُحفظ العرض المُنقَّب: ${fmtInt(state.trail.length)} مرشّح تنقيب يصبح جزءاً من التعريف`,
            `La vue forée sera enregistrée : ${fmtInt(state.trail.length)} filtre(s) de forage font partie de la définition`,
            `The drilled view is what gets saved: ${fmtInt(state.trail.length)} drill filter(s) become part of the definition`)}
        </InlineNote>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <TextRow
          label={t('المفتاح', 'Clé', 'Key')}
          hint={t('ثابت، وتشير إليه اللوحات', 'Stable, référencée par les tableaux de bord',
            'Stable, and referenced by dashboards')}
          value={form.key}
          onChange={(key) => patch({ key })}
          placeholder="bookings_by_month"
          code
          disabled={busy}
        />
        <TextRow
          label={t('العنوان', 'Titre', 'Title')}
          hint={t('ما يظهر فوق الرسم', 'Ce qui s’affiche au-dessus du graphique',
            'What appears above the chart')}
          value={form.title}
          onChange={(title) => patch({ title })}
          disabled={busy}
        />
        <TextRow
          label={t('العنوان بالعربية', 'Titre en arabe', 'Arabic title')}
          hint={t('اختياري', 'Optionnel', 'Optional')}
          value={form.titleAr}
          onChange={(titleAr) => patch({ titleAr })}
          disabled={busy}
        />
        <ReportChoice
          value={form.reportId}
          reports={reports}
          busy={busy}
          onChange={(reportId) => patch({ reportId })}
        />
      </div>

      <AreaRow
        label={t('الوصف', 'Description', 'Description')}
        hint={t('ما يقيسه هذا التحليل، بجملة واحدة',
          'Ce que mesure cette analyse, en une phrase',
          'What this analysis measures, in one sentence')}
        value={form.description}
        onChange={(description) => patch({ description })}
      />

      <SaveIssueList issues={issues} />
      <FormActions
        busy={busy}
        blocked={issues.length > 0}
        onSave={onSave}
        onCancel={null}
        onDelete={null}
      />
    </div>
  );
}

