/**
 * Task Manager — the shell.
 *
 * Four pages behind a Windows 11 nav rail. The only state here is which page is
 * showing, because each page owns its own polling: mounting Performance starts
 * the `system.metrics` timer and unmounting it stops it, so an idle Task Manager
 * costs one syscall per page rather than four.
 */
import { useState } from 'react';
import { Cpu, Layout, type LucideIcon, Server, Table2 } from 'lucide-react';
import {
  AppFrame,
  type AppEntryProps,
  NavGroupLabel,
  NavItem,
  StatusItem,
  ToolbarSpacer,
  useAppCommands,
  usePolledSyscall,
  useWindowTitle,
  fmt,
} from '@/platform/sdk';
import { PerformancePanel, ProcessesPanel, ServicesPanel, WindowsPanel } from './panels';

type Page = 'processes' | 'performance' | 'services' | 'windows';

const PAGES: readonly Page[] = ['processes', 'performance', 'services', 'windows'];

/** The status bar is the one place that keeps a whole-system view. */
const SUMMARY_MS = 2000;

export default function TaskManagerApp({ runtime }: AppEntryProps) {
  const { tr, lang } = runtime.locale;
  const [page, setPage] = useState<Page>('processes');
  const summary = usePolledSyscall('system.metrics', {}, SUMMARY_MS);

  useWindowTitle(tr('مدير المهام', 'Gestionnaire des tâches', 'Task Manager'));

  // Jump-list and palette entries arrive as `tab:<page>`, warm or cold.
  useAppCommands((command) => {
    const requested = PAGES.find((candidate) => command === `tab:${candidate}`);
    if (requested !== undefined) setPage(requested);
  });

  const label: Readonly<Record<Page, string>> = {
    processes: tr('العمليات', 'Processus', 'Processes'),
    performance: tr('الأداء', 'Performances', 'Performance'),
    services: tr('الخدمات', 'Services', 'Services'),
    windows: tr('النوافذ', 'Fenêtres', 'Windows'),
  };

  const icon: Readonly<Record<Page, LucideIcon>> = {
    processes: Table2,
    performance: Cpu,
    services: Server,
    windows: Layout,
  };

  const nav = (
    <>
      <NavGroupLabel>{tr('المراقبة', 'Surveillance', 'Monitoring')}</NavGroupLabel>
      {PAGES.map((candidate) => (
        <NavItem
          key={candidate}
          icon={icon[candidate]}
          label={label[candidate]}
          selected={page === candidate}
          onClick={() => setPage(candidate)}
        />
      ))}
    </>
  );

  const metrics = summary.data;
  const status = (
    <>
      <StatusItem icon={Cpu} tone={metrics !== null && metrics.cpuPercent > 85 ? 'danger' : 'neutral'}>
        {`CPU ${(metrics?.cpuPercent ?? 0).toFixed(1)}%`}
      </StatusItem>
      <StatusItem icon={Server}>{fmt.bytes(metrics?.memoryBytes ?? 0, lang)}</StatusItem>
      <ToolbarSpacer />
      <StatusItem>
        {tr(
          `${metrics?.processCount ?? 0} عملية`,
          `${metrics?.processCount ?? 0} processus`,
          `${metrics?.processCount ?? 0} processes`,
        )}
      </StatusItem>
      <StatusItem title={tr('مدة تشغيل النواة', 'Disponibilité du noyau', 'Kernel up time')}>
        {fmt.duration(metrics?.uptimeMs ?? 0, lang)}
      </StatusItem>
    </>
  );

  return (
    <AppFrame nav={nav} navWidth={188} status={status} scroll={page === 'performance'}>
      {page === 'processes' ? <ProcessesPanel /> : null}
      {page === 'performance' ? <PerformancePanel /> : null}
      {page === 'services' ? <ServicesPanel /> : null}
      {page === 'windows' ? <WindowsPanel /> : null}
    </AppFrame>
  );
}
