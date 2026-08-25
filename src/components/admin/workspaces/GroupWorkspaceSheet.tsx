import React, { useEffect, useState } from 'react';
import { SideSheet } from './SideSheet';
import { Calendar } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import type { GroupRow } from '@/types/database';

interface GroupWorkspaceSheetProps {
  groupId: string | null;
  onClose: () => void;
}

export function GroupWorkspaceSheet({ groupId, onClose }: GroupWorkspaceSheetProps) {
  const { lang } = useI18n();
  const t = (ar: string, fr: string, en: string) => lang === 'ar' ? ar : lang === 'fr' ? fr : en;

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    supabase.from('groups').select('*').eq('id', groupId).single().then(({ data }) => {
      setGroup(data);
      setLoading(false);
    });
  }, [groupId]);

  return (
    <SideSheet isOpen={!!groupId} onClose={onClose} title={t('تفاصيل المجموعة', 'Détails du Groupe', 'Group Details')} width="max-w-3xl">
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-[var(--text-muted)]">{t('جاري التحميل...', 'Chargement...', 'Loading...')}</p>
        </div>
      ) : group ? (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-bold text-[var(--text-primary)]">{group.code || group.name || 'Group'}</h3>
              <p className="text-sm text-[var(--text-muted)] flex items-center gap-2 mt-1">
                <Calendar className="h-4 w-4" /> {group.departure_date ? new Date(group.departure_date).toLocaleDateString() : t('غير محدد', 'Non défini', 'Not set')}
              </p>
            </div>
            <span className="px-3 py-1 bg-[var(--brand-500)]/10 text-[var(--brand-500)] font-semibold rounded-full text-sm">
              {group.status || 'FORMING'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[var(--bg-hover)] border border-[var(--border)]">
              <p className="text-xs text-[var(--text-muted)] mb-1">{t('السعة', 'Capacité', 'Capacity')}</p>
              <p className="text-lg font-bold">{group.current_capacity || 0} / {group.max_capacity || 0}</p>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-hover)] border border-[var(--border)]">
              <p className="text-xs text-[var(--text-muted)] mb-1">{t('جاهزية', 'Préparation', 'Readiness')}</p>
              <p className="text-lg font-bold text-amber-500">{Number(group.readiness_score || 0).toFixed(0)}%</p>
            </div>
          </div>

          
          </div>
      ) : (
        <div className="flex items-center justify-center h-40">
          <p className="text-[var(--text-muted)]">{t('لم يتم العثور على المجموعة', 'Groupe non trouvé', 'Group not found')}</p>
        </div>
      )}
    </SideSheet>
  );
}