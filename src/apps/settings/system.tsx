/**
 * Settings — system, storage and about.
 *
 * Three pages that are pure kernel readouts. Machine identity comes out of
 * `HKLM\SOFTWARE\FinanceOS\Policy`, the resource numbers out of `system.metrics`
 * and the drives out of `fs.volumes`; none of it is cached app-side, because a
 * copy kept here would be a second and wrong source of truth.
 *
 * The only writes are the two session preferences and `power.request`. The power
 * calls lean on the kernel's own consent prompt — `power` is a privileged
 * capability, so the dispatcher already asks before it acts, and asking twice
 * would teach people to click through the one that matters.
 */
import { useMemo, useState } from 'react';
import {
  Clock,
  Cpu,
  HardDrive,
  Info,
  Lock,
  LogOut,
  type LucideIcon,
  Monitor,
  Moon,
  Power,
  RotateCw,
  Server,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InfoBar,
  KpiTile,
  type Localized,
  Meter,
  type PowerAction,
  PropertyRow,
  Section,
  Select,
  Switch,
  type SystemMetrics,
  type Tone,
  type VfsVolumeInfo,
  capabilityLabel,
  fmt,
  useApp,
  usePolledSyscall,
} from '@/platform/sdk';
import { Hero, Row } from './parts';
import { KEYS, entryFlag, entryText, useRegistryValue } from './prefs';

/** Machine identity cannot change while the OS is up, so one read is enough. */
const ONCE = 0;
const METRICS_MS = 2000;
const VOLUMES_MS = 5000;

const IDLE_MINUTES: readonly number[] = [0, 5, 10, 15, 30, 60];

interface PowerChoice {
  readonly action: PowerAction;
  readonly icon: LucideIcon;
  readonly label: Localized;
  /** `null` skips the confirmation — locking and sleeping lose nothing. */
  readonly body: Localized | null;
  readonly danger: boolean;
}

const POWER_CHOICES: readonly PowerChoice[] = [
  {
    action: 'lock',
    icon: Lock,
    label: { ar: 'قفل', fr: 'Verrouiller', en: 'Lock' },
    body: null,
    danger: false,
  },
  {
    action: 'sleep',
    icon: Moon,
    label: { ar: 'سكون', fr: 'Veille', en: 'Sleep' },
    body: null,
    danger: false,
  },
  {
    action: 'signOut',
    icon: LogOut,
    label: { ar: 'تسجيل الخروج', fr: 'Se déconnecter', en: 'Sign out' },
    body: {
      ar: 'سيتم إغلاق كل التطبيقات المفتوحة.',
      fr: 'Toutes les applications ouvertes seront fermées.',
      en: 'Every open app will be closed.',
    },
    danger: false,
  },
  {
    action: 'restart',
    icon: RotateCw,
    label: { ar: 'إعادة التشغيل', fr: 'Redémarrer', en: 'Restart' },
    body: {
      ar: 'ستُعاد تهيئة النواة وتُغلق كل النوافذ.',
      fr: 'Le noyau redémarre et toutes les fenêtres se ferment.',
      en: 'The kernel restarts and every window closes.',
    },
    danger: false,
  },
  {
    action: 'shutdown',
    icon: Power,
    label: { ar: 'إيقاف التشغيل', fr: 'Arrêter', en: 'Shut down' },
    body: {
      ar: 'سيتوقف النظام ويعود بك إلى لوحة الإدارة.',
      fr: 'Le système s’arrête et vous revenez au tableau de bord.',
      en: 'The system stops and returns you to the admin dashboard.',
    },
    danger: true,
  },
];

/** Windows paints a drive red past 90 % and amber past 75 %. */
function volumeTone(used: number, quota: number): Tone {
  if (quota <= 0) return 'neutral';
  const share = used / quota;
  if (share > 0.9) return 'danger';
  if (share > 0.75) return 'warning';
  return 'accent';
}

/**
 * The three headline numbers.
 *
 * Split out from the page because every tile body is a `metrics === null` guard,
 * and a page that also owns the power buttons reads better without them inline.
 */
