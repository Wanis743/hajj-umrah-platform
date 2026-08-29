/**
 * Task Manager — manifest.
 *
 * `process.terminate` and `service.control` are both privileged, so ending a
 * task or stopping a service raises a consent prompt. That is intentional: the
 * app asks for the capability, the kernel decides.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const taskManagerManifest = defineApp({
  id: APP_IDS.taskManager,
  name: text('مدير المهام', 'Gestionnaire des tâches', 'Task Manager'),
  description: text(
    'العمليات والأداء والخدمات والنوافذ في الوقت الحقيقي',
    'Processus, performances, services et fenêtres en temps réel',
    'Live processes, performance, services and windows',
  ),
  category: 'system',
  icon: 'cpu',
  capabilities: ['process.enumerate', 'process.terminate', 'service.control', 'eventlog.read', 'notify', 'window.manage', 'registry.read'],
  defaultSize: { w: 1000, h: 640 },
  minSize: { w: 640, h: 420 },
  keywords: ['task', 'manager', 'processes', 'performance', 'services', 'tâches', 'مهام', 'عمليات'],
  jumpList: [
    { id: 'tab:processes', title: text('العمليات', 'Processus', 'Processes') },
    { id: 'tab:performance', title: text('الأداء', 'Performances', 'Performance') },
    { id: 'tab:services', title: text('الخدمات', 'Services', 'Services') },
  ],
  commands: [
    { id: 'tab:processes', title: text('عرض العمليات', 'Afficher les processus', 'Show processes') },
    { id: 'tab:performance', title: text('عرض الأداء', 'Afficher les performances', 'Show performance') },
    { id: 'tab:services', title: text('عرض الخدمات', 'Afficher les services', 'Show services') },
  ],
});
