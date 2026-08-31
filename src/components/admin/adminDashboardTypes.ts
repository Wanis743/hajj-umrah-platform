export type ExtendedAdminTab =
  | 'command_center' | 'kpi_universe' | 'data_insights'
  | 'pilgrims' | 'bookings' | 'groups' | 'visas' | 'documents'
  | 'flights' | 'flight_logistics' | 'hotels' | 'housing' | 'transport' | 'hajj_ops' | 'holy_sites' | 'guides'
  | 'crm' | 'financials' | 'ledger' | 'suppliers' | 'packages'
  | 'tickets' | 'incidents' | 'sos' | 'actions'
  | 'alerts' | 'reports' | 'data_quality' | 'audit' | 'settings'
  | 'dms'
  | 'group_ops' | 'external_ops' | 'import_center' | 'export_center' | 'finance_os' | 'operations_os' | 'launcher';

export type NavItem = {
  id: ExtendedAdminTab;
  ar: string;
  fr: string;
  en: string;
  icon: import('lucide-react').LucideIcon;
  /** Short helper line shown in tooltips / command palette */
  descAr?: string;
  descFr?: string;
  descEn?: string;
  badge?: string;
  badgeRed?: boolean;
  /** Extra search keywords for the rail filter + command palette */
  keywords?: string[];
};

export type NavSection = {
  /** Stable id used for collapse persistence */
  id: string;
  label: string;
  icon?: import('lucide-react').LucideIcon;
  items: NavItem[];
};
