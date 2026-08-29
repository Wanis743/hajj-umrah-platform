/**
 * Task Manager — the four pages.
 *
 * Each page polls only what it shows, so the Performance graph does not cost
 * anything while you are looking at Services. The kernel is the only source:
 * there is no local model of a process here, which is why a process that the
 * scheduler suspends turns grey without this file being told.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  AppWindow,
  Ban,
  Cpu,
  Layout,
  Pause,
  Play,
  RotateCw,
  Server,
  Square,
  Wrench,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  type AppLocale,
  type Column,
  DataGrid,
  DonutChart,
  EmptyState,
  InfoBar,
  KpiTile,
  LineChart,
  MenuFlyout,
  Meter,
  type ProcessInfo,
  type ProcessMetrics,
  type ProcessPriority,
  PropertyRow,
  Select,
  type ServiceInfo,
  type ServiceStartType,
  type SnapZone,
  StatusItem,
  type Tone,
  ToolbarSeparator,
  type WindowInfo,
  fmt,
  useApp,
  useContextMenu,
  usePolledSyscall,
} from '@/platform/sdk';

/** One second is what Windows uses for its normal update speed. */
const FAST_MS = 1000;
const SLOW_MS = 2500;

const KIND_ICON = {
  application: AppWindow,
  service: Server,
  system: Cpu,
  shell: Layout,
} as const;

const STATE_TONE: Readonly<Record<ProcessInfo['state'], Tone>> = {
  starting: 'info',
  running: 'success',
  suspended: 'warning',
  notResponding: 'danger',
  terminated: 'neutral',
};

const SERVICE_TONE: Readonly<Record<ServiceInfo['state'], Tone>> = {
  stopped: 'neutral',
  starting: 'info',
  running: 'success',
  stopping: 'info',
  faulted: 'danger',
};

const PRIORITIES: readonly ProcessPriority[] = ['realtime', 'high', 'normal', 'low', 'idle'];

interface ProcessRow {
  readonly info: ProcessInfo;
  readonly metric: ProcessMetrics | null;
}

interface Totals {
  readonly cpu: number;
  readonly memory: number;
  readonly handles: number;
}

/**
 * Column tables live at module scope: they are pure functions of the locale and
 * the footer totals, and keeping them out of the components is what lets each
 * panel body stay short enough to read in one screen.
 */
function processColumns(locale: AppLocale, totals: Totals): readonly Column<ProcessRow>[] {
  const { tr, t, lang } = locale;
  return [
    {
      id: 'name',
      header: tr('الاسم', 'Nom', 'Name'),
      sort: (a, b) => t(a.info.name).localeCompare(t(b.info.name)),
      render: (row) => {
        const Glyph = KIND_ICON[row.info.kind];
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Glyph size={15} style={{ flex: 'none', color: 'var(--fx-text-secondary)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(row.info.name)}</span>
            {row.info.elevated ? <Badge tone="warning">{tr('مرقّى', 'Élevé', 'Elevated')}</Badge> : null}
          </span>
        );
      },
    },
    { id: 'pid', header: 'PID', width: 72, align: 'end', mono: true, sort: (a, b) => a.info.pid - b.info.pid, render: (row) => String(row.info.pid) },
    {
      id: 'state',
      header: tr('الحالة', 'État', 'Status'),
      width: 120,
      sort: (a, b) => a.info.state.localeCompare(b.info.state),
      render: (row) => <Badge tone={STATE_TONE[row.info.state]}>{row.info.state}</Badge>,
    },
    {
      id: 'cpu',
      header: 'CPU',
      width: 84,
      align: 'end',
      mono: true,
      sort: (a, b) => (a.metric?.cpuPercent ?? 0) - (b.metric?.cpuPercent ?? 0),
      render: (row) => `${(row.metric?.cpuPercent ?? 0).toFixed(1)}%`,
      footer: `${totals.cpu.toFixed(1)}%`,
    },
    {
      id: 'memory',
      header: tr('الذاكرة', 'Mémoire', 'Memory'),
      width: 104,
      align: 'end',
      mono: true,
      sort: (a, b) => (a.metric?.memoryBytes ?? 0) - (b.metric?.memoryBytes ?? 0),
      render: (row) => fmt.bytes(row.metric?.memoryBytes ?? 0, lang),
      footer: fmt.bytes(totals.memory, lang),
    },
    {
      id: 'handles',
      header: tr('المقابض', 'Handles', 'Handles'),
      width: 90,
      align: 'end',
      mono: true,
      sort: (a, b) => a.info.handleCount - b.info.handleCount,
      render: (row) => fmt.integer(row.info.handleCount, lang),
      footer: fmt.integer(totals.handles, lang),
    },
    {
      id: 'syscalls',
      header: tr('النداءات', 'Appels', 'Syscalls'),
      width: 100,
      align: 'end',
      mono: true,
      sort: (a, b) => (a.metric?.syscalls ?? 0) - (b.metric?.syscalls ?? 0),
      render: (row) => fmt.integer(row.metric?.syscalls ?? 0, lang),
    },
    {
      id: 'peak',
      header: tr('أطول إطار', 'Trame max', 'Peak frame'),
      width: 104,
      align: 'end',
      mono: true,
      sort: (a, b) => (a.metric?.peakFrameMs ?? 0) - (b.metric?.peakFrameMs ?? 0),
      render: (row) => `${(row.metric?.peakFrameMs ?? 0).toFixed(1)} ms`,
    },
  ];
}

/** Shared action row: same geometry on every page. */
function ActionRow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--fx-divider)',
      }}
    >
      {children}
    </div>
  );
}

