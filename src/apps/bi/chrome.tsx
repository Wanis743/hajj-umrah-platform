/**
 * The furniture: the command bar, the nav rail, the status bar and the row menu.
 *
 * Four exported components, each handed a slice of the shell and a slice of the model. Nothing
 * here holds state and nothing here decides anything — the rail dispatches `view:catalog`
 * through the same `command` the Start menu's jump list reaches, the toolbar dispatches
 * `dataset:new` through the same one, and both arrive at the four-tier command path in
 * `shell.ts`. A second table here deciding what `view:catalog` means would be a second answer
 * to a question that already has one.
 *
 * The lookups the four share live in one place, {@link VIEW}, keyed on `BiView` and exhaustive
 * over it: a view added to `BI_VIEWS` and not to this table fails typecheck rather than
 * rendering a rail with a hole in it. Wording comes from `labels.ts` and colour from
 * `tones.ts`, both `.ts` files, because `react-refresh/only-export-components` is error-level
 * here and this file may export only components.
 *
 * Rail badges are `BiRailCounts`, which is a *partial* record on purpose and must be read as
 * one. Only `catalog`, `dashboards` and `reports` are ever populated; the two ledgers are paged
 * and a page length is not a total, and overview and analysis are not lists. `NavItem` draws no
 * badge for `undefined`, which is exactly the reading wanted — *this number is not known* — and
 * the entry stays clickable regardless. An earlier draft of this file disabled a rail entry
 * whose count was zero, which made four of the seven views permanently unreachable.
 */
import {
  AlertTriangle,
  BookMarked,
  Boxes,
  Clock,
  Copy,
  Database,
  Download,
  FileBarChart,
  GitBranch,
  Grid3x3,
  History,
  LayoutDashboard,
  type LucideIcon,
  Play,
  Plus,
  RefreshCw,
  Ruler,
  Save,
  ScrollText,
  Sigma,
  SquareTerminal,
  Table2,
  Timer,
} from 'lucide-react';
import {
  Badge,
  Button,
  fmt,
  MenuFlyout,
  NavGroupLabel,
  NavItem,
  SearchBox,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  useLocale,
  type MenuEntry,
} from '@/platform/sdk';
import { VIEW_LABEL } from './labels';
import {
  governedKindOf,
  isDataset,
  isEvent,
  isQueryEntry,
  labelOf,
  type BiAnchor,
  type BiListRow,
} from './shell';
import type { BiBusy } from './actions';
import type { BiModel, BiRailCounts } from './model';
import type { BiPowers, BiView } from './types';
import type { Ref } from 'react';

/** The three-language writer `useLocale` hands out, named so a table can take one. */
type Translate = (ar: string, fr: string, en: string) => string;

interface ViewMeta {
  readonly icon: LucideIcon;
  /** What one row of this view is called, for the status bar's `12 datasets`. Null on the two
   *  views that hold no list, which is also what stops the bar counting them. */
  readonly noun: ((tr: Translate) => string) | null;
  /** The search box's placeholder, and — by being null — whether there is a search box at all.
   *  The overview is six cards and the analysis view is a result grid addressed by column, and
   *  `biVisible` filters neither. */
  readonly hint: ((tr: Translate) => string) | null;
}

const VIEW: Readonly<Record<BiView, ViewMeta>> = {
  overview: { icon: Grid3x3, noun: null, hint: null },
  catalog: {
    icon: Database,
    noun: (tr) => tr('مجموعة بيانات', 'jeux de données', 'datasets'),
    hint: (tr) => tr('ابحث في الفهرس…', 'Chercher dans le catalogue…', 'Search the catalog…'),
  },
  analysis: { icon: Table2, noun: null, hint: null },
  dashboards: {
    icon: LayoutDashboard,
    noun: (tr) => tr('لوحة', 'tableaux de bord', 'dashboards'),
    hint: (tr) => tr('ابحث في اللوحات…', 'Chercher un tableau de bord…', 'Search dashboards…'),
  },
  reports: {
    icon: FileBarChart,
    noun: (tr) => tr('تقرير', 'rapports', 'reports'),
    hint: (tr) => tr('ابحث في التقارير…', 'Chercher un rapport…', 'Search reports…'),
  },
  queries: {
    icon: History,
    noun: (tr) => tr('استعلام', 'requêtes', 'queries'),
    hint: (tr) => tr('ابحث في السجل…', 'Chercher dans le journal…', 'Search the log…'),
  },
  events: {
    icon: ScrollText,
    noun: (tr) => tr('حدث', 'événements', 'events'),
    hint: (tr) => tr('ابحث في الأحداث…', 'Chercher un événement…', 'Search events…'),
  },
};

