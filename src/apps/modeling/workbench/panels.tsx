/**
 * Modeling workbench — the chrome around the grid.
 *
 * Four pieces of furniture and one report: the rail that lists every model in the book, the
 * toolbar that carries the verbs, the aside that shows what was certified, the status bar, and
 * the panel that appears instead of a grid when a model will not compile.
 *
 * None of them hold state and none of them call a command. Every one takes what it renders and
 * a callback per thing a person can press, which is what lets `index.tsx` own the question of
 * *when* a verb is allowed while this file owns the question of what it looks like when it is
 * not. The division earns its keep in one place in particular: `publishGate` below returns the
 * reason publishing is refused, in three languages, and the button renders that reason in its
 * own tooltip. A disabled button with no explanation is the most common lie in an internal
 * tool — it says "not now" and leaves the reader to guess at "why not".
 *
 * Two decisions are worth stating because they look like oversights:
 *
 * The rail keys and selects by `key`, never by `id`. `useLedgerCommand().run` answers `boolean`
 * and throws away the row it wrote, so after `model.create` the browser knows the key somebody
 * typed and does not know the uuid the database minted. Selecting by key means the model that
 * was just created is the model that is now open, with no round trip to learn its id.
 *
 * Nothing here formats a number without `fmt`, and nothing here writes an English sentence that
 * a reader will see — except the engine's own `detail` and `limitations`, which arrive as prose
 * and are rendered as prose. `labels.ts` explains why that is the honest choice rather than a
 * gap: those strings are generated at run time from the numbers a run actually found, and a
 * translation table cannot hold a sentence that does not exist until the model is computed.
 */
import {
  Archive,
  ArchiveRestore,
  BadgeCheck,
  Calculator,
  CircleAlert,
  Clock,
  GitBranch,
  Hash,
  Layers,
  Pencil,
  Play,
  Plus,
  Sheet,
  ShieldCheck,
  Table2,
  TriangleAlert,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  fmt,
  InfoBar,
  type Localized,
  NavGroupLabel,
  NavItem,
  PropertyRow,
  Section,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  Tooltip,
  useLocale,
} from '@/platform/sdk';
import type { Certificate, Check, ModelFailure, ModelVersion } from '../engine';
import type { ModelingView } from '../model';
import { ViewSwitch } from '../views';
import type { CertificateRecord, ModelDocument, ModelStatus, ModelSummary } from './document';
import type { PublishGate } from './gate';
import {
  CHECK_LABEL,
  GRADE_LABEL,
  GRADE_MEANING,
  GRADE_TONE,
  GRAPH_ISSUE_LABEL,
  MODEL_STATUS_LABEL,
  MODEL_STATUS_TONE,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  PARSE_ERROR_LABEL,
  SCENARIO_ISSUE_LABEL,
  SPEC_ISSUE_LABEL,
  TARGET_KIND_LABEL,
} from './labels';

/* ------------------------------------------------------------------ *
 * The rail: every model in the book
 * ------------------------------------------------------------------ */

export interface ModelRailProps {
  readonly models: readonly ModelSummary[];
  /** By key rather than id, for the reason given in the header. */
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly onNew: () => void;
  readonly loading: boolean;
}

/**
 * Drafts first, then published, then archived.
 *
 * Not the order a reader would want — a published model is the one anybody quotes — but the order
 * an *editor* wants, and this is the editing window. A draft is the only state in which the twelve
 * mutating verbs do anything, so the models somebody is working on sit where the cursor already is.
 */
const RAIL_ORDER: readonly ModelStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

/**
 * The second line under a model's name: its span, its shape, and its verdict.
 *
 * Every number here is a column `get_modeling_overview` computed in SQL rather than something
 * counted in the browser, which is what makes it affordable to render for every model in the book
 * at once. The grade badge is the point of the line: a reader scanning the rail is looking for
 * `CERTIFIED`, and a stale certificate has to be visibly *not* that — so staleness is drawn as its
 * own amber mark beside the grade instead of quietly downgrading it, because "was certified, then
 * edited" is a different fact from "provisional".
 */
