/**
 * What the document is evidence of, and everything that has happened to it.
 *
 * Both are read-only by construction. An evidence package pins the version it was
 * sealed with, so membership is a historical fact rather than a live pointer; the
 * event ledger has no update policy and no delete policy at all, so it is the whole
 * history including the reads. Neither table is written from this screen -- packages
 * are built in the packages workspace, and events are written by the commands.
 */
import { useState } from 'react';
import { History } from 'lucide-react';
import type { DmsEvent, DmsPackageMembership, DmsReviewStatus } from '@/types/dms';
import { Panel, Pill } from './atoms';
import {
  DASH, PACKAGE_TONE, REVIEW_TONE, actorLabel, fmtDateTime, fmtInt,
  useDmsI18n, useDmsLabels, type Tone,
} from './dmsFormat';

/**
 * Which evidence packages hold this document. A sealed package pins the version it
 * was sealed with, so when the document has moved on since, this is where that shows
 * up: the package still hashes to what was sealed, and what was sealed is no longer
 * the current document. That is drift, and it is a fact about the package, not an
 * error in it.
 */
export function PackagesSection({ memberships, currentVersionId }: {
  memberships: DmsPackageMembership[];
  currentVersionId: string | null;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();

  return (
    <Panel
      title={t('حزم الإثبات', 'Dossiers de preuve', 'Evidence packages')}
      subtitle={t(
        'الحزمة المختومة تثبّت النسخة التي خُتمت بها',
        'Un dossier scellé fige la version scellée',
        'A sealed package pins the version it was sealed with',
      )}
    >
      {memberships.length === 0 ? (
        <p className="py-2 text-[13px] text-[var(--text-muted)]">
          {t('غير مضمّنة في أي حزمة', 'Dans aucun dossier', 'In no package')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[720px]">
            <thead>
              <tr>
                <th>{t('الحزمة', 'Dossier', 'Package')}</th>
                <th>{t('الحالة', 'Statut', 'Status')}</th>
                <th className="end">{t('الترتيب', 'Ordre', 'Order')}</th>
                <th>{t('الختم', 'Scellé', 'Sealed')}</th>
                <th>{t('النسخة المختومة', 'Version scellée', 'Sealed version')}</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((pkg) => {
                const drifted = pkg.sealed_version_id !== null
                  && currentVersionId !== null
                  && pkg.sealed_version_id !== currentVersionId;
                return (
                  <tr key={pkg.id}>
                    <td>
                      <p className="font-medium text-[var(--text-primary)]">{pkg.name}</p>
                      <p className="text-[11px] text-[var(--text-muted)] tabular">{pkg.reference ?? DASH}</p>
                    </td>
                    <td><Pill tone={PACKAGE_TONE[pkg.status]}>{labels.packageStatus[pkg.status]}</Pill></td>
                    <td className="end tabular text-end text-[12px]">{fmtInt(pkg.sequence_no)}</td>
                    <td className="whitespace-nowrap text-[12px]">{fmtDateTime(pkg.sealed_at)}</td>
                    <td className="text-[12px]">
                      {pkg.sealed_version_id === null ? DASH : (
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px]" title={pkg.sealed_version_id}>
                            {pkg.sealed_version_id.slice(0, 8)}
                          </span>
                          {drifted && (
                            <Pill tone="warn">{t('تغيّرت', 'Divergé', 'Moved on')}</Pill>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** An event's colour comes from where it landed when it moved the document through
 *  the review machine. The rest of the ledger -- uploads, links, accesses -- is not a
 *  state change and is deliberately uncoloured. */
function eventTone(event: DmsEvent): Tone {
  const to = event.to_state;
  if (to !== null && to in REVIEW_TONE) return REVIEW_TONE[to as DmsReviewStatus];
  if (event.event_type.endsWith('_FAILED') || event.event_type === 'FIELD_REJECTED') return 'bad';
  return 'neutral';
}

/**
 * The append-only ledger, newest first, exactly as get_dms_document_360 ordered it.
 * Nothing here is editable and nothing here is filtered out: dms_document_events has
 * no update or delete policy at all, so this table is the whole history of the
 * document, including the reads.
 *
 * Long histories are collapsed rather than paginated -- the interesting end of an
 * audit trail is the recent end, and the rest is one click away.
 */
export function EventLedger({ events }: { events: DmsEvent[] }) {
  const { t } = useDmsI18n();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? events : events.slice(0, 25);

  return (
    <Panel
      title={t('السجل', 'Journal', 'Event ledger')}
      subtitle={t(
        'يُضاف فقط — لا تعديل ولا حذف',
        'Ajout seul — ni modification ni suppression',
        'Append only: no update policy, no delete policy',
      )}
      actions={events.length > 25 ? (
        <button type="button" className="btn btn-sm" onClick={() => setExpanded((v) => !v)}>
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          {expanded
            ? t('إظهار الأحدث', 'Voir les récents', 'Show recent')
            : `${t('إظهار الكل', 'Tout afficher', 'Show all')} (${fmtInt(events.length)})`}
        </button>
      ) : undefined}
    >
      {events.length === 0 ? (
        <p className="py-2 text-[13px] text-[var(--text-muted)]">
          {t('لا أحداث', 'Aucun évènement', 'No events')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead>
              <tr>
                <th>{t('الحدث', 'Évènement', 'Event')}</th>
                <th>{t('الانتقال', 'Transition', 'Transition')}</th>
                <th>{t('التفصيل', 'Détail', 'Detail')}</th>
                <th>{t('الفاعل', 'Acteur', 'Actor')}</th>
                <th>{t('الوقت', 'Horodatage', 'When')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((event) => (
                <tr key={event.id}>
                  <td><Pill tone={eventTone(event)}>{event.event_type}</Pill></td>
                  <td className="whitespace-nowrap text-[12px] text-[var(--text-secondary)]">
                    {event.from_state || event.to_state
                      ? `${event.from_state ?? DASH} → ${event.to_state ?? DASH}`
                      : DASH}
                  </td>
                  <td className="text-[12px] text-[var(--text-secondary)]">
                    {event.detail ?? DASH}
                    {event.metadata && Object.keys(event.metadata).length > 0 && (
                      <details className="mt-0.5">
                        <summary className="cursor-pointer text-[11px] text-[var(--text-muted)]">
                          {t('بيانات', 'Métadonnées', 'Metadata')}
                        </summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-[var(--text-muted)]">
                          {JSON.stringify(event.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                  <td className="text-[12px]">
                    <span className="font-mono" title={event.actor_id ?? undefined}>{actorLabel(event.actor_id)}</span>
                    {event.actor_role && (
                      <p className="text-[11px] text-[var(--text-muted)]">{event.actor_role}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-[12px]">{fmtDateTime(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
