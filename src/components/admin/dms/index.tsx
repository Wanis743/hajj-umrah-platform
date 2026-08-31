/**
 * The DMS workspace: six tabs over one document record.
 *
 * The order is the life of a document rather than a menu: the dashboard says what
 * the shelf looks like, the library is the shelf, the review queue is what is
 * waiting on a person, expiry is what the calendar will decide on its own,
 * extraction is how well the machine read the pages, and evidence packages are what
 * gets handed to somebody outside.
 *
 * Each panel owns its own reads and writes, so switching tabs unmounts one and
 * remounts the other against the server. That is deliberate for a document system:
 * a cached review queue is a queue somebody else has already worked, and showing it
 * would invite a second reviewer to act on a document that has moved.
 */
import { lazy, Suspense, useState } from 'react';
import { Spinner } from '@/components/admin/ui';
import { SubTabs } from './atoms';
import { useDmsI18n } from './dmsFormat';
import { DmsDashboardPanel } from './DmsDashboardPanel';

/** Everything but the dashboard loads on demand. The library carries the upload
 *  form and the whole document-360 tree behind it, and the two analytics tabs are
 *  the widest tables in the folder -- none of it belongs in the first paint. */
const DmsLibraryPanel = lazy(() => import('./DmsLibraryPanel').then((m) => ({ default: m.DmsLibraryPanel })));
const DmsReviewQueuePanel = lazy(() => import('./DmsReviewQueuePanel').then((m) => ({ default: m.DmsReviewQueuePanel })));
const DmsExpiryPanel = lazy(() => import('./DmsExpiryPanel').then((m) => ({ default: m.DmsExpiryPanel })));
const DmsExtractionPanel = lazy(() => import('./DmsExtractionPanel').then((m) => ({ default: m.DmsExtractionPanel })));
const DmsPackagesPanel = lazy(() => import('./DmsPackagesPanel').then((m) => ({ default: m.DmsPackagesPanel })));

/** The keys DmsDashboardPanel hands back through onOpenTab. Not exported: this file
 *  exports a component, and react-refresh/only-export-components refuses a second
 *  export beside it. */
const TAB_KEYS = ['dashboard', 'library', 'review', 'expiry', 'extraction', 'packages'] as const;

type DmsTabKey = typeof TAB_KEYS[number];

function isTabKey(value: string): value is DmsTabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

export function DmsWorkspace() {
  const { t } = useDmsI18n();
  const [tab, setTab] = useState<DmsTabKey>('dashboard');

  // A dashboard tile hands back a plain string. An unrecognised one is ignored
  // rather than blanking the workspace on an empty branch.
  const open = (key: string) => { if (isTabKey(key)) setTab(key); };

  const tabs = [
    { key: 'dashboard', label: t('لوحة القيادة', 'Tableau de bord', 'Dashboard') },
    { key: 'library', label: t('المكتبة', 'Bibliothèque', 'Library') },
    { key: 'review', label: t('قائمة المراجعة', 'File de révision', 'Review queue') },
    { key: 'expiry', label: t('الانتهاء', 'Expirations', 'Expiry') },
    { key: 'extraction', label: t('الاستخراج', 'Extraction', 'Extraction') },
    { key: 'packages', label: t('حزم الأدلة', 'Dossiers de preuves', 'Evidence packages') },
  ];

  return (
    <div>
      <SubTabs tabs={tabs} active={tab} onChange={open} />
      <Suspense fallback={<Spinner className="p-10" />}>
        {tab === 'dashboard' && <DmsDashboardPanel onOpenTab={open} />}
        {tab === 'library' && <DmsLibraryPanel />}
        {tab === 'review' && <DmsReviewQueuePanel />}
        {tab === 'expiry' && <DmsExpiryPanel />}
        {tab === 'extraction' && <DmsExtractionPanel />}
        {tab === 'packages' && <DmsPackagesPanel />}
      </Suspense>
    </div>
  );
}
