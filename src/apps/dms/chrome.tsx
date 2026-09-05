/**
 * Documents — the chrome.
 *
 * The toolbar leads with `Upload`, because every other verb in this app presupposes that a
 * file has arrived. After it comes only what the row in front of you still permits: the
 * review moves its own status graph allows, an archive act on a live document, a seal on an
 * open package. Six review buttons rendered grey on an approved document would be six lies
 * about what the server would accept, so the cluster is computed from
 * `DMS_REVIEW_TRANSITIONS` and holds at most three entries — and none at all in `APPROVED`,
 * `EXPIRED` or `SUPERSEDED`, which are terminal.
 *
 * That graph is read, not re-derived. `shell.ts` refuses an illegal move silently against
 * the same table; if this file guessed instead, the two would eventually disagree and the
 * window would offer a button that does nothing. The one act that is *not* graph-driven is
 * archiving, which moves `status` rather than `reviewStatus` — an approved document can be
 * archived without becoming unapproved — so it gates on `archivedAt`, a timestamp the row
 * carries, rather than on `status`, which `types.ts` types as an open `string`.
 *
 * `Preview` and `Copy link` are menu-only on purpose. Both need the version list from the
 * 360, which the toolbar cannot see: `currentVersion` returns null until that report lands,
 * and a toolbar button that looks live and silently does nothing is worse than no button.
 * The detail pane's version rows are the honest place to preview from.
 *
 * The search box appears on four of the six tabs, because only four are searchable — the
 * dashboard and the extraction report are reports, not grids, and there is nothing in them
 * for a search box to narrow. Tooltips advertise F5, Ctrl+U, Ctrl+F and Ctrl+E and nothing
 * else, and Ctrl+E only where `hotkey` actually binds it.
 */
import { type Ref } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Ban,
  Boxes,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  Eye,
  FileDown,
  FilePlus2,
  Files,
  Gauge,
  LayoutDashboard,
  Link,
  Lock,
  PackagePlus,
  Paperclip,
  PencilLine,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Trash2,
  Upload,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  Badge,
  Button,
  IconButton,
  MenuFlyout,
  NavGroupLabel,
  NavItem,
  SearchBox,
  Segmented,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  fmt,
  useLocale,
  type AppLang,
  type MenuEntry,
} from '@/platform/sdk';
import type { DmsBusy } from './actions';
import type { Translate } from './export';
import { VIEW_LABEL } from './labels';
import type { DmsCounts, DmsModel } from './model';
import { documentIdOf, isDocument, isPackage, labelOf, reviewStatusOf, type DmsAnchor, type DmsRow } from './shell';
import {
  DMS_REVIEW_TRANSITIONS,
  type DmsDocument360,
  type DmsPackage,
  type DmsReviewStatus,
  type DmsView,
} from './types';

/* ------------------------------------------------------------------ *
 * The six tabs
 * ------------------------------------------------------------------ */

/** What the rail, the search box and the status bar each need to say about one tab. */
interface ViewMeta {
  readonly icon: LucideIcon;
  /**
   * Plural noun for the record count, so the status bar reads as a sentence — or `null` on
   * the dashboard, whose `tally` is zero of zero because the tab holds tiles and charts. A
   * row count beside them would describe something that is not on screen.
   */
  readonly noun: ((tr: Translate) => string) | null;
  /**
   * What the search box matches here, or `null` where there is no box.
   *
   * Null on the dashboard and the extraction tab: both are reports whose payload arrives
   * whole from one RPC, `model` filters neither, and a box that narrowed nothing would be
   * an invitation to type into a dead control.
   */
  readonly hint: ((tr: Translate) => string) | null;
}

