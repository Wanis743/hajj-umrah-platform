/**
 * Evidence packages: the records built out of documents, and whether each one still
 * describes what it was sealed over.
 *
 * `seal_matches` arrives already computed — get_dms_evidence_packages recomputes the
 * digest for every SEALED row on read, using the same private.dms_package_digest
 * that sealing used. That is deliberate and it is the reason this list can be
 * trusted: a broken seal shows up here without anybody choosing to verify it, so a
 * package cannot sit quietly wrong until an auditor asks. It is null for OPEN and
 * VOID packages, because there is nothing to match yet, and SealBadge renders
 * nothing rather than a green tick for that case.
 *
 * `drifted_documents` counts members whose current version is no longer the sealed
 * one. It is reported for every status, including OPEN — an open package that has
 * moved on from the versions it was filled with is exactly what a reviewer wants to
 * know before sealing it.
 */
import { useMemo, useState } from 'react';
import { FileSearch, Plus } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { dmsAnalytics } from '@/services/dmsAnalytics';
import { dmsCommands } from '@/services/domainCommands';
import type { DmsEvidencePackage, DmsPackageStatus } from '@/types/dms';
import { ChecksumChip, NoticeBar, Panel, Pill, SealBadge, Tile } from './atoms';
import { DmsPackageDetail } from './DmsPackageDetail';
import { PackageForm } from './DmsPackageForms';
import {
  DASH, PACKAGE_TONE, actorLabel, fmtDateTime, fmtInt, useDmsI18n, useDmsLabels, useDmsRead,
} from './dmsFormat';
import { useDmsCommand } from './useDmsCommand';

const CAPS = [25, 50, 100, 200] as const;
const STATUSES: readonly DmsPackageStatus[] = ['OPEN', 'SEALED', 'VOID'];

/**
 * One package as a row. Both the seal digest and the drift count are shown at this
 * level rather than only in the detail, because the list is where somebody scanning
 * for a problem is looking -- a broken seal that only appears once you open the
 * package is a broken seal nobody finds.
 */