/* ------------------------------------------------------------------ *
 * The command bar
 * ------------------------------------------------------------------ */

/** One button: what it says, what it sends, whether it may be pressed, and which write it owns
 *  so that only its own spinner turns. */
interface Act {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly hint?: string;
  readonly live: boolean;
  readonly token: BiBusy;
}

/**
 * What the tab in front of you can create, run or trace.
 *
 * Every gate is a *power* the server reported, not a guess: `BiPowers` comes off
 * `get_bi_overview` evaluated for this caller, so a workspace whose analysts may save analyses
 * but may not define datasets sees one button and not the other. The server refuses either way
 * — this is about not offering a button that will be refused.
 *
 * Dimension and metric are offered on the catalog tab and only while a dataset's detail has
 * actually landed. `useCreateCommands` does nothing for either when `model.dataset.value` is
 * null, so the alternative to a dark button is a click that opens nothing.
 */
function acts(
  view: BiView,
  powers: BiPowers,
  hasDataset: boolean,
  hasAnalysis: boolean,
  selected: BiListRow | null,
  tr: Translate,
): readonly Act[] {
  if (view === 'overview') {
    return [{
      id: 'source:sync',
      icon: RefreshCw,
      label: tr('مزامنة المصادر', 'Synchroniser les sources', 'Sync sources'),
      hint: tr(
        'إعادة قراءة أعمدة المصادر المسجَّلة',
        'Relire les colonnes des sources enregistrées',
        'Re-read the registered sources’ columns',
      ),
      live: powers.canSyncSources,
      token: 'sync',
    }];
  }
  if (view === 'catalog') {
    return [
      {
        id: 'dataset:new', icon: Plus, label: tr('مجموعة بيانات', 'Jeu de données', 'Dataset'),
        live: powers.canDefine, token: 'save',
      },
      {
        id: 'dimension:new', icon: Ruler, label: tr('بُعد', 'Dimension', 'Dimension'),
        hint: tr(
          'يُضاف إلى مجموعة البيانات المفتوحة',
          'Ajouté au jeu de données ouvert',
          'Added to the open dataset',
        ),
        live: powers.canDefine && hasDataset, token: 'save',
      },
      {
        id: 'metric:new', icon: Sigma, label: tr('مقياس', 'Mesure', 'Metric'),
        live: powers.canDefine && hasDataset, token: 'save',
      },
      {
        id: 'lineage', icon: GitBranch, label: tr('النسب', 'Traçabilité', 'Lineage'),
        hint: tr('ما الذي يعتمد على هذا', 'Ce qui en dépend', 'What depends on this'),
        live: selected !== null && isDataset(selected), token: null,
      },
    ];
  }
  if (view === 'analysis') {
    return [
      {
        id: 'run', icon: Play, label: tr('تشغيل', 'Exécuter', 'Run'),
        hint: 'Ctrl+Enter', live: true, token: 'query',
      },
      {
        id: 'analysis:save', icon: Save, label: tr('حفظ', 'Enregistrer', 'Save'),
        hint: 'Ctrl+S', live: powers.canSaveAnalysis, token: 'save',
      },
      {
        id: 'tile:new', icon: Boxes, label: tr('إضافة بلاطة', 'Ajouter une tuile', 'Add tile'),
        hint: tr(
          'ضع هذا التحليل على اللوحة المفتوحة',
          'Placer cette analyse sur le tableau ouvert',
          'Place this analysis on the open dashboard',
        ),
        live: powers.canBuildDashboards && hasAnalysis, token: 'save',
      },
    ];
  }
  if (view === 'dashboards') {
    return [{
      id: 'dashboard:new', icon: Plus, label: tr('لوحة', 'Tableau de bord', 'Dashboard'),
      live: powers.canBuildDashboards, token: 'save',
    }];
  }
  if (view === 'reports') {
    return [{
      id: 'report:new', icon: Plus, label: tr('تقرير', 'Rapport', 'Report'),
      live: powers.canDefine, token: 'save',
    }];
  }
  if (view === 'queries') {
    return [{
      id: 'sql', icon: SquareTerminal, label: tr('عرض SQL', 'Voir le SQL', 'View SQL'),
      live: selected !== null && isQueryEntry(selected) && selected.compiledSql !== null,
      token: null,
    }];
  }
  return [];
}