const VIEW: Readonly<Record<DmsView, ViewMeta>> = {
  dashboard: {
    icon: LayoutDashboard,
    noun: null,
    hint: null,
  },
  library: {
    icon: Files,
    noun: (tr) => tr('مستند', 'documents', 'documents'),
    hint: (tr) => tr('عنوان أو رقم أو وسم…', 'Titre, numéro, étiquette…', 'Title, number, tag…'),
  },
  review: {
    icon: Search,
    noun: (tr) => tr('بانتظار', 'en attente', 'awaiting'),
    hint: (tr) => tr('عنوان أو رقم أو مرسل…', 'Titre, numéro, émetteur…', 'Title, number, submitter…'),
  },
  expiry: {
    icon: AlarmClock,
    noun: (tr) => tr('انتهاء', 'échéances', 'expiries'),
    hint: (tr) => tr('عنوان أو رقم أو نوع…', 'Titre, numéro, type…', 'Title, number, type…'),
  },
  extraction: {
    icon: Gauge,
    noun: (tr) => tr('حقل', 'champs', 'fields'),
    hint: null,
  },
  packages: {
    icon: Boxes,
    noun: (tr) => tr('حزمة', 'dossiers', 'packages'),
    hint: (tr) => tr('اسم أو مرجع…', 'Nom, référence…', 'Name, reference…'),
  },
};

/**
 * The rail, in two groups.
 *
 * The desk is where a document is worked: the overview, the shelf it sits on, the queue it
 * waits in, the date it dies on. Assurance is the pair that asks whether the paper can be
 * trusted at all — how well the extractor read it, and whether a sealed bundle still matches
 * its seal. The order inside each group is the order a document travels in, which is also
 * the order the manifest lists its jumps.
 */
const DESK: readonly DmsView[] = ['dashboard', 'library', 'review', 'expiry'];
const ASSURE: readonly DmsView[] = ['extraction', 'packages'];

/* ------------------------------------------------------------------ *
 * Acts
 * ------------------------------------------------------------------ */

/**
 * The status each review verb asks the server for.
 *
 * The same six pairs `shell.ts` keeps, restated here because a `.tsx` file may not import a
 * private constant and a shared export would let the register's gate and this window's
 * button list drift apart in opposite directions. They are checked against one another by
 * the fact that a wrong entry here produces a button that visibly does nothing.
 */
const TARGET: Readonly<Record<string, DmsReviewStatus>> = {
  submit: 'PENDING_REVIEW',
  start: 'UNDER_REVIEW',
  approve: 'APPROVED',
  reject: 'REJECTED',
  changes: 'CHANGES_REQUESTED',
  reopen: 'DRAFT',
};

/** The order the review buttons appear in, which is not the order the graph lists them. */
const MOVES: readonly string[] = ['submit', 'start', 'approve', 'changes', 'reject', 'reopen'];

/** One button, in the toolbar and in the row menu, described once. */
interface Act {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly hint: string;
  /** False renders it disabled; an act that can never apply here is omitted instead. */
  readonly live: boolean;
  /** The `DmsBusy` token whose spinner belongs to this act, or null if a dialog owns it. */
  readonly token: DmsBusy;
}

/** Icon, label and spinner for each review verb. Reachability is decided by the graph. */
const MOVE: Readonly<Record<string, (tr: Translate) => Act>> = {
  submit: (tr) => ({
    id: 'submit', icon: Send, live: true, token: 'submit',
    label: tr('إرسال', 'Soumettre', 'Submit'),
    hint: tr('إرسال للمراجعة', 'Soumettre à la revue', 'Submit for review'),
  }),
  start: (tr) => ({
    id: 'start', icon: PlayCircle, live: true, token: 'startReview',
    label: tr('بدء', 'Prendre', 'Start'),
    hint: tr('بدء المراجعة', 'Prendre en revue', 'Start reviewing'),
  }),
  approve: (tr) => ({
    id: 'approve', icon: CheckCircle2, live: true, token: 'approve',
    label: tr('اعتماد', 'Approuver', 'Approve'),
    hint: tr('اعتماد المستند', 'Approuver le document', 'Approve the document'),
  }),
  changes: (tr) => ({
    id: 'changes', icon: PencilLine, live: true, token: null,
    label: tr('تعديلات', 'Modifications', 'Changes'),
    hint: tr('طلب تعديلات', 'Demander des modifications', 'Request changes'),
  }),
  reject: (tr) => ({
    id: 'reject', icon: XCircle, live: true, token: null,
    label: tr('رفض', 'Refuser', 'Reject'),
    hint: tr('رفض مع السبب', 'Refuser avec motif', 'Reject with a reason'),
  }),
  reopen: (tr) => ({
    id: 'reopen', icon: RotateCcw, live: true, token: 'reopen',
    label: tr('إعادة فتح', 'Rouvrir', 'Reopen'),
    hint: tr('إرجاع إلى مسوّدة', 'Ramener au brouillon', 'Return to draft'),
  }),
};

