/**
 * Analytics — the manifest.
 *
 * Installed at boot, long before any of this app's code is downloaded, so this
 * file may not run anything; it only shapes a literal the shell reads to build
 * Start, search, the taskbar and the jump list.
 *
 * `analysis` rather than `accounting`, because what this app governs is not a
 * set of books — it is the semantic layer over them. A dataset here can be built
 * on bookings, on pilgrims or on the journal, and the answer it gives is the same
 * kind of answer in each case.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const biManifest = defineApp({
  id: APP_IDS.bi,
  name: text('ذكاء الأعمال', 'Décisionnel', 'Analytics'),
  description: text(
    'الطبقة الدلالية: مجموعات البيانات، المؤشرات، التحليلات ولوحات المعلومات.',
    'La couche sémantique : jeux de données, indicateurs, analyses et tableaux de bord.',
    'The semantic layer: datasets, metrics, saved analyses and dashboards.',
  ),
  category: 'analysis',
  icon: 'bar-chart',

  /**
   * Five capabilities, and the split between the first two is the whole point.
   *
   * `ledger.read` is what running a query costs, because a query answers with
   * numbers the ledger already holds and the source's own `required_permission`
   * is checked underneath it either way. `bi.write` is what changing a
   * *definition* costs — and that is the larger consent, because a metric is a
   * sentence about what a number means to everyone who reads it afterwards.
   *
   * `ledger.post` is NOT requested, and neither is anything else that moves
   * money. Publishing a metric changes what a dashboard says; it does not change
   * a balance.
   *
   * `fs.write` is for exporting a result set and the query log to the VFS,
   * `clipboard` for lifting compiled SQL or a dataset key out, and
   * `shell.launch` for drill-through — a cell that stands for eleven bookings
   * opens Bookings, because this app renders numbers and other apps own rows.
   *
   * `eventlog.read` is absent for the same reason it is absent from Documents:
   * `bi_events` is a governance history — who published what, and what it broke
   * — and the app reads it through `biEvents`, not the kernel's audit channel.
   */
  capabilities: ['ledger.read', 'bi.write', 'fs.write', 'clipboard', 'shell.launch'],

  /**
   * The widest default in the platform, and it has to be: a dashboard is a
   * twelve-column grid, and a twelve-column grid inside a 1,200-pixel window
   * gives each column about eighty pixels before gutters. The floor of 960 is
   * where the grid stops being a grid and the tiles stack.
   */
  defaultSize: { w: 1440, h: 860 },
  minSize: { w: 960, h: 560 },
  pinned: true,

  /**
   * English plurals first: the search ranker treats the keyword as the haystack
   * and the typed text as the needle, so `dataset` matches `datasets` but not
   * the other way round.
   */
  keywords: [
    'analytics',
    'bi',
    'business intelligence',
    'datasets',
    'dataset',
    'metrics',
    'metric',
    'dimensions',
    'kpi',
    'charts',
    'dashboards',
    'dashboard',
    'reports',
    'report',
    'analysis',
    'analyses',
    'semantic layer',
    'lineage',
    'drill',
    'drill-through',
    'query log',
    'sql',
    'ذكاء الأعمال',
    'تحليلات',
    'مؤشرات',
    'لوحات',
    'تقارير',
    'تحليل',
    'décisionnel',
    'analytique',
    'indicateurs',
    'tableaux de bord',
    'rapports',
    'analyses',
  ],

  /** The four places somebody arrives already knowing where they are going. */
  jumpList: [
    { id: 'view:catalog', title: text('الفهرس', 'Catalogue', 'Catalog') },
    { id: 'view:analysis', title: text('محرر التحليل', "Éditeur d'analyse", 'Analysis builder') },
    { id: 'view:dashboards', title: text('لوحات المعلومات', 'Tableaux de bord', 'Dashboards') },
    { id: 'view:queries', title: text('سجل الاستعلامات', 'Journal des requêtes', 'Query log') },
  ],

  /**
   * Published to the palette. `run` carries `Ctrl+Enter` rather than `F5`,
   * because `refresh` already owns `F5` and the two are different acts: one
   * re-reads the catalog, the other spends database time answering a question.
   */
  commands: [
    { id: 'run', title: text('تشغيل الاستعلام', 'Exécuter la requête', 'Run query'), accelerator: 'Ctrl+Enter' },
    { id: 'dataset:new', title: text('مجموعة بيانات جديدة', 'Nouveau jeu de données', 'New dataset'), accelerator: 'Ctrl+N' },
    { id: 'search', title: text('بحث', 'Rechercher', 'Find definition'), accelerator: 'Ctrl+F' },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'export', title: text('تصدير', 'Exporter', 'Export'), accelerator: 'Ctrl+E' },
    { id: 'analysis:save', title: text('حفظ التحليل', "Enregistrer l'analyse", 'Save analysis'), accelerator: 'Ctrl+S' },
    { id: 'dashboard:new', title: text('لوحة جديدة', 'Nouveau tableau de bord', 'New dashboard') },
    { id: 'source:sync', title: text('مزامنة المصادر', 'Synchroniser les sources', 'Sync sources') },
  ],
});
