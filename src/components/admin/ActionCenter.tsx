import { useState, type FormEvent } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { Target, Calendar, CheckSquare, Clock, Trash2, Plus } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import GlassDate from '@/components/admin/GlassDate';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

interface ActionRow {
  id: string;
  description?: string | null;
  assignee?: string | null;
  priority?: string | null;
  status?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export function ActionCenter(_props: { actions?: ActionRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: actions, loading, insert, update, remove } = useSupabaseData<ActionRow>({
    table: 'actions',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const [form, setForm] = useState({ description: '', assignee: '', priority: 'MEDIUM', due_date: '' });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'CANCELLED': return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
      default: return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'bg-rose-500 text-white';
      case 'HIGH': return 'bg-orange-500 text-white';
      case 'MEDIUM': return 'bg-amber-500 text-black';
      default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
    }
  };

  const nextStatus = (status: string) => {
    switch (status) {
      case 'PENDING': return 'IN_PROGRESS';
      case 'IN_PROGRESS': return 'COMPLETED';
      case 'COMPLETED': return 'COMPLETED';
      default: return 'IN_PROGRESS';
    }
  };

  const buttonLabel = (status: string) => {
    if (status === 'PENDING') return t('بدء', 'Démarrer', 'Start');
    if (status === 'IN_PROGRESS') return t('تحديد كمكتمل', 'Marquer terminé', 'Mark Complete');
    return t('مكتمل', 'Terminé', 'Completed');
  };

  const isOverdue = (dateString: string, status: string) => {
    if (!dateString || status === 'COMPLETED' || status === 'CANCELLED') return false;
    return new Date(dateString) < new Date();
  };

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.description.trim()) return;
    await insert({
      description: form.description.trim(),
      assignee: form.assignee.trim(),
      priority: form.priority,
      due_date: form.due_date || null,
      status: 'PENDING',
    });
    setForm({ description: '', assignee: '', priority: 'MEDIUM', due_date: '' });
  };

  const inputCls = 'input';

  const spinner = (
    <div className="p-10 flex justify-center">
      <Spinner />
    </div>
  );

  return (
    <div className={"space-y-6 " + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Target className="h-5 w-5 text-[var(--accent)]" />
          {t('مركز العمليات والتوصيات', 'Centre d\'Action', 'Action Center')}
        </h1>
      </div>

      <div className="card p-5 space-y-4">
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] rounded-xl border border-[var(--border)] dark:border-[var(--border)]">
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الوصف', 'Description', 'Description')}</label>
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('وصف الإجراء...', "Description de l'action...", 'Action description...')}
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('المسؤول', 'Responsable', 'Assignee')}</label>
            <input
              value={form.assignee}
              onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}
              placeholder={t('اسم الموظف...', "Nom de l'agent...", 'Staff name...')}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الأولوية', 'Priorité', 'Priority')}</label>
            <Select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inputCls}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الموعد النهائي', 'Échéance', 'Due date')}</label>
            <GlassDate
       
       value={form.due_date}
       onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
       className={inputCls}
      />
          </div>
          <div className="md:col-span-2 lg:col-span-4 flex justify-end">
            <button type="submit" className="btn btn-primary">
              <Plus className="w-4 h-4" />
              {t('إضافة إجراء', 'Ajouter une action', 'Add Action')}
            </button>
          </div>
        </form>

        {loading ? spinner : (
          actions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
              <CheckSquare className="w-12 h-12 mb-2 opacity-20" />
              <p>{t('لا توجد إجراءات مطلوبة', 'Aucune action requise', 'No actions')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {actions.map(action => {
                const overdue = isOverdue(action.due_date || '', action.status || '');
                return (
                  <div
                    key={action.id}
                    className={`p-5 rounded-xl border ${
                      overdue ? 'border-rose-300 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-950/10' : 'border-[var(--border)] dark:border-[var(--border)] hover:border-brand-500'
                    } transition-colors`}
                  >
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${getStatusColor(action.status || '')}`}>
                            {action.status || 'PENDING'}
                          </span>
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${getPriorityColor(action.priority || '')}`}>
                            {action.priority || 'MEDIUM'}
                          </span>
                          {overdue && (
                            <span className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {t('متأخر', 'En retard', 'Overdue')}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-lg text-[var(--text-secondary)] dark:text-white mb-1">{action.description}</h4>
                        {action.assignee && (
                          <p className="text-[13px] text-[var(--text-muted)]">
                            {t('المسؤول: ', 'Responsable: ', 'Assignee: ')}{action.assignee}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col items-start md:items-end justify-between min-w-[150px]">
                        <div className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] text-start md:text-end">
                          <p className="flex items-center gap-1 mt-1 justify-start md:justify-end">
                            <Calendar className="w-3 h-3" />
                            {action.due_date ? new Date(action.due_date).toLocaleDateString() : t('بدون موعد', 'Sans date', 'No date')}
                          </p>
                        </div>

                        <div className="mt-4 flex items-center gap-2">
                          {action.status !== 'COMPLETED' && action.status !== 'CANCELLED' && (
                            <button
                              onClick={() => update(action.id, { status: nextStatus(action.status ?? '') })}
                              className="btn btn-primary w-full md:w-auto"
                            >
                              {buttonLabel(action.status ?? '')}
                            </button>
                          )}
                          <button
                            onClick={() => remove(action.id)}
                            className="p-2 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50 transition-colors"
                            title={t('حذف', 'Supprimer', 'Delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