/**
 * The review moves this row can actually make.
 *
 * Emitted rather than disabled: `DMS_REVIEW_TRANSITIONS` allows at most three moves from any
 * state and none at all from `APPROVED`, `EXPIRED` or `SUPERSEDED`, so showing all six would
 * mean showing three to six dead buttons on every row in the app. A package has no review
 * status and yields nothing.
 */
function reviewActs(row: DmsRow | null, tr: Translate): readonly Act[] {
  if (row === null) return [];
  const from = reviewStatusOf(row);
  if (from === null) return [];
  const reachable = DMS_REVIEW_TRANSITIONS[from];
  return MOVES.filter((id) => reachable.includes(TARGET[id])).map((id) => MOVE[id](tr));
}

/**
 * Archive, or un-archive, and never both.
 *
 * Off the transition graph entirely: these move `status`, and an approved document can be
 * archived without ceasing to be approved. The gate is the `archivedAt` timestamp rather
 * than the `status` string, because `types.ts` types that column as an open `string` — the
 * timestamp is the fact the row actually carries. Only a library row has it, so the pair
 * disappears on the queue and expiry tabs, where the projection does not select it.
 */
function lifecycleActs(row: DmsRow | null, tr: Translate): readonly Act[] {
  if (row === null || !isDocument(row)) return [];
  if (row.archivedAt === null) {
    return [{
      id: 'archive', icon: Archive, live: true, token: 'archive',
      label: tr('أرشفة', 'Archiver', 'Archive'),
      hint: tr('نقل إلى الأرشيف', 'Déplacer vers les archives', 'Move to the archive'),
    }];
  }
  return [{
    id: 'unarchive', icon: ArchiveRestore, live: true, token: 'archive',
    label: tr('استرجاع', 'Désarchiver', 'Unarchive'),
    hint: tr('إرجاع من الأرشيف', 'Sortir des archives', 'Restore from the archive'),
  }];
}

/**
 * What the expiry tab is for: notify everybody, then replace the paper.
 *
 * `sweep` needs no row — it stamps every document already inside its own notice window —
 * so it stays live even with nothing selected. `version:new` is the act that actually ends
 * an expiry: a renewed passport is a new version of the same document, not a new document,
 * which is why the renewal desk offers it and the library relies on the row menu.
 */
function renewalActs(row: DmsRow | null, tr: Translate): readonly Act[] {
  return [
    {
      id: 'sweep', icon: Send, live: true, token: 'sweep',
      label: tr('تنبيه', 'Notifier', 'Notify'),
      hint: tr('تنبيه كل ما يقارب الانتهاء', 'Notifier les échéances proches', 'Notify everything due'),
    },
    {
      id: 'version:new', icon: FilePlus2, live: row !== null && documentIdOf(row) !== null, token: null,
      label: tr('إصدار جديد', 'Nouvelle version', 'New version'),
      hint: tr('تحميل الوثيقة المجدّدة', 'Téléverser le document renouvelé', 'Upload the renewed document'),
    },
  ];
}

/**
 * The package desk, five buttons wide whatever is selected.
 *
 * Disabled rather than omitted, which is the opposite of what the review tier does, and for
 * the opposite reason: this cluster is small and stable, and its greyed buttons are the only
 * place the app states the shape of a package's life — you may add members and seal while it
 * is open, verify once it is sealed, void until somebody has. The review tier would have to
 * grey three to six buttons out of six to say the same thing, which is noise rather than a
 * shape. `package:new` needs no selection at all.
 *
 * Only `seal` carries a spinner. Add, void and edit open dialogs, and verify opens a pane
 * that reports its own progress, so a toolbar spinner for any of them would be spinning for
 * a round trip that has not started yet.
 */
