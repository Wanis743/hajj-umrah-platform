/**
 * Registry Editor — manifest.
 *
 * The one app in the image that asks for `registry.write` as its *purpose* rather
 * than to remember a window size. The capability is privileged, so every write
 * that lands in `HKLM` raises the kernel's consent dialog before the value moves;
 * `HKCU` is exempt, which is why the app carries its own confirmation for deletes
 * — see the note in `App.tsx`.
 *
 * `fs.write` is File ▸ Export, which writes a `.reg` file of the selected subtree
 * into Documents. `clipboard` is Copy Key Name, the one thing everybody uses
 * regedit for. There is no `fs.read`: importing a `.reg` file would mean replaying
 * arbitrary writes into the hive, and nothing in this OS needs that.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS, REG } from '@/platform/kernel/abi';

export const registryEditorManifest = defineApp({
  id: APP_IDS.registryEditor,
  name: text('محرّر السجل', 'Éditeur du Registre', 'Registry Editor'),
  description: text(
    'تحرير مفاتيح النظام والمستخدم',
    'Modifier les clés machine et utilisateur',
    'Inspect and edit machine and user keys',
  ),
  category: 'system',
  icon: 'database',
  capabilities: ['registry.read', 'registry.write', 'fs.write', 'clipboard', 'notify', 'window.manage'],
  defaultSize: { w: 1040, h: 660 },
  minSize: { w: 680, h: 440 },
  keywords: ['registry', 'regedit', 'hive', 'key', 'hklm', 'hkcu', 'registre', 'clé', 'سجل', 'مفتاح'],
  jumpList: [
    { id: `goto:${REG.userAppearance}`, title: text('المظهر', 'Apparence', 'Appearance') },
    { id: `goto:${REG.machinePolicy}`, title: text('السياسات', 'Stratégies', 'Policy') },
    { id: `goto:${REG.machineServices}`, title: text('الخدمات', 'Services', 'Services') },
  ],
  commands: [
    { id: `goto:${REG.userAppearance}`, title: text('مفاتيح المظهر', 'Clés d’apparence', 'Appearance keys') },
    { id: `goto:${REG.userDesktop}`, title: text('مفاتيح سطح المكتب', 'Clés du bureau', 'Desktop keys') },
    { id: `goto:${REG.machinePolicy}`, title: text('مفاتيح السياسات', 'Clés de stratégie', 'Policy keys') },
    { id: `goto:${REG.machineApps}`, title: text('مفاتيح التطبيقات', 'Clés des applications', 'App inventory keys') },
    { id: 'find', title: text('بحث في السجل', 'Rechercher dans le Registre', 'Find in registry') },
  ],
});
