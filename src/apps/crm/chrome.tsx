/**
 * Customers — the chrome.
 *
 * The toolbar leads with `New`, because every surface here is a book somebody is adding
 * to, and then shows only the acts that belong to the record in front of them: convert on
 * a lead, send and answer on a quote, a stage move on a deal. A toolbar carrying all
 * nineteen commands at once is a toolbar nobody reads, so the act cluster changes with the
 * view and the rest of the bar — search, export, refresh — never moves.
 *
 * The count of late follow-ups sits beside them in every view. It is a badge and not a
 * disabled button, for the reason the close's findings count is: the server owns the
 * rules, and a window that refuses an act the server would accept is a window lying about
 * who is in charge. The acts that *are* disabled are disabled on one certain fact each —
 * a lead already converted, a quote already answered, a follow-up already done — which is
 * a fact the row itself carries, not a judgement about it.
 *
 * The rail is the seven surfaces, in the order the manifest declares them, split where the
 * business splits: the chain a sale walks down, then the desk around it. Each carries the
 * count from `model.counts`, which answers "is there work here?" rather than "how many
 * rows arrived" — so the pipeline badge is winnable deals, the follow-ups badge is the late
 * ones and the campaigns badge is the ones currently spending money.
 *
 * There is no view switcher in the toolbar. The rail is the switcher, and a second one
 * would be two controls disagreeing about which is authoritative.
 */
import type { Ref } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  FileDown,
  FileText,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Sigma,
  Tags,
  Target,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  Badge,
  Button,
  fmt,
  IconButton,
  type MenuEntry,
  MenuFlyout,
  Meter,
  NavGroupLabel,
  NavItem,
  SearchBox,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  useLocale,
} from '@/platform/sdk';
import type { CrmBusy } from './actions';
import type { CrmSummary, CrmView } from './model';
import { type CrmAnchor, type CrmRow, labelOf } from './shell';

/** The three-language shape every label in this file is written in. */
type Translate = (ar: string, fr: string, en: string) => string;

/** Which of the record acts the row in front of us can actually take. */
interface CrmAllowed {
  readonly edit: boolean;
  readonly convert: boolean;
  readonly stage: boolean;
  readonly send: boolean;
  readonly accept: boolean;
  readonly decline: boolean;
  readonly complete: boolean;
  readonly log: boolean;
  readonly tags: boolean;
}

const NONE: CrmAllowed = {
  edit: false,
  convert: false,
  stage: false,
  send: false,
  accept: false,
  decline: false,
  complete: false,
  log: false,
  tags: false,
};

/** A live record: it opens in its own editor, and an exchange can be filed against it. */
const RECORD: CrmAllowed = { ...NONE, edit: true, log: true };

/**
 * What this row still permits, decided on the one timestamp that settles it.
 *
 * Each test names a field that exists on exactly one of the seven projections — a lead has
 * `convertedAt`, a customer a `wilaya`, a deal a `wonAt` where a customer has `firstWonAt`,
 * a quote an `acceptedAt`, a follow-up a `completedAt` where an activity has `occurredAt` —
 * so the `in` operator narrows the union on the same field the answer is read from.
 *
 * The tests are timestamps rather than status words on purpose. `acceptedAt === null` stays
 * true whatever the database calls a live quote, and it refuses less than a status check
 * would: the exact rules — a quote must be sent, an acceptance needs a package — belong to
 * the dialogs, which already hold them, and ultimately to the server.
 *
 * It stays private to this file: the toolbar and the row menu are both here, they are the
 * only two places an act is offered, and a `.tsx` file that exports something which is not
 * a component breaks fast refresh.
 */
