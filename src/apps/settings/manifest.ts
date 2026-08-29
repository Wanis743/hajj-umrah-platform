/**
 * Settings — manifest.
 *
 * Everything this app changes lives in the registry, which is why it asks for
 * `registry.write` rather than a bespoke settings capability: the kernel already
 * exempts `HKCU` writes from elevation, so personalisation is quiet while a
 * machine-wide policy edit still raises consent.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const settingsManifest = defineApp({
  id: APP_IDS.settings,
  name: text('الإعدادات', 'Paramètres', 'Settings'),
  description: text(
    'المظهر واللغة والحساب والتخزين والتطبيقات',
    'Apparence, langue, compte, stockage et applications',
    'Appearance, language, account, storage and apps',
  ),
  category: 'system',
  icon: 'settings',
  capabilities: ['registry.read', 'registry.write', 'fs.read', 'process.enumerate', 'notify', 'window.manage', 'power', 'eventlog.read'],
  defaultSize: { w: 1040, h: 680 },
  minSize: { w: 620, h: 440 },
  keywords: ['settings', 'appearance', 'theme', 'language', 'account', 'paramètres', 'إعدادات', 'مظهر'],
  jumpList: [
    { id: 'page:personalization', title: text('التخصيص', 'Personnalisation', 'Personalisation') },
    { id: 'page:language', title: text('اللغة', 'Langue', 'Language') },
    { id: 'page:about', title: text('حول', 'À propos', 'About') },
  ],
  commands: [
    { id: 'page:system', title: text('النظام', 'Système', 'System') },
    { id: 'page:personalization', title: text('التخصيص', 'Personnalisation', 'Personalisation') },
    { id: 'page:language', title: text('اللغة والمنطقة', 'Langue et région', 'Language & region') },
    { id: 'page:storage', title: text('التخزين', 'Stockage', 'Storage') },
    { id: 'page:account', title: text('الحساب', 'Compte', 'Account') },
    { id: 'page:apps', title: text('التطبيقات', 'Applications', 'Apps') },
    { id: 'page:about', title: text('حول النظام', 'À propos', 'About') },
  ],
});
