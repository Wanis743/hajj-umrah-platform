/**
 * Settings — installed apps and default apps.
 *
 * The inventory arrives through `apps.list`, which is the record the kernel keeps
 * for every installed app, so this page and the Start menu agree by construction:
 * same install dates, same policy state, and the app names are the localised ones
 * from the manifest rather than the English `DisplayName` the HKLM mirror happens
 * to store. Subscribing to `CHANNEL_APPS_CHANGED` means a pin or a removal made
 * anywhere in the OS lands here without a refresh.
 *
 * Default apps are the one thing here that writes. An association is a value
 * under `HKCU\Software\FinanceOS\AppSettings\Associations` named after the file
 * extension, and `handlerFor` reads it before it looks at any manifest — which
 * means a default chosen here beats the app that claims the type, and takes
 * effect on the very next double-click rather than at the next boot.
 */
import { useMemo } from 'react';
import { AppWindow, CircleSlash, FileCog, Package, RotateCcw } from 'lucide-react';
import {
  type AppInventoryRecord,
  Badge,
  Button,
  CHANNEL_APPS_CHANGED,
  Card,
  EmptyState,
  InfoBar,
  type Localized,
  PropertyRow,
  REG,
  Section,
  Select,
  capabilityLabel,
  fmt,
  useApp,
  useIpc,
  usePolledSyscall,
} from '@/platform/sdk';
import { categoryLabel } from '../shared/categories';
import { Row } from './parts';
import { entryText } from './prefs';

/** The inventory only changes on install or uninstall, so one read is enough. */
const ONCE = 0;

/** Shared because it is never mutated, and because the hook keys on its shape. */
const NO_REQUEST = {} as const;

const ASSOCIATIONS_KEY = `${REG.userAppSettings}\\Associations`;

/** The file types this OS understands, named the way Windows names them. */
const FILE_TYPES: readonly { readonly ext: string; readonly label: Localized }[] = [
  { ext: '.txt', label: { ar: 'ملف نصي', fr: 'Document texte', en: 'Text document' } },
  { ext: '.log', label: { ar: 'سجل', fr: 'Journal', en: 'Log file' } },
  { ext: '.md', label: { ar: 'ماركداون', fr: 'Markdown', en: 'Markdown' } },
  { ext: '.csv', label: { ar: 'قيم مفصولة بفواصل', fr: 'Valeurs séparées', en: 'Comma-separated values' } },
  { ext: '.json', label: { ar: 'جيسون', fr: 'JSON', en: 'JSON' } },
  { ext: '.fxsheet', label: { ar: 'جدول', fr: 'Feuille de calcul', en: 'Spreadsheet' } },
  { ext: '.fxjournal', label: { ar: 'قيد يومية', fr: 'Écriture comptable', en: 'Journal entry' } },
  { ext: '.fxreport', label: { ar: 'تقرير', fr: 'Rapport', en: 'Report' } },
];

/**
 * One installed app, rendered from the record the page already holds.
 *
 * Everything on the card is a manifest fact except the install date and the
 * policy flag, which only the running inventory knows — which is exactly why the
 * page reads `apps.list` rather than the manifests it could import directly.
 */
