import { reportError } from '@/lib/logger';
import Select from '@/components/admin/GlassSelect';
import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import type { Reservation } from '@/components/admin/ReservationDetailPanel';
import GlassDate from '@/components/admin/GlassDate';

interface NewReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: (newRes: Reservation) => void;
}

export default function NewReservationModal({ isOpen, onClose, onAdded }: NewReservationModalProps) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email] = useState('');
  const [packageId, setPackageId] = useState('');
  const [packageName, setPackageName] = useState('');
  const [packages, setPackages] = useState<Array<{ id: string; name: string }>>([]);
  const [travelers, setTravelers] = useState(1);
  const defaultStart = new Date().toISOString().slice(0, 10);
  const defaultEnd = new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    supabase.rpc('get_public_packages').then(({ data, error }) => {
      if (!mounted || error) return;
      const rows = (data || []) as Array<{ id: string; name: string }>;
      setPackages(rows);
      if (!packageId && rows[0]) {
        setPackageId(rows[0].id);
        setPackageName(rows[0].name);
      }
    });
    return () => { mounted = false; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) return;

    setSaving(true);
    if (!packageId) { setSaving(false); return; }

    const payload = {
      package_id: packageId,
      package_name: packageName,
      start_date: startDate,
      end_date: endDate,
      travelers,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      notes: notes.trim() || null,
      status: 'pending',
    };

    const { data, error } = await supabase.rpc('create_reservation_request', { p_payload: payload });

    if (error || !data) {
      reportError('reservation.create', error);
      setSaving(false);
      return;
    }
    onAdded(data as Reservation);

    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] flex-col w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-md transition-all">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
            🕋 {isAr ? 'إضافة حجز / حاج جديد (الديوان الوطني)' : 'Add New Pilgrim Booking'}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">
              {isAr ? 'الاسم الكامل للحاج (بالعربية أو الفرنسية)' : 'Pilgrim Full Name'}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isAr ? 'مثال: عبد القادر ابراهيمي' : 'e.g. Abdelkader Brahimi'}
              className="input w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">
                {isAr ? 'رقم الهاتف (الجزائر +213)' : 'Phone Number'}
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+213 661 23 45 67"
                className="input w-full"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">
                {isAr ? 'عدد المسافرين' : 'Travelers Count'}
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={travelers}
                onChange={(e) => setTravelers(parseInt(e.target.value) || 1)}
                className="input w-full"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">
              {isAr ? 'اختر الباقة المطلوبة' : 'Selected Hajj Package'}
            </label>
            <Select
              value={packageId}
              onChange={(e) => { const p = packages.find((x) => x.id === e.target.value); setPackageId(e.target.value); setPackageName(p?.name || ''); }}
              className="input w-full"
              required
            >
              <option value="">{isAr ? 'اختر الباقة' : 'Select package'}</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">
                {isAr ? 'تاريخ الذهاب (مطار الجزائر)' : 'Departure Date'}
              </label>
              <GlassDate
        
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        className="input w-full font-mono"
       />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">
                {isAr ? 'تاريخ العودة' : 'Return Date'}
              </label>
              <GlassDate
        
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
        className="input w-full font-mono"
       />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">
              {isAr ? 'ملاحظات وتفاصيل القرعة / المحرم' : 'Notes & Mahram Info'}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isAr ? 'مثال: رقم دفتر العائلة، رقم وصل القرعة 04821...' : 'e.g. Mahram name, lotto number...'}
              className="input w-full"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary gap-2 px-6"
            >
              <Plus className="h-4 w-4" />
              {saving ? (isAr ? 'جاري الإضافة...' : 'Adding...') : (isAr ? 'تأكيد وحفظ الحجز' : 'Add Booking')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