export function ProcessesPanel() {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const processes = usePolledSyscall('process.list', {}, FAST_MS);
  const metrics = usePolledSyscall('process.metrics', {}, FAST_MS);
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const menu = useContextMenu<ProcessRow | null>();

  const rows = useMemo<readonly ProcessRow[]>(() => {
    const byPid = new Map((metrics.data ?? []).map((metric) => [String(metric.pid), metric]));
    return (processes.data ?? []).map((info) => ({ info, metric: byPid.get(String(info.pid)) ?? null }));
  }, [metrics.data, processes.data]);

  const selected = rows.filter((row) => selection.has(String(row.info.pid)));

  const act = async (row: ProcessRow, action: 'end' | 'suspend' | 'resume' | ProcessPriority) => {
    const result =
      action === 'end'
        ? await runtime.invoke('process.terminate', { pid: row.info.pid, force: true })
        : action === 'suspend'
          ? await runtime.invoke('process.suspend', { pid: row.info.pid })
          : action === 'resume'
            ? await runtime.invoke('process.resume', { pid: row.info.pid })
            : await runtime.invoke('process.setPriority', { pid: row.info.pid, priority: action });
    if (!result.ok) {
      await runtime.toast({
        kind: 'error',
        title: tr('تعذّر تنفيذ الإجراء', 'Action impossible', 'The action did not complete'),
        body: result.error.message,
      });
    }
    processes.refresh();
  };

  const endSelected = async () => {
    if (selected.length === 0) return;
    const confirmed = await runtime.confirm({
      kind: 'warning',
      destructive: true,
      title: tr('إنهاء المهمة', 'Terminer la tâche', 'End task'),
      body: tr(
        `سيُفقد أي عمل غير محفوظ في ${selected.length} عملية.`,
        `Tout travail non enregistré dans ${selected.length} processus sera perdu.`,
        `Unsaved work in ${selected.length} process(es) will be lost.`,
      ),
    });
    if (!confirmed) return;
    for (const row of selected) await act(row, 'end');
    setSelection(new Set());
  };

  const totals = useMemo(
    () => ({
      cpu: rows.reduce((sum, row) => sum + (row.metric?.cpuPercent ?? 0), 0),
      memory: rows.reduce((sum, row) => sum + (row.metric?.memoryBytes ?? 0), 0),
      handles: rows.reduce((sum, row) => sum + row.info.handleCount, 0),
    }),
    [rows],
  );

  const columns = useMemo(() => processColumns(runtime.locale, totals), [runtime.locale, totals]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ActionRow>
        <Button icon={Ban} variant="danger" size="sm" disabled={selected.length === 0} onClick={() => void endSelected()}>
          {tr('إنهاء المهمة', 'Terminer la tâche', 'End task')}
        </Button>
        <Button
          icon={Pause}
          variant="subtle"
          size="sm"
          disabled={selected.length !== 1 || selected[0].info.state !== 'running'}
          onClick={() => void act(selected[0], 'suspend')}
        >
          {tr('تعليق', 'Suspendre', 'Suspend')}
        </Button>
        <Button
          icon={Play}
          variant="subtle"
          size="sm"
          disabled={selected.length !== 1 || selected[0].info.state !== 'suspended'}
          onClick={() => void act(selected[0], 'resume')}
        >
          {tr('استئناف', 'Reprendre', 'Resume')}
        </Button>
        <div style={{ flex: 1 }} />
        <Button icon={RotateCw} variant="subtle" size="sm" onClick={() => { processes.refresh(); metrics.refresh(); }} />
      </ActionRow>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(row) => String(row.info.pid)}
          selectedKeys={selection}
          onSelectionChange={setSelection}
          onRowContextMenu={(row, event) => menu.open(event, row)}
          rowTone={(row) => (row.info.state === 'suspended' ? 'warning' : row.info.state === 'notResponding' ? 'danger' : undefined)}
          initialSort={{ columnId: 'cpu', direction: 'desc' }}
          density="compact"
          rowHeight={30}
          virtualized
          showFooter
          loading={processes.data === null}
          empty={<EmptyState icon={Cpu} title={tr('لا عمليات', 'Aucun processus', 'No processes')} />}
        />
      </div>
      {menu.menu !== null && menu.menu.target !== null ? (
        <MenuFlyout
          position="fixed"
          x={menu.menu.x}
          y={menu.menu.y}
          entries={[
            { id: 'end', label: tr('إنهاء المهمة', 'Terminer la tâche', 'End task'), icon: Ban, danger: true },
            { id: 'suspend', label: tr('تعليق', 'Suspendre', 'Suspend'), icon: Pause, disabled: menu.menu.target.info.state !== 'running' },
            { id: 'resume', label: tr('استئناف', 'Reprendre', 'Resume'), icon: Play, disabled: menu.menu.target.info.state !== 'suspended' },
            { id: 'sep', kind: 'separator' },
            {
              id: 'priority',
              label: tr('الأولوية', 'Priorité', 'Priority'),
              icon: Wrench,
              submenu: PRIORITIES.map((priority) => ({
                id: `priority:${priority}`,
                label: priority,
                checked: menu.menu?.target?.info.priority === priority,
              })),
            },
          ]}
          onDismiss={menu.close}
          onSelect={(id) => {
            const target = menu.menu?.target;
            if (target == null) return;
            const priority = PRIORITIES.find((candidate) => id === `priority:${candidate}`);
            if (priority !== undefined) void act(target, priority);
            else if (id === 'end' || id === 'suspend' || id === 'resume') void act(target, id);
            menu.close();
          }}
        />
      ) : null}
    </div>
  );
}
/**
 * Performance. One graph per resource, the way Windows splits CPU from memory:
 * a shared y-axis would flatten a 0–100 percentage against a syscall rate in
 * the hundreds. `history` is the kernel's own ring buffer — this panel keeps no
 * samples of its own, so the graph is empty on first paint and never stale.
 */
