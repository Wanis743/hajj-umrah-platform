/**
 * The CRM workspace: one screen with eight tabs, and nothing of its own.
 *
 * Every tab is a self-contained panel that owns its reads and its writes. The
 * workspace holds only which tab is showing, which is why switching tabs never
 * loses a panel's filters -- each panel unmounts and reloads from the server
 * rather than from a cache this file would have to invalidate.
 *
 * The order is the lifecycle: a lead becomes a customer, a customer carries
 * opportunities, an opportunity is quoted, a quote is accepted and becomes a
 * booking, and the last two tabs are what all of that returned. Dashboard tiles
 * link into the tab that explains them, so a counter is never a dead end.
 */
import { lazy, Suspense, useState } from 'react';
import { Spinner } from '@/components/admin/ui';
import { SubTabs } from './atoms';
import { useCrmI18n } from './crmFormat';
import { CrmDashboardPanel } from './CrmDashboardPanel';

/** The two analytics-heavy tabs load on demand: neither is on the first paint,
 *  and the ROI and profitability tables are the widest code in the folder. */
const CrmCampaignsPanel = lazy(() => import('./CrmCampaignsPanel').then((m) => ({ default: m.CrmCampaignsPanel })));
const CrmProfitabilityPanel = lazy(() => import('./CrmProfitabilityPanel').then((m) => ({ default: m.CrmProfitabilityPanel })));
const CrmCustomersPanel = lazy(() => import('./CrmCustomersPanel').then((m) => ({ default: m.CrmCustomersPanel })));
const CrmFollowupsPanel = lazy(() => import('./CrmFollowupsPanel').then((m) => ({ default: m.CrmFollowupsPanel })));
const CrmLeadsPanel = lazy(() => import('./CrmLeadsPanel').then((m) => ({ default: m.CrmLeadsPanel })));
const CrmPipelinePanel = lazy(() => import('./CrmPipelinePanel').then((m) => ({ default: m.CrmPipelinePanel })));
const CrmQuotesPanel = lazy(() => import('./CrmQuotesPanel').then((m) => ({ default: m.CrmQuotesPanel })));

/** The tab keys CrmDashboardPanel hands back through onOpenTab. Not exported:
 *  this file exports a component, and react-refresh/only-export-components
 *  refuses a second export beside it. */
const TAB_KEYS = [
  'dashboard', 'leads', 'pipeline', 'quotes', 'customers', 'followups', 'campaigns', 'profitability',
] as const;

type CrmTabKey = typeof TAB_KEYS[number];

function isTabKey(value: string): value is CrmTabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

export function CrmWorkspace() {
  const { t } = useCrmI18n();
  const [tab, setTab] = useState<CrmTabKey>('dashboard');

  // A dashboard tile hands back a plain string. An unrecognised one is ignored
  // rather than blanking the workspace on an empty branch.
  const open = (key: string) => { if (isTabKey(key)) setTab(key); };

  const tabs = [
    { key: 'dashboard', label: t('لوحة القيادة', 'Tableau de bord', 'Dashboard') },
    { key: 'leads', label: t('العملاء المحتملون', 'Prospects', 'Leads') },
    { key: 'pipeline', label: t('خط الأنابيب', 'Pipeline', 'Pipeline') },
    { key: 'quotes', label: t('العروض', 'Devis', 'Quotes') },
    { key: 'customers', label: t('العملاء', 'Clients', 'Customers') },
    { key: 'followups', label: t('المتابعات', 'Relances', 'Follow-ups') },
    { key: 'campaigns', label: t('الحملات', 'Campagnes', 'Campaigns') },
    { key: 'profitability', label: t('الربحية', 'Rentabilité', 'Profitability') },
  ];

  return (
    <div>
      <SubTabs tabs={tabs} active={tab} onChange={open} />
      <Suspense fallback={<Spinner className="p-10" />}>
        {tab === 'dashboard' && <CrmDashboardPanel onOpenTab={open} />}
        {tab === 'leads' && <CrmLeadsPanel />}
        {tab === 'pipeline' && <CrmPipelinePanel />}
        {tab === 'quotes' && <CrmQuotesPanel />}
        {tab === 'customers' && <CrmCustomersPanel />}
        {tab === 'followups' && <CrmFollowupsPanel />}
        {tab === 'campaigns' && <CrmCampaignsPanel />}
        {tab === 'profitability' && <CrmProfitabilityPanel />}
      </Suspense>
    </div>
  );
}

