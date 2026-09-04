import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, Users, CreditCard, UsersRound, Plane, Building2, Truck, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import type { NavSection, ExtendedAdminTab } from '@/components/admin/adminDashboardTypes';









interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: ExtendedAdminTab) => void;
  navSections: NavSection[];
  pilgrims: CommandSearchRecord[];
  bookings: CommandSearchRecord[];
  groups: CommandSearchRecord[];
  flights: CommandSearchRecord[];
  hotels: CommandSearchRecord[];
  suppliers: CommandSearchRecord[];
}

export interface CommandSearchRecord {
  id?: string;
  visa_status?: string;
  reference?: string;
  full_name?: string;
  passport_number?: string;
  pilgrim_name?: string;
  status?: string;
  code?: string;
  name?: string;
  group_id?: string;
  pilgrim_count?: number;
  capacity?: number;
  flight_number?: string;
  airline?: string;
  arrivalCity?: string;
  hotelName?: string;
  city?: string;
  category?: string;
}

interface ResultItem {
  key: string;
  group: string;
  label: string;
  secondary: string;
  icon: LucideIcon;
  action: () => void;
}

const GROUP_ICON: Record<string, LucideIcon> = {
  pilgrims: Users,
  bookings: CreditCard,
  groups: UsersRound,
  flights: Plane,
  hotels: Building2,
  suppliers: Truck,
};

export default function CommandPalette({
  open, onClose, onNavigate, navSections,
  pilgrims, bookings, groups, flights, hotels, suppliers,
}: CommandPaletteProps) {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);


  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activePilgrimId, setActivePilgrimId] = useState<string | null>(null);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [activeInvoiceId] = useState<string | null>(null);
  const [activeFlightId, setActiveFlightId] = useState<string | null>(null);
  const [activeHotelId, setActiveHotelId] = useState<string | null>(null);
  const [activeSupplierId, setActiveSupplierId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo<ResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    const out: ResultItem[] = [];

    if (!q) {
      navSections.forEach((section) => {
        section.items.forEach((item) => {
          const label = isAr ? item.ar : isFr ? item.fr : item.en;
          out.push({
            key: `nav-${item.id}`, group: t('Navigate', 'Naviguer', 'تنقل'),
            label, secondary: section.label,
            icon: item.icon, action: () => onNavigate(item.id as ExtendedAdminTab),
          });
        });
      });
      return out;
    }

    const match = (fields: Array<string | undefined>) =>
      fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q));

    pilgrims.forEach((p) => {
      if (match([p.full_name, p.reference, p.passport_number])) {
        out.push({
          key: `pilgrim-${p.id}`, group: t('Pilgrims', 'Pèlerins', 'الحجاج'),
          label: p.full_name || p.reference || '—',
          secondary: [p.reference, p.visa_status].filter(Boolean).join(' · '),
          icon: GROUP_ICON.pilgrims, action: () => setActivePilgrimId(p.id || null),
        });
      }
    });
    bookings.forEach((b) => {
      if (match([b.reference, b.pilgrim_name, b.full_name])) {
        out.push({
          key: `booking-${b.id}`, group: t('Bookings', 'Réservations', 'الحجوزات'),
          label: b.reference || b.id || '—', secondary: b.pilgrim_name || b.status || '',
          icon: GROUP_ICON.bookings, action: () => setActiveBookingId(b.id || null),
        });
      }
    });
    groups.forEach((g) => {
      if (match([g.code, g.name])) {
        out.push({
          key: `group-${g.group_id || g.id}`, group: t('Groups', 'Groupes', 'المجموعات'),
          label: g.code || g.name || '', secondary: `${g.pilgrim_count ?? g.capacity ?? ''} ${t('pilgrims', 'pèlerins', 'حاج')}`,
          icon: GROUP_ICON.groups, action: () => setActiveGroupId(g.group_id || g.id || null),
        });
      }
    });
    flights.forEach((f) => {
      if (match([f.flight_number, f.airline])) {
        out.push({
          key: `flight-${f.id}`, group: t('Flights', 'Vols', 'الرحلات'),
          label: f.flight_number || '', secondary: f.airline || f.arrivalCity || '',
          icon: GROUP_ICON.flights, action: () => setActiveFlightId(f.id || null),
        });
      }
    });
    hotels.forEach((h) => {
      if (match([h.hotelName, h.city])) {
        out.push({
          key: `hotel-${h.id}`, group: t('Hotels', 'Hôtels', 'الفنادق'),
          label: h.hotelName || '', secondary: h.city || '',
          icon: GROUP_ICON.hotels, action: () => setActiveHotelId(h.id || null),
        });
      }
    });
    suppliers.forEach((s) => {
      if (match([s.name, s.category])) {
        out.push({
          key: `supplier-${s.id}`, group: t('Suppliers', 'Fournisseurs', 'الموردون'),
          label: s.name || '', secondary: s.category || '',
          icon: GROUP_ICON.suppliers, action: () => setActiveSupplierId(s.id || null),
        });
      }
    });

    return out.slice(0, 24);
  }, [query, navSections, pilgrims, bookings, groups, flights, hotels, suppliers, isAr, isFr, onNavigate, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open && !activePilgrimId && !activeGroupId && !activeBookingId && !activeInvoiceId && !activeFlightId && !activeHotelId && !activeSupplierId) return null;

  const activate = (i: number) => {
    const item = results[i];
    if (item) { item.action(); onClose(); }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(activeIndex); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={t('Global search', 'Recherche globale', 'بحث شامل')} onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-md" onClick={(e) => e.stopPropagation()} dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={onKeyDown}
            placeholder={t('Search pilgrims, bookings, flights…', 'Rechercher pèlerins, réservations, vols…', 'ابحث عن الحجاج والحجوزات والرحلات…')}
            className="h-11 flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <kbd className="hidden sm:flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="empty py-10">
              <p className="title">{t('No results', 'Aucun résultat', 'لا نتائج')}</p>
              <p className="desc">{t('Nothing matched your search.', 'Rien ne correspond à votre recherche.', 'لا شيء يطابق بحثك.')}</p>
            </div>
          ) : (
            results.map((item, i) => {
              const Icon = item.icon;
              const active = i === activeIndex;
              return (
                <button
                  key={item.key}
                  onClick={() => activate(i)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center gap-3 rounded px-2.5 py-2 text-start transition-colors ${active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-hover)]'}`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${active ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--bg-subtle)]'}`}>
                    <Icon className={`h-3.5 w-3.5 ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${active ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{item.label}</span>
                    <span className="block truncate text-[11px] text-[var(--text-muted)]">{item.group}{item.secondary ? ` · ${item.secondary}` : ''}</span>
                  </span>
                  {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1">↑</kbd><kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1">↓</kbd> {t('Navigate', 'Naviguer', 'تنقل')}</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5">↵</kbd> {t('Open', 'Ouvrir', 'فتح')}</span>
          </span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5">esc</kbd> {t('Close', 'Fermer', 'إغلاق')}</span>
        </div>
      </div>
    </div>
  );
}

export type { NavSection, ExtendedAdminTab };