export function PerformancePanel() {
  const { tr, lang } = useApp().locale;
  const metrics = usePolledSyscall('system.metrics', {}, FAST_MS);
  const data = metrics.data;

  const graph = useMemo(() => {
    const history = data?.history ?? [];
    return {
      categories: history.map((sample) => fmt.time(sample.at, lang)),
      cpu: history.map((sample) => sample.cpuPercent),
      syscalls: history.map((sample) => sample.syscallRate),
      io: history.map((sample) => sample.ioBytes / 1024),
    };
  }, [data?.history, lang]);

  if (data === null) {
    return <EmptyState icon={Cpu} title={tr('جارٍ القياس…', 'Mesure…', 'Sampling…')} />;
  }

  const freeBytes = Math.max(0, data.memoryLimitBytes - data.memoryBytes);

  return (
    <div style={{ display: 'grid', gap: 12, padding: 12, alignContent: 'start' }}>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))' }}>
        <KpiTile
          icon={Cpu}
          label={tr('المعالج', 'Processeur', 'CPU')}
          value={`${data.cpuPercent.toFixed(1)}%`}
          secondary={tr(`${data.tickRate.toFixed(0)} نبضة/ث`, `${data.tickRate.toFixed(0)} ticks/s`, `${data.tickRate.toFixed(0)} ticks/s`)}
          tone={data.cpuPercent > 85 ? 'danger' : data.cpuPercent > 60 ? 'warning' : 'accent'}
        />
        <KpiTile
          icon={Server}
          label={tr('الذاكرة', 'Mémoire', 'Memory')}
          value={fmt.bytes(data.memoryBytes, lang)}
          secondary={`/ ${fmt.bytes(data.memoryLimitBytes, lang)}`}
          tone="info"
        />
        <KpiTile
          icon={AppWindow}
          label={tr('العمليات', 'Processus', 'Processes')}
          value={fmt.integer(data.processCount, lang)}
          secondary={tr(`${data.threadCount} خيطًا`, `${data.threadCount} threads`, `${data.threadCount} threads`)}
          tone="success"
        />
        <KpiTile
          icon={Wrench}
          label={tr('النداءات/ث', 'Appels/s', 'Syscalls/s')}
          value={fmt.integer(Math.round(data.syscallRate), lang)}
          secondary={tr(`${data.handleCount} مقبضًا`, `${data.handleCount} handles`, `${data.handleCount} handles`)}
          tone="neutral"
        />
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Card title={tr('استخدام المعالج', 'Utilisation du processeur', 'CPU utilisation')} subtitle="0 – 100 %">
          <LineChart
            categories={graph.categories}
            series={[{ label: 'CPU', values: graph.cpu, color: 'var(--fx-accent)' }]}
            height={190}
            format={(value) => `${value.toFixed(0)}%`}
            legend={false}
          />
        </Card>
        <Card title={tr('الإنتاجية', 'Débit', 'Throughput')} subtitle={tr('نداءات/ث و ك.بايت', 'appels/s et Kio', 'syscalls/s and KiB')}>
          <LineChart
            categories={graph.categories}
            series={[
              { label: tr('نداءات', 'Appels', 'Syscalls'), values: graph.syscalls },
              { label: tr('دخل/خرج (ك.بايت)', 'E/S (Kio)', 'I/O (KiB)'), values: graph.io, dashed: true },
            ]}
            height={190}
            format={(value) => value.toFixed(0)}
          />
        </Card>
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <Card title={tr('تخصيص الذاكرة', 'Allocation mémoire', 'Memory allocation')}>
          <DonutChart
            slices={[
              { label: tr('مستخدمة', 'Utilisée', 'In use'), value: data.memoryBytes, color: 'var(--fx-accent)' },
              { label: tr('حرة', 'Libre', 'Free'), value: freeBytes, color: 'var(--fx-divider)' },
            ]}
            size={148}
            center={fmt.percent(data.memoryLimitBytes === 0 ? 0 : data.memoryBytes / data.memoryLimitBytes, lang, 0)}
            format={(value) => fmt.bytes(value, lang)}
          />
        </Card>
        <Card title={tr('حالة النظام', 'État du système', 'System state')}>
          <div style={{ display: 'grid', gap: 2 }}>
            <PropertyRow label={tr('مدة التشغيل', 'Disponibilité', 'Up time')} mono>
              {fmt.duration(data.uptimeMs, lang)}
            </PropertyRow>
            <PropertyRow label={tr('آخر قياس', 'Dernier relevé', 'Last sample')} mono>
              {fmt.time(data.sampledAt, lang)}
            </PropertyRow>
            <PropertyRow label={tr('الخيوط', 'Threads', 'Threads')} mono>
              {fmt.integer(data.threadCount, lang)}
            </PropertyRow>
            <PropertyRow label={tr('المقابض', 'Handles', 'Handles')} mono>
              {fmt.integer(data.handleCount, lang)}
            </PropertyRow>
            <div style={{ paddingTop: 8 }}>
              <Meter
                value={data.memoryBytes}
                max={Math.max(1, data.memoryLimitBytes)}
                tone={data.memoryBytes / Math.max(1, data.memoryLimitBytes) > 0.85 ? 'danger' : 'accent'}
                label={tr('الذاكرة المستخدمة', 'Mémoire utilisée', 'Memory in use')}
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
const START_TYPES: readonly ServiceStartType[] = ['automatic', 'automaticDelayed', 'manual', 'disabled'];

