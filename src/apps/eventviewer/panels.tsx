/**
 * Event Viewer — the detail pane.
 *
 * Windows splits one event into two views: General, which is the sentence an
 * operator reads, and Details, which is the payload a developer needs. Both come
 * out of the same `EventRecord`, so this is presentation only — there is no
 * second syscall behind the tabs.
 *
 * `EventProperties` is the same pane in a modal, which is what double-clicking a
 * row gives you in Windows. It shares the component rather than re-formatting the
 * record, so the two can never disagree.
 */
import { useState } from 'react';
import { ClipboardCopy, ScrollText } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  type EventRecord,
  EmptyState,
  InfoBar,
  Pivot,
  PropertyRow,
  fmt,
  useApp,
} from '@/platform/sdk';
import { CHANNEL_LABEL, LEVEL_LABEL, describe, eventName, levelTone } from './catalog';

type Tab = 'general' | 'details';

export function EventDetails({ record }: { record: EventRecord | null }) {
  const runtime = useApp();
  const { t, tr, lang } = runtime.locale;
  const [tab, setTab] = useState<Tab>('general');

  if (record === null) {
    return (
      <EmptyState
        icon={ScrollText}
        compact
        title={tr('لم يُحدَّد حدث', 'Aucun événement sélectionné', 'No event selected')}
        description={tr(
          'اختر سطرًا لعرض تفاصيله.',
          'Sélectionnez une ligne pour voir ses détails.',
          'Pick a row to read its details.',
        )}
      />
    );
  }

  const copy = async () => {
    const result = await runtime.invoke('shell.clipboardWrite', { text: describe(record) });
    void runtime.toast({
      kind: result.ok ? 'success' : 'error',
      title: result.ok
        ? tr('نُسخت التفاصيل', 'Détails copiés', 'Details copied')
        : result.error.message,
    });
  };

  const friendly = eventName(record.eventId);
  const payload = record.data === undefined ? [] : Object.entries(record.data);

  return (
    <div style={{ padding: 12, display: 'grid', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone={levelTone(record.level)}>{t(LEVEL_LABEL[record.level])}</Badge>
        <span style={{ fontSize: 'var(--fx-body)', fontWeight: 600 }}>
          {friendly === null ? `Event ${record.eventId}` : t(friendly)}
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="subtle" icon={ClipboardCopy} onClick={() => void copy()}>
          {tr('نسخ', 'Copier', 'Copy')}
        </Button>
      </div>

      <Pivot<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'general', label: tr('عام', 'Général', 'General') },
          { id: 'details', label: tr('التفاصيل', 'Détails', 'Details'), badge: payload.length },
        ]}
      />

      {tab === 'general' ? (
        <>
          <InfoBar tone={levelTone(record.level)} title={record.source}>
            {record.message}
          </InfoBar>
          <div>
            <PropertyRow label={tr('السجل', 'Journal', 'Log name')}>{t(CHANNEL_LABEL[record.channel])}</PropertyRow>
            <PropertyRow label={tr('المصدر', 'Source', 'Source')} mono>
              {record.source}
            </PropertyRow>
            <PropertyRow label={tr('رقم الحدث', 'ID d’événement', 'Event ID')} mono>
              {String(record.eventId)}
            </PropertyRow>
            <PropertyRow label={tr('وقت التسجيل', 'Enregistré', 'Logged')}>
              {`${fmt.dateTime(record.at, lang)} · ${fmt.relativeTime(record.at, lang)}`}
            </PropertyRow>
            <PropertyRow label={tr('العملية', 'Processus', 'Process')} mono>
              {record.pid === null ? '—' : String(record.pid)}
            </PropertyRow>
            <PropertyRow label={tr('المعرّف', 'Enregistrement', 'Record')} mono>
              {String(record.id)}
            </PropertyRow>
          </div>
        </>
      ) : payload.length === 0 ? (
        <EmptyState
          compact
          title={tr('بلا حمولة', 'Aucune donnée', 'No payload')}
          description={tr(
            'هذا الحدث لم يحمل بيانات إضافية.',
            'Cet événement ne porte pas de données.',
            'This event carried no extra data.',
          )}
        />
      ) : (
        <div>
          {payload.map(([key, value]) => (
            <PropertyRow key={key} label={key} mono>
              {value === null ? '—' : String(value)}
            </PropertyRow>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Event Properties modal.
 *
 * Opens on Enter or a double-click, closes on Escape — and holds nothing the
 * bottom pane does not, because in Windows it is the same property sheet.
 */
export function EventProperties({ record, onClose }: { record: EventRecord | null; onClose: () => void }) {
  const { tr } = useApp().locale;
  return (
    <Dialog
      open={record !== null}
      title={tr('خصائص الحدث', 'Propriétés de l’événement', 'Event properties')}
      onClose={onClose}
      secondaryLabel={tr('إغلاق', 'Fermer', 'Close')}
      width={640}
    >
      <div className="fx-scroll" style={{ maxHeight: 420, overflow: 'auto', margin: '0 -12px' }}>
        <EventDetails record={record} />
      </div>
    </Dialog>
  );
}
