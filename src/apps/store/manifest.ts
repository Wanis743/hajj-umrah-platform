/**
 * Store — manifest.
 *
 * The installed-software inventory, made visible. Not a shopfront: there is no
 * network behind this image, so the Store never invents a download size, a
 * rating or a screenshot. What it shows instead is everything the OS actually
 * knows about an app — version, publisher, the capabilities it was installed
 * with, the file types it claims, how often it has been launched — and lets the
 * user pin it, open it, remove it or put it back.
 *
 * The capability list is the interesting part of this manifest. `registry.read`
 * reads the inventory (it is the `HKLM\SOFTWARE\FinanceOS\Apps` hive, so that is
 * exactly what reading it costs); `registry.write` is what makes installing and
 * removing raise a consent prompt, which is the kernel's job and not this app's;
 * `settings.write` covers taskbar pins and this window's own view state;
 * `eventlog.read` is what turns the Setup channel into a real install history
 * rather than a made-up one.
 */
import { APP_IDS } from '@/platform/kernel/abi';
import { defineApp, text } from '../shared/manifest';

export const storeManifest = defineApp({
  id: APP_IDS.store,
  name: text('المتجر', 'Boutique', 'Store'),
  description: text(
    'إدارة التطبيقات المثبتة وأذوناتها وتثبيتها على شريط المهام',
    'Gérer les applications installées, leurs autorisations et leurs épingles',
    'Manage installed apps, their permissions and their taskbar pins',
  ),
  category: 'system',
  icon: 'store',
  capabilities: ['registry.read', 'registry.write', 'settings.write', 'shell.launch', 'notify', 'eventlog.read'],
  defaultSize: { w: 1120, h: 740 },
  minSize: { w: 620, h: 480 },
  keywords: [
    'store',
    'apps',
    'install',
    'uninstall',
    'permissions',
    'capabilities',
    'pin',
    'boutique',
    'applications',
    'installer',
    'désinstaller',
    'autorisations',
    'épingler',
    'متجر',
    'تطبيقات',
    'تثبيت',
    'إزالة',
    'أذونات',
  ],
  jumpList: [
    { id: 'catalogue', title: text('كل التطبيقات', 'Toutes les applications', 'All apps') },
    { id: 'installed', title: text('المثبتة', 'Installées', 'Installed') },
    { id: 'library', title: text('المكتبة', 'Bibliothèque', 'Library') },
  ],
  commands: [
    { id: 'catalogue', title: text('استعراض التطبيقات', 'Parcourir les applications', 'Browse apps') },
    { id: 'installed', title: text('التطبيقات المثبتة', 'Applications installées', 'Installed apps') },
    { id: 'library', title: text('التطبيقات المزالة', 'Applications supprimées', 'Removed apps') },
    { id: 'history', title: text('سجل التثبيت', 'Historique d’installation', 'Install history') },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
  ],
});
