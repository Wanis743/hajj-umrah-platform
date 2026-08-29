/**
 * Terminal — manifest.
 *
 * The terminal is the administrator's tool, so it asks for everything an
 * administrator does: the privileged capabilities in this list are exactly the
 * ones the dispatcher will stop and demand elevation for, which is the point —
 * `kill`, `sc stop` and `reg add` should raise a consent prompt here just as
 * they raise one in Task Manager.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const terminalManifest = defineApp({
  id: APP_IDS.terminal,
  name: text('الطرفية', 'Terminal', 'Terminal'),
  description: text(
    'صدفة أوامر على نظام الملفات والعمليات والخدمات والسجل',
    'Shell de commandes sur le système de fichiers, les processus et les services',
    'Command shell over the file system, processes, services and registry',
  ),
  category: 'system',
  icon: 'terminal',
  capabilities: [
    'fs.read',
    'fs.write',
    'registry.read',
    'registry.write',
    'process.enumerate',
    'process.terminate',
    'service.control',
    'eventlog.read',
    'eventlog.write',
    'ledger.read',
    'clipboard',
    'notify',
    'shell.launch',
  ],
  defaultSize: { w: 900, h: 560 },
  minSize: { w: 480, h: 300 },
  singleInstance: false,
  pinned: true,
  keywords: ['terminal', 'shell', 'cmd', 'console', 'commande', 'طرفية', 'أوامر'],
  jumpList: [
    { id: 'cwd:home', title: text('المجلد الرئيسي', 'Dossier personnel', 'Home folder') },
    { id: 'cwd:system', title: text('System32', 'System32', 'System32') },
  ],
  commands: [
    { id: 'clear', title: text('مسح الشاشة', 'Effacer l’écran', 'Clear screen'), accelerator: 'Ctrl+L' },
    { id: 'cwd:home', title: text('الانتقال للمجلد الرئيسي', 'Aller au dossier personnel', 'Go to home folder') },
  ],
});