function RailMeta({ model }: { readonly model: ModelSummary }) {
  const { t, tr, lang } = useLocale();
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11, opacity: 0.75 }}>
      <span>
        {model.firstPeriod === '' ? tr('بلا فترات', 'sans période', 'no periods') : `${model.firstPeriod} → ${model.lastPeriod}`}
      </span>
      <span>·</span>
      <span title={tr('أسطر · افتراضات · سيناريوهات', 'lignes · hypothèses · scénarios', 'rows · assumptions · scenarios')}>
        {fmt.integer(model.rows, lang)}/{fmt.integer(model.assumptions, lang)}/{fmt.integer(model.scenarios, lang)}
      </span>
      {model.certificateGrade === null ? null : (
        <Badge tone={GRADE_TONE[model.certificateGrade]}>{t(GRADE_LABEL[model.certificateGrade])}</Badge>
      )}
      {model.certificateStale ? (
        <Badge tone="warning" icon={TriangleAlert} title={tr('عُدّل النموذج بعد الشهادة', 'Modèle modifié depuis le certificat', 'Edited since the certificate')}>
          {tr('قديمة', 'périmé', 'stale')}
        </Badge>
      ) : null}
    </span>
  );
}
/**
 * The rail.
 *
 * Groups are skipped when empty rather than rendered with a heading and nothing under it, so a
 * book of three drafts shows one heading — a reader learns the vocabulary from the models that
 * exist rather than from three labels, two of which describe an empty room.
 */