function InstalledCard({ record }: { record: AppInventoryRecord }) {
  const { t, tr, lang } = useApp().locale;
  const { manifest } = record;

  return (
    <Card
      icon={AppWindow}
      title={t(manifest.name)}
      subtitle={String(manifest.id)}
      actions={
        <span style={{ display: 'flex', gap: 6 }}>
          {record.enabled ? null : (
            <Badge tone="danger" icon={CircleSlash}>
              {tr('معطّل بسياسة', 'Désactivée', 'Disabled')}
            </Badge>
          )}
          {manifest.systemComponent ? (
            <Badge tone="info">{tr('مكوّن نظام', 'Composant système', 'System component')}</Badge>
          ) : null}
        </span>
      }
      padded
    >
      <PropertyRow label={tr('الإصدار', 'Version', 'Version')} mono>
        {manifest.version}
      </PropertyRow>
      <PropertyRow label={tr('الناشر', 'Éditeur', 'Publisher')}>{manifest.publisher}</PropertyRow>
      <PropertyRow label={tr('الفئة', 'Catégorie', 'Category')}>{t(categoryLabel(manifest.category))}</PropertyRow>
      <PropertyRow label={tr('تاريخ التثبيت', 'Installé le', 'Installed')}>
        {fmt.dateTime(record.installedAt, lang)}
      </PropertyRow>
      <div style={{ paddingTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {manifest.capabilities.map((capability) => (
          <Badge key={capability} tone="neutral" title={capability}>
            {t(capabilityLabel(capability))}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

export function AppsPage() {
  const runtime = useApp();
  const { t, tr, lang } = runtime.locale;
  const inventory = usePolledSyscall('apps.list', NO_REQUEST, ONCE);
  const associations = usePolledSyscall('registry.enumValues', { key: ASSOCIATIONS_KEY }, ONCE);

  // An install or a removal anywhere in the OS rewrites this list.
  useIpc(CHANNEL_APPS_CHANGED, inventory.refresh);

  // The kernel sorts by the English name; a French or Arabic session wants its
  // own collation, so the order is taken here rather than accepted as given.
  const records = useMemo(
    () => [...(inventory.data ?? [])].sort((a, b) => t(a.manifest.name).localeCompare(t(b.manifest.name))),
    [inventory.data, t],
  );

  const options = records.map((record) => ({ value: String(record.manifest.id), label: t(record.manifest.name) }));

  /** `''` clears the override and hands the type back to the manifests. */
  const choose = async (extension: string, chosen: string) => {
    const result =
      chosen === ''
        ? await runtime.invoke('registry.delete', { key: ASSOCIATIONS_KEY, name: extension })
        : await runtime.invoke('registry.set', { key: ASSOCIATIONS_KEY, name: extension, value: chosen });
    if (!result.ok) {
      void runtime.toast({ kind: 'error', title: result.error.message });
      return;
    }
    associations.refresh();
  };

  if (records.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title={tr('لا تطبيقات مثبّتة', 'Aucune application installée', 'No installed apps')}
        description={tr(
          'لم يُعلن أي بيان تطبيق في هذه الجلسة.',
          'Aucun manifeste n’a été enregistré dans cette session.',
          'No manifest was registered in this session.',
        )}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Section title={tr('التطبيقات الافتراضية', 'Applications par défaut', 'Default apps')}>
        <Card icon={FileCog} padded>
          {FILE_TYPES.map((type) => {
            const override = entryText(associations.data ?? null, type.ext, '');
            return (
              <Row key={type.ext} title={t(type.label)} hint={type.ext}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Select
                    value={override}
                    onChange={(next) => void choose(type.ext, next)}
                    options={options}
                    width={220}
                    placeholder={tr('حسب البيان', 'Selon le manifeste', 'From the manifest')}
                  />
                  <Button
                    size="sm"
                    variant="subtle"
                    icon={RotateCcw}
                    disabled={override === ''}
                    title={tr('استعادة الافتراضي', 'Rétablir', 'Reset')}
                    onClick={() => void choose(type.ext, '')}
                  />
                </div>
              </Row>
            );
          })}
        </Card>
      </Section>

      <InfoBar tone="info" title={tr('كيف يُختار المعالج', 'Choix du gestionnaire', 'How a handler is chosen')}>
        {tr(
          'الاختيار هنا يسبق ما يعلنه البيان؛ وعند الاستعادة يعود النظام إلى أول تطبيق يطالب بنوع الملف.',
          'Un choix fait ici précède le manifeste ; après réinitialisation, la première application qui revendique le type reprend la main.',
          'A choice made here beats the manifest; reset it and the first app that claims the type takes over again.',
        )}
      </InfoBar>

      <Section
        title={tr('التطبيقات المثبّتة', 'Applications installées', 'Installed apps')}
        action={<Badge tone="neutral">{fmt.integer(records.length, lang)}</Badge>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          {records.map((record) => (
            <InstalledCard key={String(record.manifest.id)} record={record} />
          ))}
        </div>
      </Section>
    </div>
  );
}