function allowed(row: CrmRow | null): CrmAllowed {
  if (row === null) return NONE;
  if ('convertedAt' in row) return { ...RECORD, convert: row.convertedAt === null };
  if ('wilaya' in row) return { ...RECORD, tags: true };
  if ('wonAt' in row) return { ...RECORD, stage: row.wonAt === null && row.lostAt === null };
  if ('acceptedAt' in row) {
    const live = row.acceptedAt === null && row.declinedAt === null;
    return { ...RECORD, send: live, accept: live, decline: live };
  }
  if ('completedAt' in row) return { ...RECORD, complete: row.completedAt === null };
  if ('occurredAt' in row) return NONE; // an activity line is history; nothing acts upon it
  return { ...NONE, edit: true }; // a campaign is answered in its own editor and nowhere else
}

/** What the rail, the search box and the status bar all need to say about one surface. */
interface ViewMeta {
  readonly icon: LucideIcon;
  readonly title: (tr: Translate) => string;
  /** Plural noun for the record count, so the status bar reads as a sentence. */
  readonly noun: (tr: Translate) => string;
  /** What the search box matches here — never a generic "Search". */
  readonly hint: (tr: Translate) => string;
}

const VIEW: Readonly<Record<CrmView, ViewMeta>> = {
  leads: {
    icon: UserPlus,
    title: (tr) => tr('العملاء المحتملون', 'Prospects', 'Leads'),
    noun: (tr) => tr('محتمل', 'prospects', 'leads'),
    hint: (tr) => tr('اسم أو هاتف أو بريد…', 'Nom, téléphone, e-mail…', 'Name, phone, email…'),
  },
  customers: {
    icon: Users,
    title: (tr) => tr('العملاء', 'Clients', 'Customers'),
    noun: (tr) => tr('عميل', 'clients', 'customers'),
    hint: (tr) => tr('اسم أو رمز أو ولاية…', 'Nom, code, wilaya…', 'Name, code, wilaya…'),
  },
  pipeline: {
    icon: Target,
    title: (tr) => tr('مسار الفرص', 'Pipeline', 'Pipeline'),
    noun: (tr) => tr('فرصة', 'opportunités', 'opportunities'),
    hint: (tr) => tr('عنوان أو مرجع أو عميل…', 'Titre, référence, client…', 'Title, reference, customer…'),
  },
  quotes: {
    icon: FileText,
    title: (tr) => tr('عروض الأسعار', 'Devis', 'Quotes'),
    noun: (tr) => tr('عرض', 'devis', 'quotes'),
    hint: (tr) => tr('رقم العرض أو عميل…', 'Numéro, client…', 'Number, customer…'),
  },
  activities: {
    icon: MessageSquare,
    title: (tr) => tr('سجل التواصل', 'Échanges', 'Activities'),
    noun: (tr) => tr('تواصل', 'échanges', 'activities'),
    hint: (tr) => tr('موضوع أو نتيجة…', 'Objet, résultat…', 'Subject, outcome…'),
  },
  followups: {
    icon: AlarmClock,
    title: (tr) => tr('المتابعات', 'Relances', 'Follow-ups'),
    noun: (tr) => tr('متابعة', 'relances', 'follow-ups'),
    hint: (tr) => tr('عنوان أو ملاحظة…', 'Titre, note…', 'Title, note…'),
  },
  campaigns: {
    icon: Megaphone,
    title: (tr) => tr('الحملات', 'Campagnes', 'Campaigns'),
    noun: (tr) => tr('حملة', 'campagnes', 'campaigns'),
    hint: (tr) => tr('اسم أو رمز أو قناة…', 'Nom, code, canal…', 'Name, code, channel…'),
  },
};

/** The chain a sale walks down, then the desk around it. The manifest's own order. */
const CHAIN: readonly CrmView[] = ['leads', 'customers', 'pipeline', 'quotes'];
const DESK: readonly CrmView[] = ['activities', 'followups', 'campaigns'];

/** One act in the toolbar's changing middle. */
interface Act {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly hint: string;
  readonly live: boolean;
  /** The busy token that makes this button spin; null for acts that only open a dialog. */
  readonly token: CrmBusy;
}