function packageActs(row: DmsRow | null, tr: Translate): readonly Act[] {
  const pack = row !== null && isPackage(row) ? row : null;
  const open = pack !== null && pack.status === 'OPEN';
  return [
    {
      id: 'package:new', icon: PackagePlus, live: true, token: null,
      label: tr('حزمة جديدة', 'Nouveau dossier', 'New package'),
      hint: tr('إنشاء حزمة أدلة', 'Créer un dossier de preuves', 'Create an evidence package'),
    },
    {
      id: 'package:add', icon: Paperclip, live: open, token: null,
      label: tr('إضافة', 'Ajouter', 'Add'),
      hint: tr('إضافة مستند إلى الحزمة', 'Ajouter un document au dossier', 'Add a document to the package'),
    },
    {
      id: 'package:seal', icon: Lock, live: open, token: 'seal',
      label: tr('ختم', 'Sceller', 'Seal'),
      hint: tr('ختم الحزمة نهائياً', 'Sceller définitivement le dossier', 'Seal the package for good'),
    },
    {
      id: 'package:verify', icon: ShieldCheck, live: pack !== null && pack.sealedAt !== null, token: null,
      label: tr('تحقق', 'Vérifier', 'Verify'),
      hint: tr('مقارنة الختم بالأعضاء', 'Comparer le sceau aux membres', 'Check the seal against its members'),
    },
    {
      id: 'package:void', icon: Ban, live: pack !== null && pack.status !== 'VOID', token: null,
      label: tr('إبطال', 'Annuler', 'Void'),
      hint: tr('إبطال الحزمة مع السبب', 'Annuler le dossier avec motif', 'Void the package with a reason'),
    },
  ];
}

/**
 * The cluster this tab shows, which is the acts its rows can carry and nothing else.
 *
 * Two tabs have none. The dashboard has no row to act on, and the extraction report is
 * keyed by field rather than by document — `DmsQualityField` is not a `DmsRow`, so there is
 * nothing on that tab a document verb could be pointed at. Their toolbars are the standing
 * frame alone: upload, export, refresh.
 */
function acts(view: DmsView, row: DmsRow | null, tr: Translate): readonly Act[] {
  if (view === 'library') return [...reviewActs(row, tr), ...lifecycleActs(row, tr)];
  if (view === 'review') return reviewActs(row, tr);
  if (view === 'expiry') return renewalActs(row, tr);
  if (view === 'packages') return packageActs(row, tr);
  return [];
}

/* ------------------------------------------------------------------ *
 * The toolbar
 * ------------------------------------------------------------------ */

/**
 * A day range as segments. Digits are localized, the unit is a single letter.
 *
 * The values travel as strings because `Segmented` is generic over a string union and the
 * caller converts back with `Number`, which is exact for two-digit day counts and keeps the
 * control from inventing a numeric type the SDK does not have.
 */
const dayOptions = (
  values: readonly number[],
  tr: Translate,
  lang: AppLang,
): readonly { readonly value: string; readonly label: string }[] =>
  values.map((days) => {
    const n = fmt.integer(days, lang);
    return { value: String(days), label: tr(`${n} ي`, `${n} j`, `${n} d`) };
  });

export interface DmsToolbarProps {
  readonly view: DmsView;
  readonly selected: DmsRow | null;
  readonly busy: DmsBusy;
  readonly loading: boolean;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  /** Documents already inside their own notice window, for the standing alarm. */
  readonly renewals: number;
  readonly windowDays: number;
  readonly horizonDays: number;
  readonly onSearch: (next: string) => void;
  readonly onCommand: (id: string) => void;
  readonly onWindowDays: (next: number) => void;
  readonly onHorizonDays: (next: number) => void;
}

/**
 * Upload, then whatever this row permits, then the three verbs every tab has.
 *
 * `disabled` and `busy` say different things and both are needed. Anything is disabled while
 * another act is in flight, because two writes to one document racing each other is a lost
 * update the user did not ask for; only the act that owns the running token spins, so the
 * spinner names what is actually happening rather than smearing across the toolbar.
 *
 * The renewals badge is hidden on the expiry tab. Everywhere else it is news; there it is
 * the grid, and a count of the rows in front of you is furniture.
 */
