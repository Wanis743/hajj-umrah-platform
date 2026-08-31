/**
 * How good the extraction actually is, measured against what reviewers decided.
 *
 * accuracy_pct is ACCEPTED over (ACCEPTED + CORRECTED + REJECTED) -- the reviewed
 * denominator, not the extracted one. A field nobody has looked at yet is null rather
 * than 0%, because "we do not know" and "it gets everything wrong" are different
 * facts and a dashboard that renders them the same way is lying about the second one.
 *
 * All three sections come from one call to get_dms_extraction_quality, so the job
 * counters, the per-field accuracy and the per-engine confidence were all computed
 * over the same window and the same rows.
 *
 * Nothing on this screen is a button. Fields are decided in the document panel, next
 * to the version they were read out of; a reviewer accepting a passport number needs
 * to be looking at the passport, not at an aggregate.
 */
import { useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { dmsAnalytics } from '@/services/dmsAnalytics';
import type { DmsExtractionQuality } from '@/types/dms';
import { Meter, Panel, Pill, Tile } from './atoms';
import {
  DASH, fmtConfidence, fmtInt, fmtPct, useDmsI18n, useDmsRead, type Tone,
} from './dmsFormat';

const WINDOWS = [7, 30, 90, 365] as const;

/** Seconds, as a duration a person reads: "8.4s", "2m 05s". Null stays null. */
function fmtSeconds(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return DASH;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.round(seconds - mins * 60);
  return `${mins}m ${String(rest).padStart(2, '0')}s`;
}

/** Accuracy as a tone. Null is neutral -- an unreviewed field has no accuracy yet. */
function accuracyTone(pct: number | null): Tone {
  if (pct === null) return 'neutral';
  if (pct >= 95) return 'good';
  if (pct >= 80) return 'warn';
  return 'bad';
}

export function DmsExtractionPanel() {
  const { t } = useDmsI18n();
  const [days, setDays] = useState<number>(30);
  const view = useDmsRead<DmsExtractionQuality>(() => dmsAnalytics.extractionQuality(days), [days]);
  const data = view.data;

  if (view.loading && data === null) return <Spinner className="p-10" />;

  const jobs = data?.jobs;
  const inFlight = jobs ? jobs.pending + jobs.processing : 0;
  const maxExtracted = Math.max(1, ...(data?.by_field ?? []).map((f) => f.extracted));

  return (
    <div className="space-y-4">
      {view.error && <ErrorBanner message={view.error} onRetry={view.reload} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--text-muted)]">
          {t(
            'الدقة تُقاس على ما راجعه إنسان، لا على ما استخرجه المحرك',
            'La précision est mesurée sur ce qu’un humain a révisé',
            'Accuracy is measured over what a human reviewed, not over what the engine produced',
          )}
        </p>
        <Select value={String(days)} className="input w-auto"
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label={t('نطاق التحليل', 'Période', 'Analysis window')}>
          {WINDOWS.map((w) => (
            <option key={w} value={w}>{t(`آخر ${w} يوم`, `${w} derniers jours`, `Last ${w} days`)}</option>
          ))}
        </Select>
      </div>

      {jobs && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Tile label={t('المهام', 'Travaux', 'Jobs')} value={fmtInt(jobs.total)} />
          <Tile label={t('مكتملة', 'Terminés', 'Completed')} value={fmtInt(jobs.completed)} tone="good" />
          <Tile label={t('فاشلة', 'Échoués', 'Failed')} value={fmtInt(jobs.failed)}
            tone={jobs.failed > 0 ? 'bad' : 'good'} />
          <Tile label={t('قيد التنفيذ', 'En cours', 'In flight')} value={fmtInt(inFlight)}
            tone={inFlight > 0 ? 'progress' : 'neutral'}
            hint={t(
              `${jobs.pending} بانتظار · ${jobs.processing} معالجة`,
              `${jobs.pending} en attente · ${jobs.processing} en cours`,
              `${jobs.pending} pending · ${jobs.processing} processing`,
            )} />
          <Tile label={t('مراجَعة', 'Révisés', 'Reviewed')} value={fmtInt(jobs.reviewed)}
            hint={t('كل حقولها محسومة', 'Tous champs décidés', 'Every field decided')} />
          <Tile label={t('متوسط الثقة', 'Confiance moyenne', 'Avg confidence')}
            value={fmtConfidence(jobs.avg_confidence)} />
          <Tile label={t('متوسط الزمن', 'Durée moyenne', 'Avg duration')}
            value={fmtSeconds(jobs.avg_seconds)}
            hint={t('من البدء إلى الانتهاء', 'Du début à la fin', 'Start to finish')} />
        </div>
      )}

      <Panel
        title={t('حسب الحقل', 'Par champ', 'By field')}
        subtitle={t(
          'الأكثر تصحيحاً أولاً — هذه هي الحقول التي يخطئ فيها المحرك',
          'Les plus corrigés d’abord — ce sont les champs que le moteur rate',
          'Most-corrected first: these are the fields the engine gets wrong',
        )}
      >
        {(data?.by_field ?? []).length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
            {t('لا حقول مستخرجة في هذه النافذة', 'Aucun champ extrait', 'No fields extracted in this window')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[900px]">
              <thead>
                <tr>
                  <th>{t('الحقل', 'Champ', 'Field')}</th>
                  <th className="end">{t('مستخرج', 'Extraits', 'Extracted')}</th>
                  <th className="end">{t('مقبول', 'Acceptés', 'Accepted')}</th>
                  <th className="end">{t('مصحّح', 'Corrigés', 'Corrected')}</th>
                  <th className="end">{t('مرفوض', 'Rejetés', 'Rejected')}</th>
                  <th className="end">{t('بانتظار', 'En attente', 'Pending')}</th>
                  <th className="end">{t('الثقة', 'Confiance', 'Confidence')}</th>
                  <th className="end">{t('الدقة', 'Précision', 'Accuracy')}</th>
                  <th>{/* meter */}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.by_field ?? []).map((f) => (
                  <tr key={f.field_key}>
                    <td className="font-mono text-[12px] text-[var(--text-primary)]">{f.field_key}</td>
                    <td className="end tabular text-end">{fmtInt(f.extracted)}</td>
                    <td className="end tabular text-end">{fmtInt(f.accepted)}</td>
                    <td className="end tabular text-end">{fmtInt(f.corrected)}</td>
                    <td className="end tabular text-end">{fmtInt(f.rejected)}</td>
                    <td className="end tabular text-end">
                      {f.pending > 0 ? <Pill tone="info">{fmtInt(f.pending)}</Pill> : fmtInt(f.pending)}
                    </td>
                    <td className="end tabular text-end">{fmtConfidence(f.avg_confidence)}</td>
                    <td className="end text-end">
                      {/* Null, not 0%: nobody has decided a field yet. */}
                      <Pill tone={accuracyTone(f.accuracy_pct)}>{fmtPct(f.accuracy_pct)}</Pill>
                    </td>
                    <td className="w-28">
                      <Meter value={f.extracted} max={maxExtracted} tone="info" label={f.field_key} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title={t('حسب المحرك', 'Par moteur', 'By engine')}
        subtitle={t(
          'نسبة الفشل مقابل متوسط الثقة لكل محرك',
          'Taux d’échec et confiance moyenne par moteur',
          'Failure rate against average confidence, per engine',
        )}
      >
        {(data?.by_engine ?? []).length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
            {t('لا مهام في هذه النافذة', 'Aucun travail', 'No jobs in this window')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[640px]">
              <thead>
                <tr>
                  <th>{t('المحرك', 'Moteur', 'Engine')}</th>
                  <th className="end">{t('المهام', 'Travaux', 'Jobs')}</th>
                  <th className="end">{t('فاشلة', 'Échoués', 'Failed')}</th>
                  <th className="end">{t('نسبة الفشل', 'Taux d’échec', 'Failure rate')}</th>
                  <th className="end">{t('متوسط الثقة', 'Confiance', 'Avg confidence')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.by_engine ?? []).map((e) => {
                  const rate = e.jobs > 0 ? Math.round((e.failed / e.jobs) * 100) : null;
                  return (
                    <tr key={e.engine}>
                      <td className="font-medium text-[var(--text-primary)]">{e.engine}</td>
                      <td className="end tabular text-end">{fmtInt(e.jobs)}</td>
                      <td className="end tabular text-end">{fmtInt(e.failed)}</td>
                      <td className="end text-end">
                        <Pill tone={rate === null ? 'neutral' : rate === 0 ? 'good' : rate < 10 ? 'warn' : 'bad'}>
                          {fmtPct(rate)}
                        </Pill>
                      </td>
                      <td className="end tabular text-end">{fmtConfidence(e.avg_confidence)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