function PackageRow({ pkg, open, onToggle }: {
  pkg: DmsEvidencePackage;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const toggleLabel = open ? t('إغلاق', 'Fermer', 'Close') : t('فتح', 'Ouvrir', 'Open');

  return (
    <tr className={open ? 'bg-[var(--bg-hover)]' : undefined}>
      <td>
        <p className="font-medium text-[var(--text-primary)]">{pkg.name}</p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {[pkg.reference, pkg.purpose].filter(Boolean).join(' · ') || DASH}
        </p>
      </td>
      <td>
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone={PACKAGE_TONE[pkg.status]}>{labels.packageStatus[pkg.status]}</Pill>
          {/* Null for OPEN and VOID: SealBadge renders nothing there. */}
          <SealBadge matches={pkg.seal_matches}
            label={(ok) => (ok ? t('سليم', 'Intact', 'Holds') : t('مكسور', 'Rompu', 'Broken'))} />
        </span>
      </td>
      <td className="end tabular text-end">{fmtInt(pkg.document_count)}</td>
      <td className="whitespace-nowrap text-[12px]">
        {pkg.sealed_at ? (
          <>
            <p>{fmtDateTime(pkg.sealed_at)}</p>
            <p className="font-mono text-[11px] text-[var(--text-muted)]" title={pkg.sealed_by ?? undefined}>
              {actorLabel(pkg.sealed_by)}
            </p>
          </>
        ) : DASH}
      </td>
      <td><ChecksumChip hash={pkg.seal_checksum} label={t('بصمة الختم', 'Empreinte', 'Seal digest')} /></td>
      <td className="end text-end">
        {pkg.drifted_documents > 0 ? <Pill tone="warn">{fmtInt(pkg.drifted_documents)}</Pill> : fmtInt(0)}
      </td>
      <td className="end">
        <button type="button" className="btn btn-sm" onClick={onToggle}
          aria-label={`${toggleLabel} ${pkg.name}`}>
          <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
          {toggleLabel}
        </button>
      </td>
    </tr>
  );
}

export function DmsPackagesPanel() {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const cmd = useDmsCommand();
  const [cap, setCap] = useState<number>(50);
  const [status, setStatus] = useState<DmsPackageStatus | 'ALL'>('ALL');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const view = useDmsRead<DmsEvidencePackage[]>(() => dmsAnalytics.packages(cap), [cap]);
  // Memoised for identity, not for cost: `?? []` would hand the derivations below a
  // new empty array every render and defeat their own memos.
  const rows = useMemo(() => view.data ?? [], [view.data]);

  const shown = useMemo(
    () => (status === 'ALL' ? rows : rows.filter((p) => p.status === status)),
    [rows, status],
  );

  // Read straight off the reloaded list rather than held in state, so a seal taken
  // in the detail below is reflected in the same render that refetched it.
  const selected = useMemo(
    () => rows.find((p) => p.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const counts = useMemo(() => {
    const byStatus = (s: DmsPackageStatus) => rows.filter((p) => p.status === s).length;
    return {
      total: rows.length,
      open: byStatus('OPEN'),
      sealed: byStatus('SEALED'),
      void: byStatus('VOID'),
      // false, not falsy: null means "not sealed", which is not a broken seal.
      broken: rows.filter((p) => p.seal_matches === false).length,
      drifted: rows.reduce((sum, p) => sum + p.drifted_documents, 0),
    };
  }, [rows]);
  const toggle = (s: DmsPackageStatus) => setStatus(status === s ? 'ALL' : s);

  return (
    <div className="space-y-4">
      {view.error && <ErrorBanner message={view.error} onRetry={view.reload} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t('الحزم', 'Dossiers', 'Packages')} value={fmtInt(counts.total)} />
        <Tile label={labels.packageStatus.OPEN} value={fmtInt(counts.open)} tone="info"
          onClick={() => toggle('OPEN')} />
        <Tile label={labels.packageStatus.SEALED} value={fmtInt(counts.sealed)} tone="good"
          onClick={() => toggle('SEALED')} />
        <Tile label={labels.packageStatus.VOID} value={fmtInt(counts.void)}
          onClick={() => toggle('VOID')} />
        <Tile label={t('أختام مكسورة', 'Sceaux rompus', 'Broken seals')} value={fmtInt(counts.broken)}
          tone={counts.broken > 0 ? 'bad' : 'good'}
          hint={t('البصمة لم تطابق', 'Empreinte différente', 'The digest no longer matches')} />
        <Tile label={t('وثائق متغيّرة', 'Documents dérivés', 'Drifted members')} value={fmtInt(counts.drifted)}
          tone={counts.drifted > 0 ? 'warn' : 'good'}
          hint={t('نسخة أحدث صارت الحالية', 'Une version plus récente est courante', 'A newer version became current')} />
      </div>

      {creating && (
        <PackageForm
          busy={cmd.busy}
          onCancel={() => setCreating(false)}
          onSave={(draft) => {
            void cmd.run(
              () => dmsCommands.createPackage(draft.name, {
                purpose: draft.purpose, reference: draft.reference, notes: draft.notes,
              }),
              {
                notice: t('أُنشئت الحزمة', 'Dossier créé', 'Package created'),
                onSuccess: (data) => {
                  setCreating(false);
                  // Open the new one straight away: an empty package is the start of
                  // a task, not the end of one.
                  if (data) setSelectedId(data.evidence_package_id);
                  view.reload();
                },
              },
            );
          }}
        />
      )}

      <Panel
        title={t('حزم الأدلة', 'Dossiers de preuves', 'Evidence packages')}
        subtitle={t(
          'الختم يُعاد حسابه عند كل قراءة — لا يُقرأ من عمود محفوظ',
          'Le sceau est recalculé à chaque lecture, jamais lu tel quel',
          'The seal is recomputed on every read, never taken from a stored column',
        )}
        actions={
          <>
            <Select value={status} className="input w-auto"
              onChange={(e) => setStatus(e.target.value as DmsPackageStatus | 'ALL')}
              aria-label={t('الحالة', 'Statut', 'Status')}>
              <option value="ALL">{t('كل الحالات', 'Tous les statuts', 'All statuses')}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{labels.packageStatus[s]}</option>)}
            </Select>
            <Select value={String(cap)} className="input w-auto"
              onChange={(e) => setCap(Number(e.target.value))}
              aria-label={t('عدد الصفوف', 'Nombre de lignes', 'Row cap')}>
              {CAPS.map((c) => (
                <option key={c} value={c}>{t(`${c} صف`, `${c} lignes`, `${c} rows`)}</option>
              ))}
            </Select>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('حزمة جديدة', 'Nouveau dossier', 'New package')}
            </button>
          </>
        }
      >
        {view.loading && view.data === null ? (
          <Spinner className="p-8" />
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
            {rows.length === 0
              ? t('لا حزم أدلة بعد', 'Aucun dossier de preuves', 'No evidence packages yet')
              : t('لا حزم بهذه الحالة', 'Aucun dossier dans cet état', 'No packages in that state')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[940px]">
              <thead>
                <tr>
                  <th>{t('الحزمة', 'Dossier', 'Package')}</th>
                  <th>{t('الحالة', 'État', 'Status')}</th>
                  <th className="end">{t('الوثائق', 'Documents', 'Documents')}</th>
                  <th>{t('الختم', 'Scellé le', 'Sealed')}</th>
                  <th>{t('البصمة', 'Empreinte', 'Digest')}</th>
                  <th className="end">{t('متغيّرة', 'Dérivés', 'Drift')}</th>
                  <th className="end">{/* actions */}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((pkg) => (
                  <PackageRow
                    key={pkg.id}
                    pkg={pkg}
                    open={pkg.id === selectedId}
                    onToggle={() => setSelectedId(pkg.id === selectedId ? null : pkg.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && (
        <DmsPackageDetail
          pkg={selected}
          onClose={() => setSelectedId(null)}
          onChanged={() => view.reload()}
        />
      )}
    </div>
  );
}
