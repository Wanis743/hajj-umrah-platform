/**
 * What the engine read out of a document, and what a person decided about it.
 *
 * The last section of the inspector, in its own file because `DmsDocument360` carries seven
 * collections and this one is two levels deep: a document has extraction jobs, and a job has
 * fields. Six of the seven are flat lists that `detail.tsx` can render in a dozen lines each;
 * this one is a table inside a card inside a list, with three verbs hanging off every row.
 *
 * The three verbs are the reason the panel exists at all. Everything else in the inspector is
 * a reading — dates, checksums, links, a history — and this is the one place a reviewer *acts*
 * on what they are looking at, field by field, without leaving the pane. `shell.judgeField`
 * curries so a row renders its three buttons from one call, and `ACCEPT`/`REJECT` go straight
 * out while `CORRECT` opens for the value, because the first two are verdicts on something
 * already on screen and the third is a piece of typing.
 *
 * A job may be reported failed and may never be reported complete. That asymmetry is
 * deliberate and lives in `commitFailJob`'s note: a person clicking a button has not run an
 * engine, and a `completed` job with no fields behind it would put a false accuracy into the
 * quality report that the extraction tab draws.
 */
import { Ban, Check, PencilLine, ScanText } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  fmt,
  IconButton,
  InfoBar,
  Section,
  useLocale,
  type AppLang,
} from '@/platform/sdk';
import { Confidence, Stack, StateChip } from './cells';
import { int } from './format';
import { EXTRACTION_LABEL, FIELD_REVIEW_LABEL, JOB_REVIEW_LABEL } from './labels';
import { EXTRACTION_TONE, FIELD_REVIEW_TONE, JOB_REVIEW_TONE } from './tones';
import type { DmsShell } from './shell';
import type { DmsField, DmsJob } from './types';

/**
 * Label, value, confidence, page, verdict, buttons.
 *
 * One template shared by the header and every row so the columns line up down the card. A real
 * `DataGrid` would give sorting and selection this table has no use for, and would put a
 * scrollbar inside a card that is already inside the inspector's scroller.
 */
const FIELD_GRID = '1.3fr 1.6fr 62px 46px 118px auto';

/** How long the engine actually spent, when both ends of the run are known. */
function elapsed(job: DmsJob, lang: AppLang): string | null {
  if (job.startedAt === null || job.finishedAt === null) return null;
  const from = new Date(job.startedAt).getTime();
  const to = new Date(job.finishedAt).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return fmt.duration(to - from, lang);
}

interface FieldProps {
  readonly field: DmsField;
  readonly shell: DmsShell;
}

/**
 * The three things a reviewer may say about one extracted value.
 *
 * Icons rather than words because the column repeats forty times down a passport's worth of
 * fields, and each carries its verb as a tooltip. Accept is green and reject is red; correct is
 * neutral, because it is neither approval nor refusal — it is the reviewer typing what the
 * document actually says. All three go out of service together while a verdict is in flight:
 * `busy` is app-wide rather than per-field, and two verdicts racing on one field would leave
 * the second one's answer in place with no way to tell which won.
 */
function Verdicts({ field, shell }: FieldProps) {
  const { tr } = useLocale();
  const judge = shell.judgeField(field);
  const busy = shell.busy === 'field';
  return (
    <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
      <IconButton
        icon={Check}
        label={tr('اعتماد', 'Accepter', 'Accept')}
        onClick={() => judge('ACCEPT')}
        disabled={busy}
        tone="success"
        size={14}
      />
      <IconButton
        icon={PencilLine}
        label={tr('تصحيح', 'Corriger', 'Correct')}
        onClick={() => judge('CORRECT')}
        disabled={busy}
        size={14}
      />
      <IconButton
        icon={Ban}
        label={tr('رفض', 'Rejeter', 'Reject')}
        onClick={() => judge('REJECT')}
        disabled={busy}
        tone="danger"
        size={14}
      />
    </div>
  );
}

