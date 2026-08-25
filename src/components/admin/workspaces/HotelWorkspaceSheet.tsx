import React, { useEffect, useState } from 'react';
import { SideSheet } from './SideSheet';
import { Building2, MapPin, Star, Phone } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';

type HotelRow = {
  id: string;
  name?: string;
  name_ar?: string;
  city?: string;
  star_rating?: number;
  distance_to_haram_m?: number;
  manager_contact?: string;
  total_rooms?: number | string;
  available_rooms?: number | string;
  rate_sar?: number | string;
};

export function HotelWorkspaceSheet({ hotelId, onClose }: { hotelId: string | null, onClose: () => void }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => isAr ? ar : isFr ? fr : en;

  const [hotel, setHotel] = useState<HotelRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hotelId) {
      setHotel(null);
      return;
    }
    let active = true;
    const fetchHotel = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.from('hotels').select('*').eq('id', hotelId).single();
      if (!active) return;
      if (error) {
        setError(error.message);
      } else {
        setHotel(data as unknown as HotelRow);
      }
      setLoading(false);
    };
    fetchHotel();
    return () => { active = false; };
  }, [hotelId]);

  return (
    <SideSheet isOpen={!!hotelId} onClose={onClose} title={t('مساحة عمل الفندق', 'Espace Hôtel', 'Hotel Workspace')} width="max-w-3xl">
      <div className="p-4 space-y-6">
        {loading && <div className="text-center p-4 text-[var(--text-muted)]">{t('جاري التحميل...', 'Chargement...', 'Loading...')}</div>}
        {error && <div className="p-4 bg-red-50 text-red-600 rounded-lg">{error}</div>}
        
        {hotel && !loading && (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Building2 className="h-6 w-6 text-brand-500" />
                  {isAr && hotel.name_ar ? hotel.name_ar : hotel.name || 'Unknown Hotel'}
                </h2>
                <div className="mt-1 flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {hotel.city || 'N/A'} ({hotel.distance_to_haram_m || '?'}m)</span>
                  <span className="flex items-center gap-1 text-amber-500"><Star className="w-3.5 h-3.5 fill-current" /> {hotel.star_rating || '?'}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex flex-col justify-center items-center">
                <span className="text-3xl font-bold text-slate-900 dark:text-white">
                  {hotel.available_rooms || 0} / {hotel.total_rooms || 0}
                </span>
                <span className="text-sm text-[var(--text-secondary)]">{t('الغرف المتاحة', 'Chambres Dispo', 'Available Rooms')}</span>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <div className="flex items-center gap-2 text-brand-600 mb-2 font-medium">
                  <Phone className="w-4 h-4" /> {t('معلومات الاتصال', 'Contact', 'Contact Info')}
                </div>
                <div className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <p>{hotel.manager_contact || t('لا يوجد', 'Aucun', 'None')}</p>
                  <p className="text-[var(--text-muted)] text-xs">{t('السعر', 'Tarif', 'Rate')}: {hotel.rate_sar || '?'} SAR</p>
                </div>
              </div>
            </div>

            
          </>
        )}
      </div>
    </SideSheet>
  );
}
