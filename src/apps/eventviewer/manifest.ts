/**
 * Event Viewer — manifest.
 *
 * `eventlog.write` looks odd on a reader, but clearing a channel is a write and
 * Windows puts Clear Log in Event Viewer rather than in a separate tool. The
 * capability is unprivileged, so the kernel raises no consent prompt — which is
 * exactly why the app asks the question itself before it wipes an audit trail.
 *
 * `fs.write` and `clipboard` are the two export paths: Save As writes a CSV of
 * the filtered view into Documents, Copy puts one record on the clipboard. There
 * is no `fs.read` — this app never opens a file, so it does not ask to.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const eventViewerManifest = defineApp({
  id: APP_IDS.eventViewer,
  name: text('عارض الأحداث', 'Observateur d’événements', 'Event Viewer'),
  description: text(
    'سجلات النظام والتطبيقات والأمان والتثبيت',
    'Journaux système, application, sécurité et installation',
    'System, application, security and setup logs',
  ),
  category: 'system',
  icon: 'scroll-text',
  capabilities: [
    'eventlog.read',
    'eventlog.write',
    'fs.write',
    'clipboard',
    'process.enumerate',
    'notify',
    'window.manage',
    'registry.read',
  ],
  defaultSize: { w: 1120, h: 700 },
  minSize: { w: 700, h: 460 },
  keywords: ['event', 'viewer', 'log', 'audit', 'journal', 'événements', 'sécurité', 'أحداث', 'سجل', 'تدقيق'],
  jumpList: [
    { id: 'channel:System', title: text('النظام', 'Système', 'System') },
    { id: 'channel:Security', title: text('الأمان', 'Sécurité', 'Security') },
    { id: 'channel:Application', title: text('التطبيقات', 'Application', 'Application') },
  ],
  commands: [
    { id: 'channel:System', title: text('سجل النظام', 'Journal système', 'System log') },
    { id: 'channel:Application', title: text('سجل التطبيقات', 'Journal application', 'Application log') },
    { id: 'channel:Security', title: text('سجل الأمان', 'Journal sécurité', 'Security log') },
    { id: 'channel:Setup', title: text('سجل التثبيت', 'Journal installation', 'Setup log') },
    { id: 'filter:errors', title: text('الأخطاء فقط', 'Erreurs seulement', 'Errors only') },
  ],
});