function Specifications({ metrics, bootedAt }: { metrics: SystemMetrics | null; bootedAt: string }) {
  const { tr, lang } = useApp().locale;
  const cpu = metrics?.cpuPercent ?? 0;
  const ticks = fmt.integer(metrics?.tickRate ?? 0, lang);
  const share = metrics === null || metrics.memoryLimitBytes <= 0 ? 0 : metrics.memoryBytes / metrics.memoryLimitBytes;

  return (
    <Section title={tr('المواصفات', 'Caractéristiques', 'Specifications')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <KpiTile
          icon={Cpu}
          label={tr('المعالج', 'Processeur', 'Processor')}
          value={fmt.percent(cpu / 100, lang)}
          secondary={tr(`${ticks} نبضة/ث`, `${ticks} ticks/s`, `${ticks} ticks/s`)}
          tone={cpu > 85 ? 'danger' : 'neutral'}
        />
        <KpiTile
          icon={Server}
          label={tr('الذاكرة', 'Mémoire', 'Memory')}
          value={fmt.bytes(metrics?.memoryBytes ?? 0, lang)}
          secondary={`${fmt.percent(share, lang)} ${tr('من', 'de', 'of')} ${fmt.bytes(metrics?.memoryLimitBytes ?? 0, lang)}`}
        />
        <KpiTile
          icon={Clock}
          label={tr('مدة التشغيل', 'Disponibilité', 'Up time')}
          value={fmt.duration(metrics?.uptimeMs ?? 0, lang)}
          secondary={bootedAt === '' ? undefined : fmt.dateTime(bootedAt, lang)}
        />
      </div>
    </Section>
  );
}

export function SystemPage() {
  const runtime = useApp();
  const { t, tr } = runtime.locale;
  const metrics = usePolledSyscall('system.metrics', {}, METRICS_MS).data;
  const policy = usePolledSyscall('registry.enumValues', { key: KEYS.policy }, ONCE).data;
  const [confirmSignOut, setConfirmSignOut] = useRegistryValue<boolean>(KEYS.session, 'ConfirmSignOut', true);
  const [lockMinutes, setLockMinutes] = useRegistryValue<number>(KEYS.session, 'LockOnIdleMinutes', 0);
  const [busy, setBusy] = useState<PowerAction | null>(null);

  // `power` is privileged, so the kernel prompts for consent on its own; this
  // extra step exists only because the user asked to be asked.
  const request = async (choice: PowerChoice) => {
    if (choice.body !== null && confirmSignOut) {
      const agreed = await runtime.confirm({
        kind: choice.danger ? 'warning' : 'question',
        title: t(choice.label),
        body: t(choice.body),
        destructive: choice.danger,
      });
      if (!agreed) return;
    }
    setBusy(choice.action);
    const result = await runtime.invoke('power.request', { action: choice.action });
    setBusy(null);
    if (!result.ok) void runtime.toast({ kind: 'error', title: result.error.message });
  };

  const machineName = entryText(policy, 'MachineName', 'FINANCE-OS');
  const productName = entryText(policy, 'ProductName', 'FinanceOS 11');
  const build = entryText(policy, 'Build', '—');
  const bootedAt = entryText(policy, 'LastBootAt', '');
  const durable = entryFlag(policy, 'StorageDurable');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Hero
        icon={Monitor}
        title={machineName}
        subtitle={`${productName} · ${tr('إصدار', 'Version', 'Build')} ${build}`}
        actions={
          durable ? (
            <Badge tone="success">{tr('تخزين دائم', 'Stockage durable', 'Durable storage')}</Badge>
          ) : (
            <Badge tone="warning">{tr('جلسة مؤقتة', 'Session éphémère', 'In-memory session')}</Badge>
          )
        }
      />

      <Specifications metrics={metrics} bootedAt={bootedAt} />

      <Section title={tr('الجلسة', 'Session', 'Session')}>
        <Card icon={Lock} padded>
          <Row
            title={tr('تأكيد قبل الإغلاق', 'Confirmer avant d’arrêter', 'Confirm before shutting down')}
            hint={tr(
              'يظهر سؤال قبل الخروج أو إعادة التشغيل',
              'Demande une confirmation avant déconnexion ou redémarrage',
              'Asks before signing out or restarting',
            )}
          >
            <Switch checked={confirmSignOut} onChange={setConfirmSignOut} />
          </Row>
          <Row
            title={tr('القفل عند الخمول', 'Verrouillage après inactivité', 'Lock after inactivity')}
            hint={tr('صفر يعني بلا قفل', 'Zéro désactive le verrouillage', 'Zero disables locking')}
          >
            <Select
              value={String(lockMinutes)}
              onChange={(next) => setLockMinutes(Number.parseInt(next, 10))}
              width={140}
              options={IDLE_MINUTES.map((minutes) => ({
                value: String(minutes),
                label:
                  minutes === 0
                    ? tr('معطّل', 'Désactivé', 'Never')
                    : tr(`${minutes} دقيقة`, `${minutes} min`, `${minutes} min`),
              }))}
            />
          </Row>
        </Card>
      </Section>

      <Section title={tr('الطاقة', 'Alimentation', 'Power')}>
        <Card icon={Power} padded>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {POWER_CHOICES.map((choice) => (
              <Button
                key={choice.action}
                icon={choice.icon}
                variant={choice.danger ? 'danger' : 'default'}
                busy={busy === choice.action}
                disabled={busy !== null}
                onClick={() => void request(choice)}
              >
                {t(choice.label)}
              </Button>
            ))}
          </div>
        </Card>
      </Section>
    </div>
  );
}