/**
 * One extracted value, and what has been said about it.
 *
 * Both the key and the label are shown because they answer different questions: the label is
 * what the engine called the field, the key is what the rest of the system will look it up by,
 * and a reviewer chasing a mapping bug needs to see the second. Where the two agree — an engine
 * that emits no labels — only one line is drawn rather than the same string twice.
 *
 * The value column works the same way for a different reason. A corrected field keeps the
 * engine's original reading in `rawValue`, and showing it beneath the correction is how anybody
 * later can tell that a human intervened here at all: the review state says *that* somebody
 * corrected it, and this line says what they corrected it from.
 */
function FieldRow({ field, shell }: FieldProps) {
  const { lang, tr } = useLocale();
  const label = field.fieldLabel === '' ? field.fieldKey : field.fieldLabel;
  const corrected = field.value !== '' && field.rawValue !== '' && field.value !== field.rawValue;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: FIELD_GRID,
        gap: 8,
        alignItems: 'center',
        padding: '5px 0',
        borderTop: '1px solid var(--fx-divider)',
      }}
    >
      <Stack
        title={label}
        caption={label === field.fieldKey ? null : field.fieldKey}
        hint={field.fieldKey}
      />
      <Stack
        title={field.value === '' ? field.rawValue : field.value}
        caption={corrected ? field.rawValue : null}
        hint={corrected ? tr('قراءة المحرّك', 'Lecture du moteur', 'Engine read') : undefined}
      />
      <Confidence value={field.confidence} />
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fx-text-secondary)' }}>
        {int(field.pageNumber, lang)}
      </span>
      <StateChip value={field.reviewState} tones={FIELD_REVIEW_TONE} labels={FIELD_REVIEW_LABEL} />
      <Verdicts field={field} shell={shell} />
    </div>
  );
}

interface JobProps {
  readonly job: DmsJob;
  readonly shell: DmsShell;
}

/**
 * The fields of one job, under a header that names the columns.
 *
 * A queued or running job has no fields yet, and a completed one that found none is a real
 * answer rather than an error — so the empty state says which of the two it is by leaning on
 * the status the card header is already showing rather than repeating it.
 */
function FieldTable({ job, shell }: JobProps) {
  const { tr } = useLocale();
  if (job.fields.length === 0) {
    return (
      <EmptyState
        compact
        icon={ScanText}
        title={tr('لا حقول', 'Aucun champ', 'No fields')}
        description={tr(
          'لم يُرجع هذا التشغيل أي قيمة.',
          'Cette exécution n’a retourné aucune valeur.',
          'This run returned no values.',
        )}
      />
    );
  }
  return (
    <div style={{ display: 'grid' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: FIELD_GRID,
          gap: 8,
          paddingBottom: 4,
          fontSize: 'var(--fx-caption)',
          color: 'var(--fx-text-tertiary)',
        }}
      >
        <span>{tr('الحقل', 'Champ', 'Field')}</span>
        <span>{tr('القيمة', 'Valeur', 'Value')}</span>
        <span>{tr('الثقة', 'Confiance', 'Conf.')}</span>
        <span>{tr('صفحة', 'Page', 'Page')}</span>
        <span>{tr('الحكم', 'Verdict', 'Verdict')}</span>
        <span />
      </div>
      {job.fields.map((field) => (
        <FieldRow key={field.id} field={field} shell={shell} />
      ))}
    </div>
  );
}