/**
 * The acts that belong to this surface, in the order the work happens in.
 *
 * `log` and `followup` come last wherever they appear because they are what you do *after*
 * the act above them, and they carry no token: they open an editor, and the editor's own
 * save is what runs. Activities and campaigns return nothing — an exchange already happened
 * and a campaign is edited in its own form, so neither has an act the toolbar can offer.
 */
function acts(view: CrmView, allow: CrmAllowed, tr: Translate): readonly Act[] {
  const log: Act = {
    id: 'log',
    icon: MessageSquare,
    label: tr('تسجيل', 'Journaliser', 'Log'),
    hint: tr('تسجيل تواصل…', 'Journaliser un échange…', 'Log activity…'),
    live: allow.log,
    token: null,
  };
  const followup: Act = {
    id: 'followup',
    icon: AlarmClock,
    label: tr('متابعة', 'Relance', 'Follow-up'),
    hint: tr('متابعة جديدة… (Ctrl+Shift+F)', 'Nouvelle relance… (Ctrl+Maj+F)', 'New follow-up… (Ctrl+Shift+F)'),
    live: allow.log,
    token: null,
  };
  switch (view) {
    case 'leads':
      return [{
        id: 'convert', icon: UserCheck, live: allow.convert, token: 'convert',
        label: tr('تحويل', 'Convertir', 'Convert'),
        hint: tr('تحويل إلى عميل (Ctrl+Enter)', 'Convertir en client (Ctrl+Entrée)', 'Convert to customer (Ctrl+Enter)'),
      }, log, followup];
    case 'customers':
      return [{
        id: 'tags', icon: Tags, live: allow.tags, token: 'tags',
        label: tr('الوسوم', 'Étiquettes', 'Tags'),
        hint: tr('تعديل وسوم العميل…', 'Modifier les étiquettes…', 'Edit customer tags…'),
      }, log, followup];
    case 'pipeline':
      return [{
        id: 'stage', icon: ArrowRightLeft, live: allow.stage, token: 'stage',
        label: tr('المرحلة', 'Étape', 'Stage'),
        hint: tr('نقل المرحلة…', "Changer d'étape…", 'Move stage…'),
      }, log, followup];
    case 'quotes':
      return [{
        id: 'send', icon: Send, live: allow.send, token: 'send',
        label: tr('إرسال', 'Envoyer', 'Send'),
        hint: tr('إرسال العرض (Ctrl+Shift+S)', 'Envoyer le devis (Ctrl+Maj+S)', 'Send quote (Ctrl+Shift+S)'),
      }, {
        id: 'accept', icon: CheckCircle2, live: allow.accept, token: 'accept',
        label: tr('قبول', 'Accepter', 'Accept'),
        hint: tr('قبول العرض… (Ctrl+Shift+Enter)', 'Accepter le devis… (Ctrl+Maj+Entrée)', 'Accept quote… (Ctrl+Shift+Enter)'),
      }, {
        id: 'decline', icon: Ban, live: allow.decline, token: 'decline',
        label: tr('رفض', 'Refuser', 'Decline'),
        hint: tr('رفض العرض… (Ctrl+Backspace)', 'Refuser le devis… (Ctrl+Retour arrière)', 'Decline quote… (Ctrl+Backspace)'),
      }, log];
    case 'followups':
      return [{
        id: 'complete', icon: CheckCheck, live: allow.complete, token: 'complete',
        label: tr('إنجاز', 'Terminer', 'Complete'),
        hint: tr('إنجاز المتابعة', 'Terminer la relance', 'Complete follow-up'),
      }, log];
    default:
      return [];
  }
}

export interface CrmToolbarProps {
  readonly view: CrmView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: CrmBusy;
  readonly loading: boolean;
  /** The row the acts apply to; nothing is selected until somebody clicks one. */
  readonly selected: CrmRow | null;
  /** Late follow-ups anywhere in the agency — stated in every view, never disabling. */
  readonly overdue: number;
  readonly onCommand: (id: string) => void;
  readonly onSearch: (value: string) => void;
}