const VOLUME_KIND: Readonly<Record<VfsVolumeInfo['kind'], Localized>> = {
  persistent: { ar: 'دائم', fr: 'Persistant', en: 'Persistent' },
  memory: { ar: 'في الذاكرة', fr: 'En mémoire', en: 'In memory' },
  projection: { ar: 'مُسقط', fr: 'Projection', en: 'Projection' },
};

export function StoragePage() {
  const { t, tr, lang } = useApp().locale;
  const volumes = usePolledSyscall('fs.volumes', {}, VOLUMES_MS);

  const totals = useMemo(() => {
    const list = volumes.data ?? [];
    return {
      used: list.reduce((sum, volume) => sum + volume.usedBytes, 0),
      quota: list.reduce((sum, volume) => sum + volume.quotaBytes, 0),
      count: list.length,
    };
  }, [volumes.data]);

  if (volumes.data === null) {
    return (
      <EmptyState
        icon={HardDrive}
        title={tr('جارٍ قراءة الأقراص…', 'Lecture des volumes…', 'Reading volumes…')}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Section title={tr('نظرة عامة', 'Vue d’ensemble', 'Overview')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <KpiTile icon={HardDrive} label={tr('المستخدم', 'Utilisé', 'In use')} value={fmt.bytes(totals.used, lang)} />
          <KpiTile label={tr('السعة', 'Capacité', 'Capacity')} value={fmt.bytes(totals.quota, lang)} />
          <KpiTile label={tr('عدد الأقراص', 'Volumes', 'Volumes')} value={fmt.integer(totals.count, lang)} />
        </div>
      </Section>

      <Section title={tr('الأقراص', 'Volumes', 'Volumes')}>
        <div style={{ display: 'grid', gap: 12 }}>
          {volumes.data.map((volume) => (
            <Card
              key={volume.letter}
              icon={HardDrive}
              title={`${volume.letter}: — ${t(volume.label)}`}
              subtitle={t(VOLUME_KIND[volume.kind])}
              actions={volume.readOnly ? <Badge tone="info">{tr('للقراءة فقط', 'Lecture seule', 'Read-only')}</Badge> : undefined}
              padded
            >
              <div style={{ paddingBottom: 10 }}>
                <Meter
                  value={volume.usedBytes}
                  max={Math.max(volume.quotaBytes, volume.usedBytes)}
                  tone={volumeTone(volume.usedBytes, volume.quotaBytes)}
                  label={`${fmt.bytes(volume.usedBytes, lang)} / ${fmt.bytes(volume.quotaBytes, lang)}`}
                />
              </div>
              <PropertyRow label={tr('المتوفر', 'Disponible', 'Free')}>
                {fmt.bytes(Math.max(0, volume.quotaBytes - volume.usedBytes), lang)}
              </PropertyRow>
              <PropertyRow label={tr('نسبة الامتلاء', 'Remplissage', 'Used')}>
                {volume.quotaBytes > 0 ? fmt.percent(volume.usedBytes / volume.quotaBytes, lang) : '—'}
              </PropertyRow>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}

export function AboutPage() {
  const runtime = useApp();
  const { t, tr, lang } = runtime.locale;
  const policy = usePolledSyscall('registry.enumValues', { key: KEYS.policy }, ONCE).data;
  const metrics = usePolledSyscall('system.metrics', {}, METRICS_MS).data;

  const productName = entryText(policy, 'ProductName', 'FinanceOS 11');
  const build = entryText(policy, 'Build', '—');
  const bootedAt = entryText(policy, 'LastBootAt', '');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Hero icon={Info} title={productName} subtitle={`${tr('إصدار', 'Version', 'Build')} ${build}`} />

      <Section title={tr('النظام', 'Système', 'System')}>
        <Card padded>
          <PropertyRow label={tr('اسم الجهاز', 'Nom de l’appareil', 'Device name')} mono>
            {entryText(policy, 'MachineName', 'FINANCE-OS')}
          </PropertyRow>
          <PropertyRow label={tr('آخر إقلاع', 'Dernier démarrage', 'Last boot')}>
            {bootedAt === '' ? '—' : fmt.dateTime(bootedAt, lang)}
          </PropertyRow>
          <PropertyRow label={tr('مدة التشغيل', 'Disponibilité', 'Up time')}>
            {fmt.duration(metrics?.uptimeMs ?? 0, lang)}
          </PropertyRow>
          <PropertyRow label={tr('العمليات', 'Processus', 'Processes')}>
            {fmt.integer(metrics?.processCount ?? 0, lang)}
          </PropertyRow>
          <PropertyRow label={tr('المؤشرات المفتوحة', 'Descripteurs', 'Open handles')}>
            {fmt.integer(metrics?.handleCount ?? 0, lang)}
          </PropertyRow>
          <PropertyRow label={tr('التخزين', 'Stockage', 'Storage')}>
            {entryFlag(policy, 'StorageDurable')
              ? tr('دائم', 'Persistant', 'Durable')
              : tr('في الذاكرة', 'En mémoire', 'In memory')}
          </PropertyRow>
        </Card>
      </Section>

      <Section title={tr('هذا التطبيق', 'Cette application', 'This app')}>
        <Card padded>
          <PropertyRow label={tr('المعرّف', 'Identifiant', 'App id')} mono>
            {runtime.appId}
          </PropertyRow>
          <PropertyRow label={tr('العملية', 'Processus', 'Process')} mono>
            {String(runtime.pid)}
          </PropertyRow>
          <PropertyRow label={tr('الإصدار', 'Version', 'Version')} mono>
            {runtime.manifest.version}
          </PropertyRow>
          <PropertyRow label={tr('الناشر', 'Éditeur', 'Publisher')}>{runtime.manifest.publisher}</PropertyRow>
          <div style={{ paddingTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {runtime.manifest.capabilities.map((capability) => (
              <Badge key={capability} tone="neutral" title={capability}>
                {t(capabilityLabel(capability))}
              </Badge>
            ))}
          </div>
        </Card>
      </Section>

      <InfoBar
        tone="info"
        title={tr('حدود التطبيق', 'Périmètre de l’application', 'What this app can reach')}
      >
        {tr(
          'كل ما تفعله هذه الصفحات يمر عبر نداءات النظام المعلنة في البيان أعلاه، ولا شيء غير ذلك.',
          'Tout ce que font ces pages passe par les appels système déclarés ci-dessus, et rien d’autre.',
          'Everything on these pages goes through the syscalls declared above, and nothing else.',
        )}
      </InfoBar>
    </div>
  );
}