const CAPTION = { color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' } as const;

/**
 * One extraction run: what the engine reported, and the one verb a person has over it.
 *
 * The header carries both state columns because they answer different questions — `status` is
 * the engine's own outcome and `reviewState` is how far a human has got through the fields it
 * produced, and a `completed` job that nobody has looked at is the common case this section
 * exists to surface. Attempts sits beside them because a job on its third try is a story.
 *
 * The button is offered only while the run is not already failed. Marking a failed job failed
 * again writes a row that says nothing, and `recordExtraction` has no other outcome a person
 * may honestly record — see `commitFailJob`.
 */
function JobCard({ job, shell }: JobProps) {
  const { lang, tr } = useLocale();
  const ran = elapsed(job, lang);
  const queued = fmt.dateTime(job.createdAt, lang);
  return (
    <Card
      icon={ScanText}
      title={job.engine === '' ? tr('محرّك بلا اسم', 'Moteur sans nom', 'Unnamed engine') : job.engine}
      subtitle={ran === null ? queued : `${queued} · ${ran}`}
      actions={
        job.status === 'failed' ? undefined : (
          <Button
            variant="subtle"
            size="sm"
            onClick={() => shell.failJob(job)}
            disabled={shell.busy === 'record'}
            title={tr(
              'تسجيل هذا التشغيل كفاشل',
              'Enregistrer cette exécution comme échouée',
              'Record this run as failed',
            )}
          >
            {tr('تعليمه كفاشل', 'Marquer échoué', 'Mark failed')}
          </Button>
        )
      }
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <StateChip value={job.status} tones={EXTRACTION_TONE} labels={EXTRACTION_LABEL} />
          <StateChip value={job.reviewState} tones={JOB_REVIEW_TONE} labels={JOB_REVIEW_LABEL} />
          <span style={CAPTION}>{tr('محاولات', 'Tentatives', 'Attempts')}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{int(job.attempts, lang)}</span>
          <span style={CAPTION}>{tr('الثقة', 'Confiance', 'Conf.')}</span>
          <Confidence value={job.confidence} />
        </div>
        {job.errorMessage === '' ? null : (
          <InfoBar tone="danger" title={tr('فشل التشغيل', 'Exécution échouée', 'Run failed')}>
            {job.errorMessage}
          </InfoBar>
        )}
        <FieldTable job={job} shell={shell} />
      </div>
    </Card>
  );
}

export interface DmsExtractionProps {
  /** `DmsDocument360.jobs`, in whatever order the projection returned them. */
  readonly jobs: readonly DmsJob[];
  readonly shell: DmsShell;
}

/**
 * The extraction section of the inspector — every run over this document, one card each.
 *
 * Takes the jobs rather than reading `shell.model.selected` itself, so `detail.tsx` stays the
 * one place that unwraps the 360 report and this stays a section that can be dropped anywhere
 * a list of jobs is in hand.
 *
 * The header counts fields still awaiting a verdict against the total, because that is the
 * number a reviewer is working down and it is not visible anywhere else on the pane: a job may
 * read `PARTIALLY_REVIEWED` for one remaining field or for thirty.
 */
export function DmsExtraction({ jobs, shell }: DmsExtractionProps) {
  const { lang, tr } = useLocale();
  const fields = jobs.reduce((total, job) => total + job.fields.length, 0);
  const pending = jobs.reduce(
    (total, job) => total + job.fields.filter((field) => field.reviewState === 'PENDING').length,
    0,
  );
  return (
    <Section
      title={tr('الاستخراج', 'Extraction', 'Extraction')}
      action={
        fields === 0 ? undefined : (
          <span style={CAPTION}>
            {tr('بانتظار حكم', 'En attente de verdict', 'Awaiting verdict')}{' '}
            {`${int(pending, lang)} / ${int(fields, lang)}`}
          </span>
        )
      }
    >
      {jobs.length === 0 ? (
        <EmptyState
          compact
          icon={ScanText}
          title={tr('لا استخراج', 'Aucune extraction', 'No extraction')}
          description={tr(
            'لم يُشغَّل أي محرّك على هذا المستند.',
            'Aucun moteur n’a été exécuté sur ce document.',
            'No engine has been run over this document.',
          )}
        />
      ) : (
        jobs.map((job) => <JobCard key={job.id} job={job} shell={shell} />)
      )}
    </Section>
  );
}