/** `New`, then the acts this surface owns, then the three controls that never move. */
export function CrmToolbar(props: CrmToolbarProps) {
  const { tr, lang } = useLocale();
  const working = props.busy !== null;
  const cluster = acts(props.view, allowed(props.selected), tr);
  return (
    <div className="fx-commandbar">
      <Button
        icon={Plus}
        onClick={() => props.onCommand('new')}
        disabled={working}
        title={tr('جديد (Ctrl+N)', 'Nouveau (Ctrl+N)', 'New (Ctrl+N)')}
      >
        {tr('جديد', 'Nouveau', 'New')}
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
      {props.overdue > 0 ? (
        <>
          <ToolbarSeparator />
          <Badge
            tone="warning"
            icon={AlarmClock}
            title={tr('متابعات متأخرة', 'Relances en retard', 'Overdue follow-ups')}
          >
            {fmt.integer(props.overdue, lang)}
          </Badge>
        </>
      ) : null}
      <ToolbarSpacer />
      <SearchBox
        ref={props.searchRef}
        value={props.search}
        onChange={props.onSearch}
        width={220}
        placeholder={VIEW[props.view].hint(tr)}
      />
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

export interface CrmRailProps {
  readonly view: CrmView;
  readonly counts: Readonly<Record<CrmView, number>>;
  readonly summary: CrmSummary;
  readonly onCommand: (id: string) => void;
}

/**
 * The seven surfaces, and one figure above them.
 *
 * The badges come straight from `model.counts`, which counts work rather than rows: the
 * pipeline badge is deals still winnable, the follow-ups badge is the late ones and the
 * campaigns badge is the ones still spending money. A zero shows nothing at all — an empty
 * book needs no number to say so.
 */
export function CrmRail(props: CrmRailProps) {
  const { tr, lang } = useLocale();
  const item = (view: CrmView) => (
    <NavItem
      key={view}
      depth={1}
      icon={VIEW[view].icon}
      label={VIEW[view].title(tr)}
      badge={props.counts[view] > 0 ? props.counts[view] : null}
      selected={props.view === view}
      onClick={() => props.onCommand(`view:${view}`)}
    />
  );
  return (
    <>
      {props.summary.openValueDzd > 0 ? (
        <div style={{ display: 'grid', gap: 5, padding: '2px 12px 10px' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {fmt.money(props.summary.weightedValueDzd, 'DZD', lang)}
          </span>
          <Meter
            value={props.summary.weightedValueDzd}
            max={props.summary.openValueDzd}
            label={tr('المرجّح من المفتوح', 'Pondéré sur ouvert', 'Weighted of open')}
          />
        </div>
      ) : null}
      <NavGroupLabel>{tr('الدورة التجارية', 'Cycle commercial', 'Sales cycle')}</NavGroupLabel>
      {CHAIN.map(item)}
      <NavGroupLabel>{tr('المكتب', 'Le bureau', 'The desk')}</NavGroupLabel>
      {DESK.map(item)}
    </>
  );
}

export interface CrmStatusProps {
  readonly view: CrmView;
  readonly shown: number;
  readonly total: number;
  readonly summary: CrmSummary;
  readonly truncated: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

/**
 * How many records are in front of you, what the pipeline is worth, and how old that is.
 *
 * One money figure only. The other five in `CrmSummary` are the inspector's header tiles,
 * and a status bar repeating all six would be a status bar nobody reads either.
 */
export function CrmStatus(props: CrmStatusProps) {
  const { tr, lang } = useLocale();
  const meta = VIEW[props.view];
  const noun = meta.noun(tr);
  const count =
    props.shown === props.total
      ? `${fmt.integer(props.total, lang)} ${noun}`
      : `${fmt.integer(props.shown, lang)} / ${fmt.integer(props.total, lang)} ${noun}`;
  return (
    <>
      <StatusItem icon={meta.icon}>{count}</StatusItem>
      <StatusItem
        icon={Sigma}
        title={tr(
          'القيمة المرجّحة للفرص المفتوحة',
          'Valeur pondérée du pipeline ouvert',
          'Weighted value of the open pipeline',
        )}
      >
        {fmt.money(props.summary.weightedValueDzd, 'DZD', lang)}
      </StatusItem>
      {props.truncated ? (
        <StatusItem
          icon={AlertTriangle}
          tone="warning"
          title={tr(
            'وصل حدّ الصفحة — ضيّق البحث',
            'Limite de page atteinte — affinez la recherche',
            'Page limit reached — narrow the search',
          )}
        >
          {tr('عرض جزئي', 'Vue partielle', 'Partial view')}
        </StatusItem>
      ) : null}
      {props.error !== null ? (
        <StatusItem icon={ShieldAlert} tone="danger" title={props.error}>
          {tr('تعذّر التحميل', 'Chargement impossible', 'Load failed')}
        </StatusItem>
      ) : null}
      {props.fetchedAt !== null ? (
        <StatusItem icon={Clock}>{fmt.relativeTime(props.fetchedAt, lang)}</StatusItem>
      ) : null}
    </>
  );
}

export interface CrmMenuProps {
  readonly view: CrmView;
  readonly anchor: CrmAnchor;
  readonly busy: boolean;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

/**
 * The same acts, on the row you pointed at.
 *
 * Every entry is one of the toolbar's own command ids, because opening this menu moves the
 * selection first: the register's verbs already read the selection, so the menu needs no
 * private vocabulary to say "this row" — it says what the toolbar says, and the selection
 * underneath it has already changed to agree. The act cluster is literally `acts()`, the
 * same table the command bar maps over, so the rule for when an act is live is written once
 * and the two surfaces cannot drift into offering different things about the same record.
 *
 * The header names the record through `labelOf`, the function the delete confirmation also
 * calls, so the name above the acts and the name in the prompt they raise are one name.
 *
 * The two clipboard entries are one act at two scopes. `copyRow` is the record as a
 * labelled block — the paste that leaves the OS, into a message to the hotel — and `copy`
 * is the whole visible grid as tab-separated cells, which is what a spreadsheet accepts.
 * The record is offered first because a row menu is about a row. Neither advertises an
 * accelerator: this app binds no Ctrl+C, and a menu promising one would be lying.
 */
export function CrmMenu({ view, anchor, busy, onSelect, onDismiss }: CrmMenuProps) {
  const { tr } = useLocale();
  const allow = allowed(anchor.row);
  const entries: readonly MenuEntry[] = [
    { id: 'header', kind: 'header', label: labelOf(anchor.row) },
    {
      id: 'edit',
      label: tr('تحرير…', 'Modifier…', 'Edit…'),
      icon: Pencil,
      disabled: busy || !allow.edit,
    },
    ...acts(view, allow, tr).map((act) => ({
      id: act.id,
      label: act.label,
      icon: act.icon,
      disabled: busy || !act.live,
    })),
    { id: 'sep-clipboard', kind: 'separator' },
    { id: 'copyRow', label: tr('نسخ السجل', 'Copier la fiche', 'Copy record'), icon: ClipboardList },
    { id: 'copy', label: tr('نسخ الجدول', 'Copier le tableau', 'Copy table'), icon: Copy },
    { id: 'sep-delete', kind: 'separator' },
    {
      id: 'delete',
      label: tr('حذف…', 'Supprimer…', 'Delete…'),
      icon: Trash2,
      danger: true,
      disabled: busy,
    },
  ];
  return (
    <MenuFlyout
      x={anchor.x}
      y={anchor.y}
      entries={entries}
      onSelect={onSelect}
      onDismiss={onDismiss}
      minWidth={230}
    />
  );
}
