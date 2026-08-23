/* eslint-disable react-refresh/only-export-components -- provider module intentionally
   exports its context hook alongside the provider component. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Route = 'home' | 'reserve' | 'admin';

interface RouterContextValue {
  route: Route;
  navigate: (r: Route) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function getRouteFromHash(): Route {
  if (window.location.pathname.startsWith('/admin')) {
    return 'admin';
  }

  const hash = window.location.hash.replace('#/', '').replace('#', '');
  if (hash === 'reserve') return 'reserve';
  if (hash === 'admin' || hash.startsWith('admin/')) return 'admin';
  
  const adminTabs = ['command_center', 'kpi_universe', 'data_insights', 'pilgrims', 'bookings', 'groups', 'visas', 'documents', 'flights', 'flight_logistics', 'hotels', 'housing', 'transport', 'hajj_ops', 'holy_sites', 'guides', 'crm', 'financials', 'ledger', 'suppliers', 'packages', 'tickets', 'incidents', 'sos', 'actions', 'alerts', 'reports', 'data_quality', 'audit', 'group_ops', 'external_ops', 'import_center', 'export_center', 'settings', 'finance_os', 'launcher'];
  if (adminTabs.includes(hash)) {
    return 'admin';
  }

  return 'home';
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(getRouteFromHash);

  useEffect(() => {
    const onHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (r: Route) => {
    if (r === 'home') {
      window.location.hash = '';
    } else {
      window.location.hash = `/${r}`;
    }
    setRoute(r);
    window.scrollTo(0, 0);
  };

  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}
