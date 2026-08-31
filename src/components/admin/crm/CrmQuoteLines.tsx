/**
 * Quote lines, editable only while the quote is a draft.
 *
 * That is not a UI convention: the rollup trigger on crm_quote_lines raises
 * "Quote lines can only change while the quote is a draft" for any insert, update
 * or delete once the quote has been sent. The controls disappear because the write
 * would be refused, and a disabled button is a more honest screen than an error.
 *
 * line_total is GENERATED ALWAYS and subtotal is rolled up by the same trigger, so
 * neither is ever sent. total_amount is subtotal − discount, computed by the quote
 * trigger. The discount lives here rather than on the create form because the
 * server refuses a discount above the subtotal, and at creation the subtotal is 0.
 */
import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmQuoteCommands, crmQuoteLineCommands } from '@/services/domainCommands';
import type { CrmQuoteLineRow, CrmQuoteRow } from '@/types/crm';
import { Field, NoticeBar } from './atoms';
import { fmtMoney, useCrmI18n } from './crmFormat';
import { useCrmPackageOptions, useCrmQuoteLineRows } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

interface LineDraft { description: string; quantity: string; unit_price: string; package_id: string }

const EMPTY: LineDraft = { description: '', quantity: '1', unit_price: '', package_id: '' };

function toNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function CrmQuoteLines({ quote, onQuoteChanged }: {
  quote: CrmQuoteRow;
  onQuoteChanged: () => Promise<void> | void;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const lines = useCrmQuoteLineRows(quote.id);
  const packages = useCrmPackageOptions();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<LineDraft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<LineDraft>(EMPTY);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [discount, setDiscount] = useState(String(quote.discount_amount));

  const draftMode = quote.status === 'DRAFT';
  const nextSort = useMemo(
    () => lines.data.reduce((max, l) => Math.max(max, l.sort_order), 0) + 10,
    [lines.data],
  );
  const money = (v: number | null) => fmtMoney(v, quote.currency_code);

  const refresh = async () => { await lines.refetch(); await onQuoteChanged(); };

  const pickPackage = (id: string, setter: (d: LineDraft) => void, current: LineDraft) => {
    const p = packages.data.find((row) => row.id === id) ?? null;
    const price = quote.currency_code === 'SAR' ? p?.price_sar : p?.price_dzd;
    setter({
      ...current,
      package_id: id,
      description: current.description.trim() === '' ? (p?.name ?? p?.code ?? current.description) : current.description,
      unit_price: price != null ? String(price) : current.unit_price,
    });
  };

  const add = async () => {
    const qty = toNumber(draft.quantity);
    const price = toNumber(draft.unit_price);
    if (draft.description.trim() === '' || qty === null || qty <= 0 || price === null || price < 0) return;
    const payload: Record<string, unknown> = {
      quote_id: quote.id,
      description: draft.description.trim(),
      quantity: qty,
      unit_price: price,
      sort_order: nextSort,
    };
    if (draft.package_id) payload.package_id = draft.package_id;
    const ok = await cmd.run(() => crmQuoteLineCommands.create(payload), {
      notice: t('تمت إضافة سطر', 'Ligne ajoutée', 'Line added'),
      onSuccess: refresh,
    });
    if (ok) { setDraft(EMPTY); setAdding(false); }
  };

  const save = async (line: CrmQuoteLineRow) => {
    const qty = toNumber(edit.quantity);
    const price = toNumber(edit.unit_price);
    if (edit.description.trim() === '' || qty === null || qty <= 0 || price === null || price < 0) return;
    const ok = await cmd.run(
      () => crmQuoteLineCommands.update(line.id, {
        description: edit.description.trim(),
        quantity: qty,
        unit_price: price,
      }),
      { notice: t('تم تحديث السطر', 'Ligne mise à jour', 'Line updated'), onSuccess: refresh },
    );
    if (ok) setEditingId(null);
  };

  const remove = async (line: CrmQuoteLineRow) => {
    await cmd.run(() => crmQuoteLineCommands.remove(line.id), {
      notice: t('تم حذف السطر', 'Ligne supprimée', 'Line removed'),
      onSuccess: async () => { setPendingDelete(null); await refresh(); },
    });
  };

  const discountValue = toNumber(discount);
  const discountValid = discountValue !== null && discountValue >= 0 && discountValue <= quote.subtotal;
  const saveDiscount = async () => {
    if (!discountValid || discountValue === null) return;
    await cmd.run(() => crmQuoteCommands.update(quote.id, { discount_amount: discountValue }), {
      notice: t('تم تحديث الخصم', 'Remise mise à jour', 'Discount updated'),
      onSuccess: refresh,
    });
  };

  return (
    <div className="space-y-3">
      {lines.error && <ErrorBanner message={lines.error} onRetry={() => { void lines.refetch(); }} />}
      {packages.error && <ErrorBanner message={packages.error} onRetry={() => { void packages.refetch(); }} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--text-muted)]">
          {draftMode
            ? t('السطور قابلة للتعديل ما دام العرض مسوّدة', 'Lignes modifiables tant que le devis est brouillon', 'Lines are editable while the quote is a draft')
            : t('العرض لم يعد مسوّدة — السطور مقروءة فقط', 'Le devis n’est plus un brouillon — lignes en lecture seule', 'The quote is no longer a draft — lines are read-only')}
        </p>
        {draftMode && (
          <button type="button" className="btn btn-sm" onClick={() => setAdding((v) => !v)} disabled={cmd.busy}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('سطر', 'Ligne', 'Add line')}
          </button>
        )}
      </div>

      {adding && draftMode && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('من باقة', 'Depuis un forfait', 'From package')}>
            <Select
              value={draft.package_id}
              onChange={(e) => pickPackage(e.target.value, setDraft, draft)}
              className="input"
            >
              <option value="">{t('بدون', 'Aucun', 'None')}</option>
              {packages.data.map((p) => (
                <option key={p.id} value={p.id}>{p.name ?? p.code ?? p.id.slice(0, 8)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('الوصف', 'Description', 'Description')}>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="input"
            />
          </Field>
          <Field label={t('الكمية', 'Quantité', 'Quantity')}>
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
              className="input tabular"
            />
          </Field>
          <Field
            label={`${t('سعر الوحدة', 'Prix unitaire', 'Unit price')} (${quote.currency_code})`}
            hint={(() => {
              const q = toNumber(draft.quantity);
              const p = toNumber(draft.unit_price);
              return q !== null && p !== null ? money(Number((q * p).toFixed(2))) : undefined;
            })()}
          >
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.unit_price}
              onChange={(e) => setDraft({ ...draft, unit_price: e.target.value })}
              className="input tabular"
            />
          </Field>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void add(); }} disabled={cmd.busy}>
              {t('إضافة', 'Ajouter', 'Add')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setDraft(EMPTY); }} disabled={cmd.busy}>
              {t('إلغاء', 'Annuler', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {lines.loading && lines.data.length === 0 ? (
        <Spinner className="p-6" />
      ) : lines.data.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا سطور — العرض لا يمكن إرساله بدون سطر', 'Aucune ligne — un devis ne peut être envoyé sans ligne', 'No lines — a quote cannot be sent without one')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[640px]">
            <thead>
              <tr>
                <th>{t('الوصف', 'Description', 'Description')}</th>
                <th className="end">{t('الكمية', 'Qté', 'Qty')}</th>
                <th className="end">{t('سعر الوحدة', 'P.U.', 'Unit')}</th>
                <th className="end">{t('الإجمالي', 'Total', 'Total')}</th>
                {draftMode && <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {lines.data.map((line) => {
                const editingThis = editingId === line.id;
                return (
                  <tr key={line.id}>
                    <td>
                      {editingThis ? (
                        <input
                          value={edit.description}
                          onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                          className="input"
                          aria-label={t('الوصف', 'Description', 'Description')}
                        />
                      ) : line.description}
                    </td>
                    <td className="end tabular text-end">
                      {editingThis ? (
                        <input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={edit.quantity}
                          onChange={(e) => setEdit({ ...edit, quantity: e.target.value })}
                          className="input tabular w-20"
                          aria-label={t('الكمية', 'Quantité', 'Quantity')}
                        />
                      ) : line.quantity}
                    </td>
                    <td className="end tabular text-end">
                      {editingThis ? (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={edit.unit_price}
                          onChange={(e) => setEdit({ ...edit, unit_price: e.target.value })}
                          className="input tabular w-28"
                          aria-label={t('سعر الوحدة', 'Prix unitaire', 'Unit price')}
                        />
                      ) : money(line.unit_price)}
                    </td>
                    <td className="end tabular text-end">{money(line.line_total)}</td>
                    {draftMode && (
                      <td className="end">
                        <div className="flex items-center justify-end gap-1">
                          {editingThis ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => { void save(line); }}
                                disabled={cmd.busy}
                                aria-label={t('حفظ', 'Enregistrer', 'Save')}
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setEditingId(null)}
                                aria-label={t('إلغاء', 'Annuler', 'Cancel')}
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => {
                                  setEditingId(line.id);
                                  setEdit({
                                    description: line.description,
                                    quantity: String(line.quantity),
                                    unit_price: String(line.unit_price),
                                    package_id: line.package_id ?? '',
                                  });
                                }}
                                aria-label={t('تعديل', 'Modifier', 'Edit')}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className={pendingDelete === line.id ? 'btn btn-danger btn-sm' : 'btn btn-ghost btn-sm'}
                                disabled={cmd.busy}
                                onClick={() => {
                                  // Two clicks, not window.confirm: the second click is
                                  // the confirmation and the row is gone for good.
                                  if (pendingDelete === line.id) { void remove(line); return; }
                                  setPendingDelete(line.id);
                                }}
                              >
                                {pendingDelete === line.id
                                  ? t('تأكيد', 'Confirmer', 'Confirm')
                                  : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {t('المجموع الجزئي', 'Sous-total', 'Subtotal')}
          </p>
          <p className="tabular text-sm font-semibold text-[var(--text-primary)]">{money(quote.subtotal)}</p>
        </div>
        <div>
          {draftMode ? (
            <Field
              label={t('الخصم', 'Remise', 'Discount')}
              hint={discountValid
                ? undefined
                : t('لا يمكن أن يتجاوز المجموع الجزئي', 'Ne peut dépasser le sous-total', 'Cannot exceed the subtotal')}
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="input tabular"
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => { void saveDiscount(); }}
                  disabled={cmd.busy || !discountValid || discountValue === quote.discount_amount}
                >
                  {t('حفظ', 'OK', 'Save')}
                </button>
              </div>
            </Field>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                {t('الخصم', 'Remise', 'Discount')}
              </p>
              <p className="tabular text-sm text-[var(--text-primary)]">{money(quote.discount_amount)}</p>
            </>
          )}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {t('الإجمالي', 'Total', 'Total')}
          </p>
          <p className="tabular text-sm font-semibold text-[var(--text-primary)]">{money(quote.total_amount)}</p>
        </div>
      </div>
    </div>
  );
}