export interface BiToolbarProps {
  readonly view: BiView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: BiBusy;
  readonly loading: boolean;
  readonly powers: BiPowers;
  /** Whether a dataset detail and a saved analysis are actually loaded. Four of the creates
   *  need one or the other and do nothing without it. */
  readonly hasDataset: boolean;
  readonly hasAnalysis: boolean;
  /** Whether the shelves have moved since the result on screen was fetched. */
  readonly stale: boolean;
  readonly selected: BiListRow | null;
  readonly onCommand: (id: string) => void;
  readonly onSearch: (search: string) => void;
}

/**
 * This tab's verbs, then the three every tab has.
 *
 * `disabled` and `busy` say different things and both are needed. Everything goes dark while
 * any write is in flight, because two saves racing over one definition is a lost update nobody
 * asked for; only the button whose token is running spins, so the spinner names what is
 * actually happening instead of smearing across the bar.
 *
 * The staleness badge is the one piece of news the bar carries on its own account. A result
 * grid whose query has since been edited is still true about the query it answered and no
 * longer true about the one on the shelves, and the reader has to know that *before* they read
 * a number off it.
 */
export function BiToolbar(props: BiToolbarProps) {
  const { tr } = useLocale();
  const working = props.busy !== null;
  const cluster = acts(
    props.view, props.powers, props.hasDataset, props.hasAnalysis, props.selected, tr,
  );
  const hint = VIEW[props.view].hint;
  return (
    <div className="fx-commandbar">
      {cluster.map((act) => (
        <Button
          key={act.id}
          icon={act.icon}
          onClick={() => props.onCommand(act.id)}
          disabled={working || !act.live}
          busy={act.token !== null && props.busy === act.token}
          title={act.hint}
        >
          {act.label}
        </Button>
      ))}
      {cluster.length > 0 ? <ToolbarSeparator /> : null}
      <Button
        icon={RefreshCw}
        variant="subtle"
        onClick={() => props.onCommand('refresh')}
        disabled={props.loading || working}
        title={tr('إعادة القراءة (F5)', 'Relire (F5)', 'Re-read (F5)')}
      >
        {tr('تحديث', 'Actualiser', 'Refresh')}
      </Button>
      <Button
        icon={Download}
        variant="subtle"
        onClick={() => props.onCommand('export')}
        disabled={working}
        busy={props.busy === 'export'}
        title={tr('تصدير المعروض (Ctrl+E)', 'Exporter l’affichage (Ctrl+E)', 'Export what is shown (Ctrl+E)')}
      >
        {tr('تصدير', 'Exporter', 'Export')}
      </Button>
      <Button
        icon={Copy}
        variant="subtle"
        onClick={() => props.onCommand('copy')}
        disabled={working}
        title={tr('نسخ المعروض', 'Copier l’affichage', 'Copy what is shown')}
      >
        {tr('نسخ', 'Copier', 'Copy')}
      </Button>
      {props.stale && props.view === 'analysis' ? (
        <>
          <ToolbarSeparator />
          <Badge
            tone="warning"
            icon={AlertTriangle}
            title={tr(
              'تغيّر الاستعلام منذ آخر تشغيل',
              'La requête a changé depuis la dernière exécution',
              'The query changed since the last run',
            )}
          >
            {tr('نتيجة قديمة', 'Résultat périmé', 'Stale result')}
          </Badge>
        </>
      ) : null}
      <ToolbarSpacer />
      {hint === null ? null : (
        <SearchBox
          ref={props.searchRef}
          value={props.search}
          onChange={props.onSearch}
          width={220}
          placeholder={hint(tr)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The nav rail
 * ------------------------------------------------------------------ */

/** What is defined. The overview counts it and the catalog holds it. */
const MODEL: readonly BiView[] = ['overview', 'catalog'];
/** What is asked. One question composed, and two ways of keeping the answer. */
const ASK: readonly BiView[] = ['analysis', 'dashboards', 'reports'];
/** What happened. Two ledgers, both paged, neither badged. */
const HISTORY: readonly BiView[] = ['queries', 'events'];

export interface BiRailProps {
  readonly view: BiView;
  readonly counts: BiRailCounts;
  readonly onCommand: (id: string) => void;
}

/**
 * Seven entries in three groups, three of which carry a number.
 *
 * The badge is `counts[view]` and nothing more. `BiRailCounts` is a partial record whose absent
 * members mean *not known* rather than *none* — the query log and the event ledger are read a
 * page at a time, so the length of a feed is a ceiling — and `NavItem` draws nothing for
 * `undefined`, which is the honest rendering of that. A zero, where one is genuinely known, is
 * drawn: a catalog with no datasets in it is worth saying out loud.
 *
 * Every entry stays clickable. There is no state of this app in which a view is unreachable,
 * and a rail that greys out the analysis builder because nobody has saved an analysis yet would
 * lock the reader out of the one screen that would fix that.
 */
export function BiRail(props: BiRailProps) {
  const { t, tr } = useLocale();
  const item = (view: BiView) => (
    <NavItem
      key={view}
      depth={1}
      icon={VIEW[view].icon}
      label={t(VIEW_LABEL[view])}
      badge={props.counts[view] ?? null}
      selected={props.view === view}
      onClick={() => props.onCommand(`view:${view}`)}
    />
  );
  return (
    <>
      <NavGroupLabel>{tr('النموذج', 'Le modèle', 'The model')}</NavGroupLabel>
      {MODEL.map(item)}
      <NavGroupLabel>{tr('السؤال', 'La question', 'The question')}</NavGroupLabel>
      {ASK.map(item)}
      <NavGroupLabel>{tr('السجل', 'L’historique', 'The record')}</NavGroupLabel>
      {HISTORY.map(item)}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The status bar
 * ------------------------------------------------------------------ */

/**
 * Whatever went wrong on the tab you are looking at, and nothing about the other six.
 *
 * Ten reads run at once and any of them can fail; a bar that showed all ten would report a
 * broken event ledger to somebody working the catalog. `Feed` and `Report` differ in their
 * payload — `rows` versus `value` — and agree on `error`, which is why one accessor covers
 * both. The analysis view has no read of its own: its failure is the query's, which arrives as
 * `shell.queryError` and is passed in separately.
 */
function errorOf(view: BiView, model: BiModel): string | null {
  switch (view) {
    case 'overview':
      return model.overview.error;
    case 'catalog':
      return model.catalog.error;
    case 'analysis':
      return null;
    case 'dashboards':
      return model.dashboards.error;
    case 'reports':
      return model.reports.error;
    case 'queries':
      return model.queries.error;
    case 'events':
      return model.events.error;
  }
}

export interface BiStatusProps {
  readonly view: BiView;
  readonly model: BiModel;
  /** Rows the active grid is showing, and rows the tab holds. Tallied by `shell.ts`. */
  readonly shown: number;
  readonly total: number;
  /** Whether the result on screen stops short of the rows that matched. */
  readonly truncated: boolean;
  /** How long the run took, so a reader can tell a slow query from a slow network. */
  readonly durationMs: number | null;
  /** The query's own refusal, which no read reports. */
  readonly queryError: string | null;
}

/**
 * How much is here, whether it is all of it, and how long it took to say so.
 *
 * `12 datasets` when nothing is typed and `3 / 12 datasets` when something is: the second form
 * appears only once the two numbers disagree, so the bar does not carry a slash all day to
 * explain a filter nobody applied.
 *
 * Truncation is not gated to the analysis tab, because `ledgerWindowed` is true whenever either
 * paged ledger came back exactly full — the fact belongs to the read and not to the grid in
 * front of you. The row limit's own truncation is the analysis view's, and both arrive here as
 * the same sentence, because they are the same news: *what you see is not all of it*.
 */
export function BiStatusBar(props: BiStatusProps) {
  const { tr, lang } = useLocale();
  const { model, shown, total } = props;
  const noun = VIEW[props.view].noun;
  const error = props.queryError ?? errorOf(props.view, model);
  const short = props.truncated || model.ledgerWindowed;
  const counted = (word: string): string =>
    shown === total
      ? `${fmt.integer(total, lang)} ${word}`
      : `${fmt.integer(shown, lang)} / ${fmt.integer(total, lang)} ${word}`;
  return (
    <>
      {noun === null ? null : (
        <StatusItem icon={VIEW[props.view].icon}>{counted(noun(tr))}</StatusItem>
      )}
      {props.view === 'analysis' ? (
        <StatusItem icon={Table2}>
          {`${fmt.integer(shown, lang)} ${tr('صف', 'lignes', 'rows')}`}
        </StatusItem>
      ) : null}
      {props.durationMs === null ? null : (
        <StatusItem icon={Timer} title={tr('زمن التنفيذ', 'Temps d’exécution', 'Execution time')}>
          {fmt.duration(props.durationMs, lang)}
        </StatusItem>
      )}
      {short ? (
        <StatusItem
          icon={AlertTriangle}
          tone="warning"
          title={tr(
            'وصلت النتيجة عند حدّها؛ قد تكون هناك صفوف أخرى',
            'Le résultat est revenu à sa limite ; d’autres lignes existent peut-être',
            'The result came back at its limit; more rows may exist',
          )}
        >
          {tr('نتائج مقتطعة', 'Résultats tronqués', 'Truncated'
          )}
        </StatusItem>
      ) : null}
      {error === null ? null : (
        <StatusItem icon={AlertTriangle} tone="danger" title={error}>
          {tr('تعذّرت القراءة', 'Lecture impossible', 'Read failed')}
        </StatusItem>
      )}
      {model.loading ? (
        <StatusItem icon={Clock}>{tr('جارٍ القراءة…', 'Lecture…', 'Reading…')}</StatusItem>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The row menu
 * ------------------------------------------------------------------ */

/**
 * What may be done to the row under the cursor.
 *
 * Built from the shell's own guards rather than from a second set of `in` checks written here:
 * `isDataset`, `governedKindOf` and the rest are the same functions `useRowCommands` dispatches
 * on, so a menu entry cannot be offered for a shape the command path will refuse. Two of the
 * five shapes are history — a query log line and a ledger line are the record of what happened,
 * and editing the record is not a verb — so both get a short menu and neither gets a delete.
 *
 * `copy` is deliberately last and deliberately says *list*. It falls through `runRow` to the
 * global command, which copies what the tab is showing, and a menu item labelled *Copy* over a
 * single row would be a promise about that row that the verb does not keep.
 */
function menuEntries(row: BiListRow, working: boolean, tr: Translate): readonly MenuEntry[] {
  const entries: MenuEntry[] = [];
  const governed = governedKindOf(row);

  if (governed !== null) {
    entries.push({
      id: 'edit',
      icon: BookMarked,
      label: tr('تحرير…', 'Modifier…', 'Edit…'),
      disabled: working,
    });
    entries.push({
      id: 'status',
      icon: GitBranch,
      label: tr('تغيير الحالة…', 'Changer le statut…', 'Change status…'),
      disabled: working,
    });
  }
  if (isDataset(row)) {
    entries.push({
      id: 'lineage',
      icon: GitBranch,
      label: tr('النسب', 'Traçabilité', 'Lineage'),
    });
  }
  if (isQueryEntry(row) && row.compiledSql !== null) {
    entries.push({
      id: 'sql',
      icon: SquareTerminal,
      label: tr('عرض SQL', 'Voir le SQL', 'View SQL'),
    });
  }
  if (isEvent(row)) {
    entries.push({
      id: 'refresh',
      icon: RefreshCw,
      label: tr('إعادة قراءة السجل', 'Relire le journal', 'Re-read the ledger'),
      disabled: working,
    });
  }
  if (entries.length > 0) entries.push({ id: 'sep', kind: 'separator' });
  entries.push({
    id: 'copy',
    icon: Copy,
    label: tr('نسخ القائمة', 'Copier la liste', 'Copy list'),
  });
  if (governed !== null) {
    entries.push({
      id: 'delete',
      label: tr('حذف…', 'Supprimer…', 'Delete…'),
      danger: true,
      disabled: working,
    });
  }
  return entries;
}

export interface BiMenuProps {
  readonly anchor: BiAnchor;
  readonly busy: BiBusy;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

/**
 * The flyout, positioned where the right-click landed.
 *
 * `MenuFlyout` calls `onSelect` and then dismisses itself, so nothing here closes the menu by
 * hand — and `perform` closes it a second time on its way in, which is harmless and is what
 * makes the keyboard path and the mouse path identical.
 */
export function BiMenu(props: BiMenuProps) {
  const { tr } = useLocale();
  const row = props.anchor.row;
  return (
    <MenuFlyout
      x={props.anchor.x}
      y={props.anchor.y}
      entries={menuEntries(row, props.busy !== null, tr)}
      onSelect={props.onSelect}
      onDismiss={props.onDismiss}
    />
  );
}

/** The row a menu was raised over, named for the header the flyout does not draw. */
export function BiMenuSubject({ row }: { readonly row: BiListRow }) {
  return <span className="fx-title-ellipsis">{labelOf(row)}</span>;
}