export function DmsToolbar(props: DmsToolbarProps) {
  const { tr, lang } = useLocale();
  const working = props.busy !== null;
  const cluster = acts(props.view, props.selected, tr);
  const hint = VIEW[props.view].hint;
  return (
    <div className="fx-commandbar">
      <Button
        icon={Upload}
        onClick={() => props.onCommand('upload')}
        disabled={working}
        title={tr('تحميل مستند (Ctrl+U)', 'Téléverser un document (Ctrl+U)', 'Upload a document (Ctrl+U)')}
      >
        {tr('تحميل', 'Téléverser', 'Upload')}
      </Button>
      {cluster.length > 0 ? <ToolbarSeparator /> : null}
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
      {props.renewals > 0 && props.view !== 'expiry' ? (
        <>
          <ToolbarSeparator />
          <Badge
            tone="warning"
            icon={AlarmClock}
            title={tr('مستندات تقارب الانتهاء', 'Documents bientôt expirés', 'Documents expiring soon')}
          >
            {fmt.integer(props.renewals, lang)}
          </Badge>
        </>
      ) : null}
      <ToolbarSpacer />
      {props.view === 'expiry' ? (
        <Segmented
          size="sm"
          value={String(props.horizonDays)}
          onChange={(next) => props.onHorizonDays(Number(next))}
          options={dayOptions([30, 90, 180], tr, lang)}
        />
      ) : null}
      {props.view === 'extraction' ? (
        <Segmented
          size="sm"
          value={String(props.windowDays)}
          onChange={(next) => props.onWindowDays(Number(next))}
          options={dayOptions([7, 30, 90], tr, lang)}
        />
      ) : null}
      {hint !== null ? (
        <SearchBox
          ref={props.searchRef}
          value={props.search}
          onChange={props.onSearch}
          width={220}
          placeholder={hint(tr)}
        />
      ) : null}
      <Button
        icon={FileDown}
        onClick={() => props.onCommand('export')}
        disabled={working}
        busy={props.busy === 'export'}
        title={tr('تصدير CSV (Ctrl+E)', 'Exporter en CSV (Ctrl+E)', 'Export as CSV (Ctrl+E)')}
      >
        {tr('تصدير', 'Exporter', 'Export')}
      </Button>
      <IconButton
        icon={RefreshCw}
        label={tr('تحديث (F5)', 'Actualiser (F5)', 'Refresh (F5)')}
        onClick={() => props.onCommand('refresh')}
        disabled={props.loading}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The rail
 * ------------------------------------------------------------------ */

/**
 * A count worth printing, or nothing at all.
 *
 * `DmsCounts` carries no `dashboard` key, and the early return is what makes indexing it
 * typecheck: with `'dashboard'` excluded the parameter narrows to exactly the five keys the
 * record has. It is also the honest answer — the overview is not a list of anything, so no
 * number beside it would mean what `12` means beside the queue.
 *
 * Zero prints nothing rather than `0`, as the rail does everywhere else in this OS. An empty
 * queue is a quiet queue, and a badge reading zero is a badge asking to be dismissed.
 */
const badgeOf = (view: DmsView, counts: DmsCounts): number | null => {
  if (view === 'dashboard') return null;
  const value = counts[view];
  return value > 0 ? value : null;
};

export interface DmsRailProps {
  readonly view: DmsView;
  readonly counts: DmsCounts;
  readonly onCommand: (id: string) => void;
}

/**
 * Six entries in two groups, each carrying the number a person needs before deciding to go there.
 *
 * Dispatch goes through `onCommand('view:…')` rather than a `changeView` prop, because
 * `shell.ts` already owns that mapping for the manifest's jump list and for the menu bar. One
 * table decides what `view:library` means, and the rail is another caller of it — so a tab
 * that is reachable from the Start menu cannot become unreachable from the rail.
 */
export function DmsRail(props: DmsRailProps) {
  const { t, tr } = useLocale();
  const item = (view: DmsView) => (
    <NavItem
      key={view}
      depth={1}
      icon={VIEW[view].icon}
      label={t(VIEW_LABEL[view])}
      badge={badgeOf(view, props.counts)}
      selected={props.view === view}
      onClick={() => props.onCommand(`view:${view}`)}
    />
  );
  return (
    <>
      <NavGroupLabel>{tr('المكتب', 'Le bureau', 'The desk')}</NavGroupLabel>
      {DESK.map(item)}
      <NavGroupLabel>{tr('الضمان', 'Contrôle', 'Assurance')}</NavGroupLabel>
      {ASSURE.map(item)}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The status bar
 * ------------------------------------------------------------------ */

/**
 * Whatever went wrong on the tab you are looking at, and nothing about the other five.
 *
 * Six reads run at once and any of them can fail; a status bar that showed all six would
 * report a broken package list to somebody working the review queue. `Feed` and `Report`
 * differ in their payload — `rows` versus `value` — but agree on `error`, which is why one
 * accessor covers both.
 *
 * `loading` is deliberately not folded in here. The grid draws its own arriving state, the
 * refresh button disables itself, and a third indicator saying the same thing in words is
 * the kind of furniture that makes a status bar unreadable.
 */
function errorOf(view: DmsView, model: DmsModel): string | null {
  switch (view) {
    case 'dashboard':
      return model.dashboard.error;
    case 'library':
      return model.documents.error;
    case 'review':
      return model.queue.error;
    case 'expiry':
      return model.expiry.error;
    case 'extraction':
      return model.quality.error;
    case 'packages':
      return model.packages.error;
  }
}

export interface DmsStatusProps {
  readonly view: DmsView;
  readonly model: DmsModel;
  /** Rows the active grid is showing, and rows the tab holds. Tallied by `shell.ts`. */
  readonly shown: number;
  readonly total: number;
}

/**
 * How much is here, whether it is all of it, and when it was read.
 *
 * `12 documents` when nothing is typed and `3 / 12 documents` when something is: the second
 * form only appears once the two numbers disagree, so the bar does not carry a slash all day
 * to explain a filter nobody applied.
 *
 * The truncation warning is not gated to one tab, because `model.truncated` is true when any
 * of the three paged windows came back full — the fact belongs to the read, not to the grid
 * in front of you, and a package list capped at its page is worth knowing about while you
 * work the queue. The timestamp *is* gated: `fetchedAt` is the library page's own read time
 * and would be a wrong answer anywhere else.
 *
 * `AlertTriangle` carries both the warning and the error, distinguished by tone and by word.
 * Truncation and failure are the same shape of news — *what you see is not the whole truth* —
 * and giving them two glyphs would imply they are different kinds of thing.
 */
export function DmsStatus(props: DmsStatusProps) {
  const { tr, lang } = useLocale();
  const { model, shown, total } = props;
  const noun = VIEW[props.view].noun;
  const error = errorOf(props.view, model);
  const counted = (word: string): string =>
    shown === total
      ? `${fmt.integer(total, lang)} ${word}`
      : `${fmt.integer(shown, lang)} / ${fmt.integer(total, lang)} ${word}`;
  return (
    <>
      {noun === null ? null : (
        <StatusItem icon={VIEW[props.view].icon}>{counted(noun(tr))}</StatusItem>
      )}
      {model.truncated ? (
        <StatusItem
          icon={AlertTriangle}
          tone="warning"
          title={tr(
            'وصلت الصفحة ممتلئة؛ قد تكون هناك سجلات أخرى',
            'La page est revenue pleine ; d’autres enregistrements existent peut-être',
            'The page came back full; more records may exist',
          )}
        >
          {tr('نتائج مقتطعة', 'Résultats tronqués', 'Truncated')}
        </StatusItem>
      ) : null}
      {error !== null ? (
        <StatusItem icon={AlertTriangle} tone="danger" title={error}>
          {tr('تعذّرت القراءة', 'Lecture impossible', 'Read failed')}
        </StatusItem>
      ) : null}
      {props.view === 'library' && model.fetchedAt !== null ? (
        <StatusItem
          icon={Clock}
          title={
            model.fromCache
              ? tr('من الذاكرة المؤقتة', 'Depuis le cache', 'From the cache')
              : tr('قراءة مباشرة', 'Lecture directe', 'Read live')
          }
        >
          {fmt.relativeTime(model.fetchedAt, lang)}
        </StatusItem>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The row menu
 * ------------------------------------------------------------------ */

/**
 * Ids the menu spells out itself, so the act cluster does not offer them a second time.
 *
 * `acts()` is shared with the command bar on purpose — the two surfaces must agree about when
 * a verb is live — but the toolbar has room for four or five buttons and a menu has room for
 * fifteen. Everything in this set is written out below with its own gate and its own place in
 * the order; everything else the tab's cluster offers comes through `acts()` unchanged. Both
 * halves reach `perform` by the same string either way, so the two paths cannot mean different
 * things about one row.
 */
const OWN: ReadonlySet<string> = new Set([
  'version:new', 'package:new', 'package:edit', 'package:add', 'package:seal',
  'package:verify', 'package:void',
]);

/**
 * The 360 read, but only if it is about *this* row.
 *
 * One document is selected per tab and the detail read follows the selection, so a menu raised
 * over a row the pane has not caught up with would otherwise offer that row the neighbouring
 * document's bytes. Comparing ids is the whole guard, and `documentIdOf` returning null for a
 * package is what keeps it honest on the packages tab.
 */
const detailOf = (row: DmsRow, detail: DmsDocument360 | null): DmsDocument360 | null => {
  const id = documentIdOf(row);
  if (id === null || detail === null) return null;
  return detail.document.id === id ? detail : null;
};

export interface DmsMenuProps {
  readonly view: DmsView;
  readonly anchor: DmsAnchor;
  readonly busy: DmsBusy;
  /**
   * The selected document's 360, or null while it is in flight. Preview, copy-link, metadata,
   * tags and new-version all need something no grid row carries — a storage path, a
   * description, a tag list — so each is offered greyed until the read lands rather than
   * offered live and then quietly doing nothing.
   */
  readonly detail: DmsDocument360 | null;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

/**
 * Everything that can be done to one document, in the order a document is worked.
 *
 * Read it, then describe it, then attach it, then destroy it. The tab's own cluster comes
 * first because that is the verb somebody right-clicked to reach — approve on the queue,
 * archive on the shelf — and the four blocks below it are the ones the command bar has no
 * room for.
 *
 * `record` and `bytes` are two different kinds of not-yet. A grid row carries a title and a
 * status but never a description or a tag list, so properties and tags wait for the 360 on
 * the queue and expiry tabs and are live immediately on the library tab, where the row *is*
 * the document. Bytes are stricter: a storage path lives on a version, so preview and
 * copy-link wait for the read on every tab including the library.
 *
 * `link` attaches this document to a business record, `relate` attaches it to another
 * document, `member` files it in an evidence package. Three verbs that all read as "attach"
 * in English and mean three different edges, which is why each says what it attaches to.
 */
function documentEntries(
  view: DmsView,
  row: DmsRow,
  detail: DmsDocument360 | null,
  working: boolean,
  tr: Translate,
): readonly MenuEntry[] {
  const full = detailOf(row, detail);
  const bytes = full !== null && full.versions.some((version) => version.isCurrent);
  const record = isDocument(row) || full !== null;
  return [
    { id: 'header', kind: 'header', label: labelOf(row) },
    ...acts(view, row, tr)
      .filter((act) => !OWN.has(act.id))
      .map((act) => ({
        id: act.id,
        label: act.label,
        icon: act.icon,
        disabled: working || !act.live,
      })),
    { id: 'sep-bytes', kind: 'separator' },
    {
      id: 'preview',
      label: tr('معاينة', 'Aperçu', 'Preview'),
      icon: Eye,
      disabled: working || !bytes,
    },
    {
      id: 'link:copy',
      label: tr('نسخ رابط التنزيل', 'Copier le lien', 'Copy download link'),
      icon: Link,
      disabled: working || !bytes,
    },
    { id: 'sep-record', kind: 'separator' },
    {
      id: 'metadata',
      label: tr('الخصائص…', 'Propriétés…', 'Properties…'),
      icon: SlidersHorizontal,
      disabled: working || !record,
    },
    {
      id: 'tags',
      label: tr('الوسوم…', 'Étiquettes…', 'Tags…'),
      icon: Tags,
      disabled: working || !record,
    },
    {
      id: 'version:new',
      label: tr('إصدار جديد…', 'Nouvelle version…', 'New version…'),
      icon: FilePlus2,
      disabled: working || !record,
    },
    { id: 'sep-attach', kind: 'separator' },
    {
      id: 'link',
      label: tr('ربط بسجل…', 'Rattacher à une fiche…', 'Link to a record…'),
      icon: Paperclip,
      disabled: working,
    },
    {
      id: 'relate',
      label: tr('ربط بمستند…', 'Lier à un document…', 'Relate to a document…'),
      icon: Files,
      disabled: working,
    },
    {
      id: 'member',
      label: tr('إضافة إلى حزمة…', 'Ajouter à un dossier…', 'Add to a package…'),
      icon: PackagePlus,
      disabled: working,
    },
    {
      id: 'queue',
      label: tr('إعادة الاستخراج', 'Relancer l’extraction', 'Queue extraction'),
      icon: ScanLine,
      disabled: working,
    },
    { id: 'sep-copy', kind: 'separator' },
    {
      id: 'copy',
      label: tr('نسخ الجدول', 'Copier le tableau', 'Copy table'),
      icon: ClipboardCopy,
    },
    { id: 'sep-delete', kind: 'separator' },
    {
      id: 'delete',
      label: tr('حذف…', 'Supprimer…', 'Delete…'),
      icon: Trash2,
      danger: true,
      disabled: working,
    },
  ];
}

/**
 * A package's life: describe it, fill it, seal it, check the seal, void it.
 *
 * Every gate here is one fact the row already carries. A package accepts members and can be
 * sealed while it is `OPEN`; the seal can be checked once `sealedAt` exists; voiding is
 * offered until it has already been voided. Sealing additionally wants something in the
 * package — a seal over nothing is a checksum of an empty list, which proves nothing and
 * cannot be un-sealed.
 *
 * Renaming is offered whatever the status. A sealed package's *description* is not what the
 * seal covers, and if the server disagrees it will say so; refusing here would be this window
 * inventing a rule.
 */
function packageEntries(row: DmsPackage, working: boolean, tr: Translate): readonly MenuEntry[] {
  const open = row.status === 'OPEN';
  return [
    { id: 'header', kind: 'header', label: row.name },
    {
      id: 'package:edit',
      label: tr('تعديل الحزمة…', 'Modifier le dossier…', 'Edit package…'),
      icon: PencilLine,
      disabled: working,
    },
    {
      id: 'package:add',
      label: tr('إضافة مستند…', 'Ajouter un document…', 'Add a document…'),
      icon: Paperclip,
      disabled: working || !open,
    },
    {
      id: 'package:seal',
      label: tr('ختم الحزمة', 'Sceller le dossier', 'Seal package'),
      icon: Lock,
      disabled: working || !open || row.documentCount === 0,
    },
    {
      id: 'package:verify',
      label: tr('التحقّق من الختم', 'Vérifier le sceau', 'Verify seal'),
      icon: ShieldCheck,
      disabled: working || row.sealedAt === null,
    },
    {
      id: 'package:void',
      label: tr('إبطال الحزمة…', 'Annuler le dossier…', 'Void package…'),
      icon: Ban,
      disabled: working || row.status === 'VOID',
    },
    { id: 'sep-copy', kind: 'separator' },
    {
      id: 'copy',
      label: tr('نسخ الجدول', 'Copier le tableau', 'Copy table'),
      icon: ClipboardCopy,
    },
    { id: 'sep-delete', kind: 'separator' },
    {
      id: 'package:delete',
      label: tr('حذف الحزمة…', 'Supprimer le dossier…', 'Delete package…'),
      icon: Trash2,
      danger: true,
      disabled: working,
    },
  ];
}

/**
 * The row menu, over whichever of the two kinds of row was pointed at.
 *
 * A document and a package share exactly one verb — copy the table — so there are two builders
 * rather than one with a dozen conditionals. `isPackage` picks between them, and because it is
 * the same guard `perform` uses to route the chosen id, a package row cannot be handed a
 * document's verb or the other way round.
 *
 * Opening the menu moves the selection to the row it was raised over, so the detail read
 * follows the pointer and the greyed-until-known entries come alive a moment later. That is
 * why they are greyed rather than hidden: they are about to work, and a menu whose length
 * changes under the cursor is a menu you cannot learn.
 *
 * No entry advertises an accelerator. DMS binds its keys per tab against the *selected* row,
 * and a menu is raised by pointing rather than selecting; printing `Ctrl+Enter` beside an act
 * would be promising a key whose meaning depends on state the menu does not show.
 */
export function DmsMenu(props: DmsMenuProps) {
  const { tr } = useLocale();
  const working = props.busy !== null;
  const row = props.anchor.row;
  const entries = isPackage(row)
    ? packageEntries(row, working, tr)
    : documentEntries(props.view, row, props.detail, working, tr);
  return (
    <MenuFlyout
      x={props.anchor.x}
      y={props.anchor.y}
      entries={entries}
      onSelect={props.onSelect}
      onDismiss={props.onDismiss}
      minWidth={240}
    />
  );
}
