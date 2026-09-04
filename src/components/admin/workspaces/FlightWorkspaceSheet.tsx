import React, { useEffect, useState } from 'react';
import { SideSheet } from './SideSheet';
import { Plane, MapPin, Clock } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import { FlightRow } from '@/types/database';

export function FlightWorkspaceSheet({ flightId, onClose }: { flightId: string | null, onClose: () => void }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => isAr ? ar : isFr ? fr : en;

  const [flight, setFlight] = useState<FlightRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!flightId) {
      setFlight(null);
      return;
    }
    let active = true;
    const fetchFlight = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.from('flights').select('*').eq('id', flightId).single();
      if (!active) return;
      if (error) {
        setError(error.message);
      } else {
        setFlight(data as unknown as FlightRow);
      }
      setLoading(false);
    };
    fetchFlight();
    return () => { active = false; };
  }, [flightId]);

  return (
    <SideSheet isOpen={!!flightId} onClose={onClose} title={t('تفاصيل الرحلة', 'Détails du vol', 'Flight Details')} width="max-w-3xl">
      <div className="p-4 space-y-6">
        {loading && <div className="text-center p-4 text-[var(--text-muted)]">{t('جاري التحميل...', 'Chargement...', 'Loading...')}</div>}
        {error && <div className="p-4 bg-red-50 text-red-600 rounded-lg">{error}</div>}
        
        {flight && !loading && (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Plane className="h-6 w-6 text-brand-500" />
                  {flight.carrier || t('ناقل غير معروف', 'Transporteur inconnu', 'Unknown Carrier')} - {flight.flight_number || 'N/A'}
                </h2>
                <div className="mt-1 flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${flight.status === 'SCHEDULED' ? 'bg-blue-100 text-blue-700' : flight.status === 'DELAYED' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {flight.status || 'UNKNOWN'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <div className="flex items-center gap-2 text-brand-600 mb-2 font-medium">
                  <MapPin className="w-4 h-4" /> {t('المسار', 'Itinéraire', 'Route')}
                </div>
                <div className="space-y-2 text-sm text-[var(--text-secondary)]">
                  <div className="flex justify-between">
                    <span>{t('المغادرة', 'Départ', 'Departure')}:</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{flight.departure_airport || 'TBD'} (T {flight.terminal || '-'})</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('الوصول', 'Arrivée', 'Arrival')}:</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{flight.arrival_airport || 'TBD'} (G {flight.gate || '-'})</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <div className="flex items-center gap-2 text-brand-600 mb-2 font-medium">
                  <Clock className="w-4 h-4" /> {t('التوقيت', 'Horaire', 'Timing')}
                </div>
                <div className="space-y-2 text-sm text-[var(--text-secondary)]">
                  <div className="flex justify-between">
                    <span>{t('المجدول', 'Prévu', 'Scheduled')}:</span>
                    <span className="text-slate-900 dark:text-slate-100">{flight.scheduled_departure ? new Date(flight.scheduled_departure).toLocaleString() : 'TBD'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('الفعلي', 'Réel', 'Actual')}:</span>
                    <span className="text-slate-900 dark:text-slate-100">{flight.actual_departure ? new Date(flight.actual_departure).toLocaleString() : 'TBD'}</span>
                  </div>
                </div>
              </div>
            </div>

            
          </>
        )}
      </div>
    </SideSheet>
  );
}