function serviceColumns(locale: AppLocale): readonly Column<ServiceInfo>[] {
  const { tr, t, lang } = locale;
  return [
    {
      id: 'name',
      header: tr('الاسم', 'Nom', 'Name'),
      width: 190,
      mono: true,
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (service) => service.name,
    },
    {
      id: 'display',
      header: tr('الوصف', 'Description', 'Description'),
      sort: (a, b) => t(a.display).localeCompare(t(b.display)),
      render: (service) => (
        <span title={t(service.description)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t(service.display)}
        </span>
      ),
    },
    {
      id: 'state',
      header: tr('الحالة', 'État', 'Status'),
      width: 110,
      sort: (a, b) => a.state.localeCompare(b.state),
      render: (service) => <Badge tone={SERVICE_TONE[service.state]}>{service.state}</Badge>,
    },
    {
      id: 'startType',
      header: tr('بدء التشغيل', 'Démarrage', 'Startup'),
      width: 132,
      sort: (a, b) => a.startType.localeCompare(b.startType),
      render: (service) => service.startType,
    },
    {
      id: 'pid',
      header: 'PID',
      width: 68,
      align: 'end',
      mono: true,
      sort: (a, b) => (a.pid ?? 0) - (b.pid ?? 0),
      render: (service) => (service.pid === null ? '—' : String(service.pid)),
    },
    {
      id: 'work',
      header: tr('أعمال منجزة', 'Traitements', 'Work done'),
      width: 108,
      align: 'end',
      mono: true,
      sort: (a, b) => a.workCompleted - b.workCompleted,
      render: (service) => fmt.integer(service.workCompleted, lang),
    },
    {
      id: 'restarts',
      header: tr('إعادات', 'Redémarr.', 'Restarts'),
      width: 88,
      align: 'end',
      mono: true,
      sort: (a, b) => a.restarts - b.restarts,
      render: (service) => fmt.integer(service.restarts, lang),
    },
    {
      id: 'tick',
      header: tr('آخر نبضة', 'Dernier tick', 'Last tick'),
      width: 96,
      align: 'end',
      mono: true,
      render: (service) => (service.lastTickAt === null ? '—' : fmt.time(service.lastTickAt, lang)),
    },
  ];
}

