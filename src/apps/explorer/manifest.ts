/**
 * File Explorer — manifest.
 *
 * The file manager is the one app that has to be able to reach every volume, so
 * it asks for `fs.write` as well as `fs.read`, and for `shell.launch` because
 * double-clicking a file is a launch of whatever app claims that content type.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const explorerManifest = defineApp({
  id: APP_IDS.explorer,
  name: text('مستكشف الملفات', 'Explorateur de fichiers', 'File Explorer'),
  description: text(
    'استعراض المجلدات والمستندات على وحدات التخزين',
    'Parcourir les dossiers et documents des volumes montés',
    'Browse folders and documents across mounted volumes',
  ),
  category: 'productivity',
  icon: 'folder',
  capabilities: ['fs.read', 'fs.write', 'registry.read', 'clipboard', 'notify', 'shell.launch'],
  defaultSize: { w: 1020, h: 640 },
  minSize: { w: 620, h: 380 },
  singleInstance: false,
  pinned: true,
  desktopShortcut: true,
  keywords: ['files', 'folder', 'explorer', 'documents', 'fichiers', 'dossier', 'ملفات', 'مجلد'],
  jumpList: [
    { id: 'go:home', title: text('المجلد الرئيسي', 'Dossier personnel', 'Home folder') },
    { id: 'go:documents', title: text('المستندات', 'Documents', 'Documents') },
    { id: 'go:reports', title: text('التقارير', 'Rapports', 'Reports') },
    { id: 'go:ledger', title: text('مشروع الدفتر (L:)', 'Projection du grand livre (L:)', 'Ledger projection (L:)') },
  ],
  commands: [
    { id: 'new-folder', title: text('مجلد جديد', 'Nouveau dossier', 'New folder'), accelerator: 'Ctrl+Shift+N' },
    { id: 'new-file', title: text('ملف نصي جديد', 'Nouveau fichier texte', 'New text file') },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'go:home', title: text('الانتقال للمجلد الرئيسي', 'Aller au dossier personnel', 'Go to home folder') },
  ],
});