export function ModelRail({ models, selectedKey, onSelect, onNew, loading }: ModelRailProps) {
  const { t, tr } = useLocale();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <Button icon={Plus} variant="accent" block onClick={onNew}>
        {tr('نموذج جديد', 'Nouveau modèle', 'New model')}
      </Button>
      {models.length === 0 ? (
        <EmptyState
          compact
          icon={Sheet}
          title={loading ? tr('جارٍ التحميل…', 'Chargement…', 'Loading…') : tr('لا نماذج بعد', 'Aucun modèle', 'No models yet')}
          description={loading ? undefined : tr(
            'ابدأ بنموذج ومحور زمني، ثم أضف الأسطر والافتراضات.',
            'Commencez par un modèle et un axe de périodes, puis ajoutez lignes et hypothèses.',
            'Start with a model and a period axis, then add rows and assumptions.',
          )}
        />
      ) : (
        RAIL_ORDER.map((status) => {
          const group = models.filter((model) => model.status === status);
          if (group.length === 0) return null;
          return (
            <div key={status} style={{ minWidth: 0 }}>
              <NavGroupLabel>{t(MODEL_STATUS_LABEL[status])}</NavGroupLabel>
              {group.map((model) => (
                <NavItem
                  key={model.key}
                  icon={Sheet}
                  selected={model.key === selectedKey}
                  onClick={() => onSelect(model.key)}
                  label={
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{model.name === '' ? model.key : model.name}</span>
                      <RailMeta model={model} />
                    </span>
                  }
                />
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
/* ------------------------------------------------------------------ *
 * Why publishing is refused
 * ------------------------------------------------------------------ */

/* `publishGate` and the `PublishGate` shape live in `./gate`, not here. The toolbar below renders
 * the refusal it returns; deciding the refusal is policy, and a file of components is the wrong
 * place for policy — see that module's header for the second reason, which is Fast Refresh. */

/* ------------------------------------------------------------------ *
 * The toolbar: the verbs, and what they say when they are refused
 * ------------------------------------------------------------------ */

/** One callback per thing a person can press. The toolbar decides *whether*, never *what*. */
export interface WorkbenchActions {
  readonly newModel: () => void;
  readonly editHeader: () => void;
  readonly publish: () => void;
  readonly revise: () => void;
  readonly archive: () => void;
  readonly restore: () => void;
  readonly recompute: () => void;
  readonly certify: () => void;
}

export interface WorkbenchToolbarProps {
  readonly document: ModelDocument | null;
  readonly gate: PublishGate;
  readonly view: ModelingView;
  /** The four-way view switcher shares its id vocabulary with the projection toolbar. */
  readonly onCommand: (id: string) => void;
  readonly actions: WorkbenchActions;
  /** A command is in flight. Which one is unknowable, which is why nothing spins. */
  readonly busy: boolean;
  /** The model compiles. Certifying a model that does not is meaningless, not merely refused. */
  readonly compiled: boolean;
}

/**
 * Publish, with its refusal in its own tooltip.
 *
 * `busy` disables rather than spins. `useModelCommands` reports one `running` flag for fourteen
 * verbs, so a spinner here would be a claim this button cannot support — it would turn while
 * somebody deleted a row three panels away. Disabled-and-quiet is the truthful rendering of "a
 * command is in flight and I do not know which".
 *
 * The tooltip carries a sentence even when the button works, because the sentence is different in
 * the two cases that matter: publishing a model normally freezes it, and publishing a model when
 * the capability is not yet elevated will first ask for consent. A person about to trigger a
 * system prompt should know that before the prompt, not from it.
 */
function PublishButton({ gate, busy, onClick }: {
  readonly gate: PublishGate;
  readonly busy: boolean;
  readonly onClick: () => void;
}) {
  const { t, tr } = useLocale();
  return (
    <Tooltip
      content={
        gate.reason !== null
          ? t(gate.reason)
          : gate.elevates
            ? tr('سيطلب النشر إذنًا صريحًا أولًا.', 'La publication demandera d’abord un consentement.', 'Publishing will ask for explicit consent first.')
            : tr('يثبّت النموذج ويسجّل بصمته.', 'Fige le modèle et enregistre son empreinte.', 'Freezes the model and records its hash.')
      }
    >
      <span style={{ display: 'inline-flex' }}>
        <Button icon={ShieldCheck} variant="accent" disabled={!gate.ready || busy} onClick={onClick}>
          {tr('نشر', 'Publier', 'Publish')}
        </Button>
      </span>
    </Tooltip>
  );
}
/**
 * The toolbar, as a fragment.
 *
 * `AppFrame` owns the strip, so this returns siblings rather than a container — the separators and
 * the spacer only mean anything as children of the frame's own flex row.
 *
 * Archive and Revise are drawn as one slot with two faces rather than two buttons, one of which is
 * always dead: an archived model has exactly one thing anybody wants to do to it, and offering
 * "archive" beside "restore" invites the reader to work out which of the two is the no-op.
 */
export function WorkbenchToolbar({ document, gate, view, onCommand, actions, busy, compiled }: WorkbenchToolbarProps) {
  const { t, tr } = useLocale();
  const status = document?.header.status ?? null;
  const draft = status === 'DRAFT';
  return (
    <>
      <Button icon={Plus} variant="subtle" onClick={actions.newModel}>
        {tr('جديد', 'Nouveau', 'New')}
      </Button>
      <ToolbarSeparator />
      {status === null ? null : <Badge tone={MODEL_STATUS_TONE[status]}>{t(MODEL_STATUS_LABEL[status])}</Badge>}
      <Button icon={Pencil} variant="subtle" disabled={!draft || busy} onClick={actions.editHeader}>
        {tr('العنوان', 'En-tête', 'Header')}
      </Button>
      <ToolbarSeparator />
      <Button icon={Play} variant="subtle" disabled={document === null} onClick={actions.recompute}>
        {tr('احسب', 'Calculer', 'Recompute')}
      </Button>
      <Tooltip
        content={
          compiled
            ? tr('يقيس تسعة فحوص ويمنح درجة.', 'Mesure neuf contrôles et attribue une note.', 'Measures nine checks and awards a grade.')
            : tr('لا يُصدَّق نموذج لا يُترجم.', 'Un modèle qui ne compile pas ne se certifie pas.', 'A model that does not compile cannot be certified.')
        }
      >
        <span style={{ display: 'inline-flex' }}>
          <Button icon={BadgeCheck} variant="subtle" disabled={!compiled || busy} onClick={actions.certify}>
            {tr('صدّق', 'Certifier', 'Certify')}
          </Button>
        </span>
      </Tooltip>
      <ToolbarSeparator />
      <PublishButton gate={gate} busy={busy} onClick={actions.publish} />
      <Button icon={GitBranch} variant="subtle" disabled={status !== 'PUBLISHED' || busy} onClick={actions.revise}>
        {tr('راجع', 'Réviser', 'Revise')}
      </Button>
      {status === 'ARCHIVED' ? (
        <Button icon={ArchiveRestore} variant="subtle" disabled={busy} onClick={actions.restore}>
          {tr('استعد', 'Restaurer', 'Restore')}
        </Button>
      ) : (
        <Tooltip
          content={
            draft
              ? tr('يُخفي النموذج من القوائم دون حذفه.', 'Retire le modèle des listes sans le supprimer.', 'Hides the model from lists without deleting it.')
              : tr('الأرشفة تحتاج مسوّدة. أعِده إلى مسوّدة أولًا.', 'L’archivage exige un brouillon. Repassez-le en brouillon.', 'Archiving needs a draft. Reopen it as a draft first.')
          }
        >
          <span style={{ display: 'inline-flex' }}>
            <Button icon={Archive} variant="subtle" disabled={!draft || busy} onClick={actions.archive}>
              {tr('أرشِف', 'Archiver', 'Archive')}
            </Button>
          </span>
        </Tooltip>
      )}
      <ToolbarSpacer />
      <ViewSwitch view={view} onCommand={onCommand} size="sm" />
    </>
  );
}
/* ------------------------------------------------------------------ *
 * The certificate
 * ------------------------------------------------------------------ */

/**
 * One check, as a property row.
 *
 * Three registers stacked deliberately: the *name* in the reader's language, the *digits* the run
 * measured, and the engine's own English `detail` beneath them. A reader of Arabic learns from the
 * name what was tested and from `12 / 2` how it came out, without depending on the sentence — which
 * is the whole reason `labels.ts` carries names and the engine carries prose.
 *
 * `where` is rendered whenever it is non-empty and nothing decides whether to hide it, because the
 * engine already decided: it documents the list as empty for a check that passed.
 */
function CheckRow({ check }: { readonly check: Check }) {
  const { t, lang } = useLocale();
  const measured = check.measured === null ? null : fmt.amount(check.measured, lang);
  const threshold = check.threshold === null ? null : fmt.amount(check.threshold, lang);
  return (
    <PropertyRow label={t(CHECK_LABEL[check.kind])}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end', textAlign: 'end', minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {measured === null ? null : (
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
              {threshold === null ? measured : `${measured} / ${threshold}`}
            </span>
          )}
          <Badge tone={OUTCOME_TONE[check.outcome]}>{t(OUTCOME_LABEL[check.outcome])}</Badge>
        </span>
        {check.detail === '' ? null : (
          <span style={{ fontSize: 11, opacity: 0.7, wordBreak: 'break-word' }}>{check.detail}</span>
        )}
        {check.where.length === 0 ? null : (
          <span style={{ fontSize: 11, opacity: 0.6, fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all' }}>
            {check.where.join(', ')}
          </span>
        )}
      </span>
    </PropertyRow>
  );
}
/**
 * What was certified, and how the nine came out.
 *
 * The period is printed one higher than it is stored. `Target.period` is an index into the series
 * and the axis a reader sees is one-based — "period 0" is a fact about an array, not about a plan.
 *
 * Zero counts are omitted rather than drawn as `0`. A tally reading `9 pass` says everything;
 * `9 pass · 0 warn · 0 fail · 0 unmeasured` says the same thing while inviting the eye to check
 * four numbers, three of which cannot matter.
 */
function CertificateFacts({ certificate }: { readonly certificate: Certificate }) {
  const { t, tr, lang } = useLocale();
  const { target } = certificate;
  const at = target.kind === 'AT'
    ? `${t(TARGET_KIND_LABEL.AT)} ${fmt.integer(target.period + 1, lang)}`
    : t(TARGET_KIND_LABEL[target.kind]);
  return (
    <>
      <PropertyRow label={tr('الهدف', 'Cible', 'Target')}>
        {target.key === '' ? '—' : `${target.key} · ${at}`}
      </PropertyRow>
      <PropertyRow label={tr('السيناريو', 'Scénario', 'Scenario')}>
        {certificate.scenario === '' ? '—' : certificate.scenario}
      </PropertyRow>
      <PropertyRow label={tr('الحصيلة', 'Bilan', 'Tally')}>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Badge tone="success">{`${fmt.integer(certificate.passed, lang)} ${t(OUTCOME_LABEL.PASS)}`}</Badge>
          {certificate.warned === 0 ? null : (
            <Badge tone="warning">{`${fmt.integer(certificate.warned, lang)} ${t(OUTCOME_LABEL.WARN)}`}</Badge>
          )}
          {certificate.failed === 0 ? null : (
            <Badge tone="danger">{`${fmt.integer(certificate.failed, lang)} ${t(OUTCOME_LABEL.FAIL)}`}</Badge>
          )}
          {certificate.unmeasured === 0 ? null : (
            <Badge tone="neutral">{`${fmt.integer(certificate.unmeasured, lang)} ${t(OUTCOME_LABEL.UNMEASURED)}`}</Badge>
          )}
        </span>
      </PropertyRow>
      <PropertyRow label={tr('بصمة النموذج', 'Empreinte du modèle', 'Model hash')} mono>
        {certificate.fullHash}
      </PropertyRow>
    </>
  );
}
/**
 * One certificate, whole.
 *
 * The grade goes in the card's title and its meaning in the subtitle, so the sentence explaining
 * what the grade licenses cannot be scrolled away from the badge that claims it. `GRADE_MEANING`
 * is one line in three languages and this is the only place it is read — a reader who already
 * knows what PROVISIONAL means loses nothing by seeing it again, and one who does not is told
 * without having to go looking.
 *
 * `current` draws a second badge rather than changing the first. "Was certified, then edited" is
 * not a worse grade, it is a *stale* one: the checks all passed against a model that no longer
 * exists, and recolouring CERTIFIED to amber would misreport what the run found.
 *
 * Limitations are English paragraphs the engine wrote from the numbers it saw, so they render as
 * they arrive — the same bargain `CheckRow` makes with `detail`, and for the same reason.
 */
export interface CertificateCardProps {
  readonly certificate: Certificate;
  /** When it was stored. Null for one computed a moment ago and not yet recorded. */
  readonly when: string | null;
  /** It describes the model as it stands now. */
  readonly current: boolean;
}

export function CertificateCard({ certificate, when, current }: CertificateCardProps) {
  const { t, tr, lang } = useLocale();
  return (
    <Card
      icon={certificate.grade === 'CERTIFIED' ? ShieldCheck : CircleAlert}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Badge tone={GRADE_TONE[certificate.grade]}>{t(GRADE_LABEL[certificate.grade])}</Badge>
          {current ? null : (
            <Badge tone="warning" icon={TriangleAlert}>
              {tr('لم يعد يصف النموذج', 'Ne décrit plus le modèle', 'No longer the current model')}
            </Badge>
          )}
        </span>
      }
      subtitle={t(GRADE_MEANING[certificate.grade])}
      actions={when === null ? null : <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>{fmt.dateTime(when, lang)}</span>}
    >
      <CertificateFacts certificate={certificate} />
      {certificate.checks.map((check) => <CheckRow key={check.kind} check={check} />)}
      {certificate.limitations.length === 0 ? null : (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--fx-divider)' }}>
          <div style={{ fontSize: 'var(--fx-caption)', fontWeight: 600, marginBottom: 4 }}>
            {tr('القيود', 'Limites', 'Limitations')}
          </div>
          {certificate.limitations.map((line) => (
            <p key={line} style={{ margin: '0 0 6px', fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)', lineHeight: 1.5 }}>
              {line}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}
/**
 * The certificate aside: what the last run measured, and what has been recorded before.
 *
 * The live certificate is not yet a record — nothing is stored until somebody asks — so the store
 * button is the one command in this panel. It refuses a second time in two cases: while a command
 * is in flight, and when the newest record already carries this run's `resultsHash`. The second is
 * the interesting one. A certificate is a measurement of a *shape*, so recording the same shape
 * twice adds a row and no information, and the button says which of the two it is rather than
 * greying out and leaving the reader to guess.
 *
 * History is rendered with the same `CertificateCard` as the live one. A stored PROVISIONAL and a
 * PROVISIONAL computed thirty milliseconds ago are the same object by the time they reach here —
 * that is what `document.ts` rebuilding the engine's `Certificate` out of JSON buys.
 */
export interface CertificateAsideProps {
  /** What the engine measured on the last run. Null when the model does not compile. */
  readonly live: Certificate | null;
  readonly history: readonly CertificateRecord[];
  readonly onStore: () => void;
  readonly storing: boolean;
  readonly loading: boolean;
}

export function CertificateAside({ live, history, onStore, storing, loading }: CertificateAsideProps) {
  const { tr } = useLocale();
  const newest = history[0];
  const recorded = live !== null && newest !== undefined && newest.certificate.resultsHash === live.resultsHash;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {live === null ? (
        <EmptyState
          compact
          icon={BadgeCheck}
          title={tr('لا شهادة', 'Aucun certificat', 'No certificate')}
          description={tr(
            'النموذج لا يُترجَم، فلا شيء ليُقاس.',
            'Le modèle ne compile pas : il n’y a rien à mesurer.',
            'The model does not compile, so there is nothing to measure.',
          )}
        />
      ) : (
        <>
          <Button
            icon={BadgeCheck}
            variant="accent"
            block
            busy={storing}
            disabled={storing || recorded}
            onClick={onStore}
            title={recorded ? tr('هذه الشهادة مسجّلة سابقًا.', 'Ce certificat est déjà enregistré.', 'This certificate is already on record.') : undefined}
          >
            {recorded ? tr('مسجّلة', 'Déjà enregistré', 'Already recorded') : tr('سجّل الشهادة', 'Enregistrer le certificat', 'Record this certificate')}
          </Button>
          <CertificateCard certificate={live} when={null} current />
        </>
      )}
      {history.length === 0 ? null : (
        <Section title={tr('السجل', 'Historique', 'On record')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map((record) => (
              <CertificateCard
                key={record.id}
                certificate={record.certificate}
                when={record.createdAt}
                current={record.describesCurrent}
              />
            ))}
          </div>
        </Section>
      )}
      {loading && history.length === 0 ? (
        <StatusItem icon={Clock}>{tr('يُحمَّل السجل…', 'Chargement de l’historique…', 'Loading history…')}</StatusItem>
      ) : null}
    </div>
  );
}
/* ------------------------------------------------------------------ *
 * When the model will not compile
 * ------------------------------------------------------------------ */

/**
 * The four stages, named by what the reader has to go and fix.
 *
 * Keyed off `ModelFailure['stage']` rather than a hand-written union, so a fifth compile stage
 * breaks this record in the commit that adds it. Compilation stops at the first stage that fails,
 * which is why the title says *which* stage: "the model does not compile" is true of all four and
 * useful in none of them.
 */
const STAGE_TITLE: Readonly<Record<ModelFailure['stage'], Localized>> = {
  SPEC: { ar: 'خلل في بنية النموذج', fr: 'Défaut de structure', en: 'The document itself is wrong' },
  PARSE: { ar: 'صيغة لم تُترجَم', fr: 'Une formule ne compile pas', en: 'A formula will not parse' },
  GRAPH: { ar: 'خلل في شبكة الاعتماد', fr: 'Défaut du graphe de dépendances', en: 'The dependency graph is broken' },
  SCENARIO: { ar: 'خلل في شجرة السيناريوهات', fr: 'Défaut de l’arbre des scénarios', en: 'The scenario tree is broken' },
};

/** One line per fault: a name to translate, and the keys it happened to, which are not translated. */
interface FailureLine {
  readonly id: string;
  readonly label: Localized;
  readonly detail: string;
}

/**
 * The four arms, flattened into lines.
 *
 * Every `detail` is keys and digits rather than prose — `gross_margin → revenue`, not "gross_margin
 * reads revenue, which no row defines". The sentence is in the label, in the reader's language; the
 * arrow carries what the sentence cannot know. A `MISSING` names the formula that read the absent
 * key first, because "revenue is missing" sends somebody looking at revenue, which is not there.
 */
function failureLines(failure: ModelFailure): readonly FailureLine[] {
  switch (failure.stage) {
    case 'SPEC':
      return failure.issues.map((issue) => ({
        id: `${issue.kind}:${issue.where}`,
        label: SPEC_ISSUE_LABEL[issue.kind],
        detail: issue.where,
      }));
    case 'PARSE':
      return failure.issues.map((issue) => ({
        id: `${issue.key}:${issue.error.at}:${issue.error.code}`,
        label: PARSE_ERROR_LABEL[issue.error.code],
        detail: issue.error.text === '' ? `${issue.key} · ${issue.error.at}` : `${issue.key} · ${issue.error.at} · ${issue.error.text}`,
      }));
    case 'GRAPH':
      return failure.issues.map((issue) => ({
        id: issue.kind === 'CYCLE' ? `CYCLE:${issue.path.join('>')}` : `${issue.kind}:${issue.key}`,
        label: GRAPH_ISSUE_LABEL[issue.kind],
        detail:
          issue.kind === 'MISSING' ? `${issue.readBy} → ${issue.key}`
          : issue.kind === 'SHADOWED' ? issue.key
          : issue.path.join(' → '),
      }));
    case 'SCENARIO':
      return failure.issues.map((issue) => ({
        id: `${issue.kind}:${issue.where}`,
        label: SCENARIO_ISSUE_LABEL[issue.kind],
        detail: issue.path.length === 0 ? issue.where : `${issue.where} · ${issue.path.join(' → ')}`,
      }));
  }
}
/**
 * The compile failure, in an `InfoBar` rather than a toast.
 *
 * A toast is the wrong shape for this: it goes away, and a model that does not compile stays not
 * compiling until somebody edits it. So the report sits in the document where the grid would have
 * been, listing every fault the failed stage found rather than the first — the stages themselves
 * are ordered, but within one stage a reader may as well fix all four bad keys in one pass.
 */
export function FailureReport({ failure }: { readonly failure: ModelFailure }) {
  const { t } = useLocale();
  const lines = failureLines(failure);
  return (
    <InfoBar tone="danger" icon={CircleAlert} title={t(STAGE_TITLE[failure.stage])}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {lines.map((line) => (
          <div key={line.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span>{t(line.label)}</span>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>
              {line.detail}
            </span>
          </div>
        ))}
      </div>
    </InfoBar>
  );
}

/* ------------------------------------------------------------------ *
 * The status strip
 * ------------------------------------------------------------------ */

/**
 * Six facts, none of them a spinner.
 *
 * The counts come off the document rather than the compiled model, so they are the same whether the
 * model compiles or not — a strip that empties out when a formula breaks is a strip that stops
 * answering "how big is this thing" exactly when somebody needs to know. The hash is the one fact
 * that requires a successful compile, so it is the one that goes absent.
 */
export interface WorkbenchStatusProps {
  readonly document: ModelDocument | null;
  readonly version: ModelVersion | null;
}

export function WorkbenchStatus({ document, version }: WorkbenchStatusProps) {
  const { tr, lang } = useLocale();
  if (document === null) {
    return <StatusItem icon={Sheet}>{tr('لا نموذج مفتوح', 'Aucun modèle ouvert', 'No model open')}</StatusItem>;
  }
  const { header, spec, rows, assumptions, scenarios } = document;
  return (
    <>
      <StatusItem icon={Table2} title={tr('الفترات', 'Périodes', 'Periods')}>
        {fmt.integer(spec.periods.length, lang)}
      </StatusItem>
      <StatusItem icon={Layers} title={tr('الأسطر', 'Lignes', 'Rows')}>{fmt.integer(rows.length, lang)}</StatusItem>
      <StatusItem icon={Calculator} title={tr('الافتراضات', 'Hypothèses', 'Assumptions')}>
        {fmt.integer(assumptions.length, lang)}
      </StatusItem>
      <StatusItem icon={GitBranch} title={tr('السيناريوهات', 'Scénarios', 'Scenarios')}>
        {fmt.integer(scenarios.length, lang)}
      </StatusItem>
      {version === null ? (
        <StatusItem icon={CircleAlert} tone="danger">
          {tr('لا يُترجَم', 'Ne compile pas', 'Does not compile')}
        </StatusItem>
      ) : (
        <StatusItem icon={Hash} title={tr('بصمة النتائج', 'Empreinte des résultats', 'Results hash')}>
          {version.resultsHash}
        </StatusItem>
      )}
      {header.updatedAt === null ? null : (
        <StatusItem icon={Clock} title={tr('آخر تعديل', 'Dernière modification', 'Last edited')}>
          {fmt.relativeTime(header.updatedAt, lang)}
        </StatusItem>
      )}
    </>
  );
}