/**
 * Services. `service.control` is privileged, so the first Stop of a session
 * raises a consent prompt; the panel does not pre-check the capability because
 * the kernel's answer is the only one that counts.
 */
export function ServicesPanel() {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const services = usePolledSyscall('service.list', {}, SLOW_MS);
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const menu = useContextMenu<ServiceInfo | null>();

  const rows = services.data ?? [];
  const selected = rows.find((service) => selection.has(service.name)) ?? null;

  const control = async (service: ServiceInfo, action: 'start' | 'stop' | 'restart' | ServiceStartType) => {
    const result =
      action === 'start'
        ? await runtime.invoke('service.start', { name: service.name })
        : action === 'stop'
          ? await runtime.invoke('service.stop', { name: service.name })
          : action === 'restart'
            ? await runtime.invoke('service.restart', { name: service.name })
            : await runtime.invoke('service.setStartType', { name: service.name, startType: action });
    if (!result.ok) {
      await runtime.toast({
        kind: 'error',
        title: tr('تعذّر التحكم في الخدمة', 'Contrôle du service impossible', 'Service control failed'),
        body: result.error.message,
      });
    }
    services.refresh();
  };

  const columns = useMemo(() => serviceColumns(runtime.locale), [runtime.locale]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ActionRow>
        <Button
          icon={Play}
          variant="subtle"
          size="sm"
          disabled={selected === null || selected.state === 'running' || selected.state === 'starting'}
          onClick={() => selected !== null && void control(selected, 'start')}
        >
          {tr('تشغيل', 'Démarrer', 'Start')}
        </Button>
        <Button
          icon={Square}
          variant="subtle"
          size="sm"
          disabled={selected === null || selected.state === 'stopped'}
          onClick={() => selected !== null && void control(selected, 'stop')}
        >
          {tr('إيقاف', 'Arrêter', 'Stop')}
        </Button>
        <Button
          icon={RotateCw}
          variant="subtle"
          size="sm"
          disabled={selected === null}
          onClick={() => selected !== null && void control(selected, 'restart')}
        >
          {tr('إعادة تشغيل', 'Redémarrer', 'Restart')}
        </Button>
        <ToolbarSeparator />
        <Select
          value={selected?.startType ?? 'manual'}
          disabled={selected === null}
          width={168}
          options={START_TYPES.map((startType) => ({ value: startType, label: startType }))}
          onChange={(next) => {
            const startType = START_TYPES.find((candidate) => candidate === next);
            if (selected !== null && startType !== undefined) void control(selected, startType);
          }}
        />
        <div style={{ flex: 1 }} />
        <Button icon={RotateCw} variant="subtle" size="sm" onClick={services.refresh} />
      </ActionRow>
      {selected !== null && selected.lastError !== null ? (
        <div style={{ padding: '8px 12px' }}>
          <InfoBar tone="danger" title={tr('آخر خطأ', 'Dernière erreur', 'Last error')}>
            {selected.lastError}
          </InfoBar>
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(service) => service.name}
          selectedKeys={selection}
          onSelectionChange={setSelection}
          onRowContextMenu={(service, event) => menu.open(event, service)}
          rowTone={(service) => (service.state === 'faulted' ? 'danger' : service.state === 'stopped' ? undefined : 'success')}
          initialSort={{ columnId: 'name', direction: 'asc' }}
          density="compact"
          rowHeight={30}
          virtualized
          loading={services.data === null}
          empty={<EmptyState icon={Server} title={tr('لا خدمات', 'Aucun service', 'No services')} />}
        />
      </div>
      {menu.menu !== null && menu.menu.target !== null ? (
        <MenuFlyout
          position="fixed"
          x={menu.menu.x}
          y={menu.menu.y}
          entries={[
            { id: 'start', label: tr('تشغيل', 'Démarrer', 'Start'), icon: Play, disabled: menu.menu.target.state === 'running' },
            { id: 'stop', label: tr('إيقاف', 'Arrêter', 'Stop'), icon: Square, disabled: menu.menu.target.state === 'stopped' },
            { id: 'restart', label: tr('إعادة تشغيل', 'Redémarrer', 'Restart'), icon: RotateCw },
            { id: 'sep', kind: 'separator' },
            {
              id: 'startType',
              label: tr('نوع البدء', 'Type de démarrage', 'Startup type'),
              icon: Wrench,
              submenu: START_TYPES.map((startType) => ({
                id: `startType:${startType}`,
                label: startType,
                checked: menu.menu?.target?.startType === startType,
              })),
            },
          ]}
          onDismiss={menu.close}
          onSelect={(id) => {
            const target = menu.menu?.target;
            if (target == null) return;
            const startType = START_TYPES.find((candidate) => id === `startType:${candidate}`);
            if (startType !== undefined) void control(target, startType);
            else if (id === 'start' || id === 'stop' || id === 'restart') void control(target, id);
            menu.close();
          }}
        />
      ) : null}
    </div>
  );
}
const SNAP_ZONES: readonly SnapZone[] = ['left', 'right', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'leftTwoThirds', 'rightThird'];

function windowColumns(locale: AppLocale): readonly Column<WindowInfo>[] {
  const { tr, lang } = locale;
  return [
    {
      id: 'title',
      header: tr('العنوان', 'Titre', 'Title'),
      sort: (a, b) => a.title.localeCompare(b.title),
      render: (info) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Layout size={15} style={{ flex: 'none', color: 'var(--fx-text-secondary)' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.title}</span>
          {info.dirty ? <Badge tone="warning">{tr('غير محفوظ', 'Non enregistré', 'Unsaved')}</Badge> : null}
          {info.focused ? <Badge tone="accent">{tr('نشط', 'Actif', 'Focused')}</Badge> : null}
        </span>
      ),
    },
    {
      id: 'appId',
      header: tr('التطبيق', 'Application', 'App'),
      width: 150,
      mono: true,
      sort: (a, b) => a.appId.localeCompare(b.appId),
      render: (info) => info.appId,
    },
    { id: 'pid', header: 'PID', width: 68, align: 'end', mono: true, sort: (a, b) => a.pid - b.pid, render: (info) => String(info.pid) },
    {
      id: 'state',
      header: tr('الحالة', 'État', 'State'),
      width: 108,
      sort: (a, b) => a.state.localeCompare(b.state),
      render: (info) => <Badge tone={info.state === 'minimized' ? 'neutral' : 'info'}>{info.state}</Badge>,
    },
    { id: 'zone', header: tr('المنطقة', 'Zone', 'Zone'), width: 118, render: (info) => info.zone ?? '—' },
    {
      id: 'rect',
      header: tr('الأبعاد', 'Géométrie', 'Geometry'),
      width: 150,
      mono: true,
      sort: (a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h,
      render: (info) => `${Math.round(info.rect.w)}×${Math.round(info.rect.h)} @ ${Math.round(info.rect.x)},${Math.round(info.rect.y)}`,
    },
    { id: 'z', header: 'Z', width: 56, align: 'end', mono: true, sort: (a, b) => a.z - b.z, render: (info) => fmt.integer(info.z, lang) },
  ];
}

/**
 * Windows. The old Task Manager's "Applications" tab, kept honest: geometry is
 * read out of the window manager rather than measured from the DOM, so a
 * snapped window reports the zone the user picked instead of a pixel guess.
 */
export function WindowsPanel() {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const windows = usePolledSyscall('window.list', {}, FAST_MS);
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const menu = useContextMenu<WindowInfo | null>();

  const rows = windows.data ?? [];
  const selected = rows.find((info) => selection.has(String(info.id))) ?? null;

  const act = async (info: WindowInfo, action: 'close' | SnapZone) => {
    const result =
      action === 'close'
        ? await runtime.invoke('window.close', { window: info.id })
        : await runtime.invoke('window.snap', { window: info.id, zone: action });
    if (!result.ok) {
      await runtime.toast({
        kind: 'error',
        title: tr('تعذّر تنفيذ الإجراء', 'Action impossible', 'Action failed'),
        body: result.error.message,
      });
    }
    windows.refresh();
  };

  const columns = useMemo(() => windowColumns(runtime.locale), [runtime.locale]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ActionRow>
        <Button
          icon={Square}
          variant="danger"
          size="sm"
          disabled={selected === null}
          onClick={() => selected !== null && void act(selected, 'close')}
        >
          {tr('إغلاق النافذة', 'Fermer la fenêtre', 'Close window')}
        </Button>
        <ToolbarSeparator />
        <Select
          value=""
          disabled={selected === null}
          width={186}
          placeholder={tr('محاذاة إلى…', 'Aligner vers…', 'Snap to…')}
          options={SNAP_ZONES.map((zone) => ({ value: zone, label: zone }))}
          onChange={(next) => {
            const zone = SNAP_ZONES.find((candidate) => candidate === next);
            if (selected !== null && zone !== undefined) void act(selected, zone);
          }}
        />
        <div style={{ flex: 1 }} />
        <StatusItem>{tr(`${rows.length} نافذة`, `${rows.length} fenêtre(s)`, `${rows.length} windows`)}</StatusItem>
        <Button icon={RotateCw} variant="subtle" size="sm" onClick={windows.refresh} />
      </ActionRow>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(info) => String(info.id)}
          selectedKeys={selection}
          onSelectionChange={setSelection}
          onRowContextMenu={(info, event) => menu.open(event, info)}
          rowTone={(info) => (info.focused ? 'accent' : undefined)}
          initialSort={{ columnId: 'z', direction: 'desc' }}
          density="compact"
          rowHeight={30}
          virtualized
          loading={windows.data === null}
          empty={<EmptyState icon={Layout} title={tr('لا نوافذ مفتوحة', 'Aucune fenêtre', 'No open windows')} />}
        />
      </div>
      {menu.menu !== null && menu.menu.target !== null ? (
        <MenuFlyout
          position="fixed"
          x={menu.menu.x}
          y={menu.menu.y}
          entries={[
            { id: 'close', label: tr('إغلاق', 'Fermer', 'Close'), icon: Square, danger: true },
            { id: 'sep', kind: 'separator' },
            {
              id: 'snap',
              label: tr('محاذاة', 'Aligner', 'Snap'),
              icon: Layout,
              submenu: SNAP_ZONES.map((zone) => ({
                id: `snap:${zone}`,
                label: zone,
                checked: menu.menu?.target?.zone === zone,
              })),
            },
          ]}
          onDismiss={menu.close}
          onSelect={(id) => {
            const target = menu.menu?.target;
            if (target == null) return;
            const zone = SNAP_ZONES.find((candidate) => id === `snap:${candidate}`);
            if (zone !== undefined) void act(target, zone);
            else if (id === 'close') void act(target, 'close');
            menu.close();
          }}
        />
      ) : null}
    </div>
  );
}
