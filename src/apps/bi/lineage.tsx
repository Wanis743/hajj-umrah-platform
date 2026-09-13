/**
 * What this definition is built on, and what is built on it.
 *
 * One pane, in its own file because it answers a different question from the rest of the
 * 360. `detail.tsx` describes a record — here is the dataset, here are its metrics. This
 * describes a *blast radius*: if I change this, what moves. It pre-empts the inspector
 * rather than sitting beside it, because the question is always asked about a definition
 * the reader has already selected and is answered in the same rectangle.
 *
 * ## Upstream says which kind of claim it is making
 *
 * A column found in the source registry is a fact the catalog knows. A column recovered
 * by reading the definition's own SQL is a guess made by a regex, and `via: 'expression'`
 * is how the server admits that. Drawing both as the same word would launder the second
 * into the first, so they carry different chips and different tooltips.
 *
 * ## Downstream is drawn before the lists, not after
 *
 * *Four analyses on two published dashboards* is the sentence that stops a deprecation.
 * A reader who has to count rows to learn it has already started scrolling, so the
 * numbers come first and the rows that justify them come after.
 *
 * The pane is split into three functions for length, and the seam is the reader's own:
 * {@link LineageFacts} is the four-and-four property rows a decision is made from, and
 * {@link LineageLists} is the evidence behind them. Neither holds state; both take the
 * trace they draw.
 */
import type { ReactElement } from 'react';
import { AlertTriangle, ArrowLeft, GitBranch } from 'lucide-react';
import {
  EmptyState,
  fmt,
  IconButton,
  InfoBar,
  PropertyRow,
  Section,
  useLocale,
} from '@/platform/sdk';

import { Chip, Count, Dash, Stack, StateChip } from './cells';
import { DASH, int } from './format';
import { CHART_LABEL, ENTITY_KIND_LABEL, STATUS_LABEL } from './labels';
import { Waiting } from './pane';
import type { Desk } from './pane';
import { CAPTION, PANE, ROW, WRAP } from './styles';
import { readableTone, statusTone, STATUS_TONE } from './tones';
import type { BiEntityKind, BiLineage, BiLineageAnalysis, BiLineageDependent } from './types';

/** What both halves need: the trace, and nothing else. Neither half commands anything. */
interface Trace {
  readonly trace: BiLineage;
}

/**
 * The four numbers, and the source underneath them.
 *
 * `dashboards` and `publishedDashboards` are drawn on one line — *2 (1 published)* —
 * because side by side as two rows they read as three dashboards. `measuredAt` is when
 * the registry last re-measured the source's columns, which is what dates the upstream
 * list below and is therefore stated beside the impact rather than inside it.
 *
 * The source block is omitted entirely when the trace carries none. A metric defined as
 * a ratio of two other metrics reads no source of its own, and an empty *Source* section
 * would invite the reader to wonder which one failed to load.
 */
function LineageFacts({ trace }: Trace): ReactElement {
  const { tr, lang } = useLocale();

  return (
    <>
      <Section title={tr('الأثر', 'Impact', 'Impact')}>
        <div>
          <PropertyRow label={tr('التحليلات', 'Analyses', 'Analyses')}>
            <Count value={trace.impact.analyses} />
          </PropertyRow>
          <PropertyRow label={tr('اللوحات', 'Tableaux de bord', 'Dashboards')}>
            {`${int(trace.impact.dashboards, lang)} (${int(trace.impact.publishedDashboards, lang)} ${tr('منشورة', 'publiés', 'published')})`}
          </PropertyRow>
          <PropertyRow label={tr('تعريفات تابعة', 'Définitions dépendantes', 'Dependent definitions')}>
            <Count value={trace.impact.dependentDefinitions} />
          </PropertyRow>
          <PropertyRow label={tr('آخر قياس', 'Dernière mesure', 'Last measured')}>
            {trace.measuredAt === null ? <Dash /> : fmt.dateTime(trace.measuredAt, lang)}
          </PropertyRow>
        </div>
      </Section>

      {trace.source === null ? null : (
        <Section title={tr('المصدر', 'Source', 'Source')}>
          <div>
            <PropertyRow label={tr('الاسم', 'Nom', 'Name')}>{trace.source.name}</PropertyRow>
            <PropertyRow label={tr('العلاقة', 'Relation', 'Relation')} mono>
              {trace.source.relation}
            </PropertyRow>
            <PropertyRow label={tr('الإذن', 'Permission', 'Permission')} mono>
              {trace.source.requiredPermission}
            </PropertyRow>
            <PropertyRow label={tr('القراءة', 'Lecture', 'Readable')}>
              <Chip
                text={trace.source.readableByMe ? tr('متاح', 'Oui', 'Yes') : tr('ممنوع', 'Non', 'No')}
                tone={readableTone(trace.source.readableByMe)}
              />
            </PropertyRow>
          </div>
        </Section>
      )}
    </>
  );
}

/**
 * The evidence: which columns, which analyses, which dashboards, which definitions.
 *
 * Four lists, and three of them vanish when empty while the first does not. *Columns used:
 * none* is worth printing, because a definition that reads no column of its own is either
 * a computed ratio or a broken expression and the reader should be told which is possible;
 * *dependent analyses: none* is the ordinary state of a new definition and a section
 * saying so four times over is noise.
 *
 * Every count on the right of a row is a second-order number — how many dashboards carry
 * this analysis, what status this dashboard is in — and each is drawn with
 * `marginInlineStart: 'auto'` rather than a grid column, because the pane is 360px and
 * the title beside it must be free to take whatever is left.
 */
function LineageLists({ trace }: Trace): ReactElement {
  const { t, tr } = useLocale();

  return (
    <>
      <Section title={tr('الأعمدة المُستخدَمة', 'Colonnes utilisées', 'Columns used')}>
        {trace.upstream.length === 0 ? (
          <span style={CAPTION}>{tr('لا شيء', 'Aucune', 'None')}</span>
        ) : (
          <div>
            {trace.upstream.map((column) => (
              <div key={`${column.via}:${column.columnName}`} style={ROW}>
                <span className="fx-mono fx-title-ellipsis" style={{ flex: 1, minWidth: 0 }}>
                  {column.columnName}
                </span>
                <span style={CAPTION}>{column.dataType ?? DASH}</span>
                <Chip
                  text={column.via === 'source'
                    ? tr('مسجَّل', 'Registre', 'Registered')
                    : tr('من التعبير', 'Expression', 'From SQL')}
                  tone={column.via === 'source' ? 'neutral' : 'warning'}
                  title={column.via === 'source'
                    ? tr(
                        'العمود معروف في سجل المصادر',
                        'La colonne figure au registre des sources',
                        'The column is known to the source registry',
                      )
                    : tr(
                        'استُخرج بقراءة تعبير التعريف، وهو ادّعاء أضعف',
                        'Extrait de l’expression de la définition : une affirmation plus faible',
                        'Recovered by reading the definition’s own SQL — a weaker claim',
                      )}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {trace.analyses.length === 0 ? null : (
        <Section title={tr('التحليلات التابعة', 'Analyses dépendantes', 'Dependent analyses')}>
          <div>
            {trace.analyses.map((one: BiLineageAnalysis) => (
              <div key={one.id} style={ROW}>
                <Stack
                  title={one.title}
                  caption={one.reportTitle ?? t(CHART_LABEL[one.chartType])}
                  hint={one.key}
                />
                <span style={{ marginInlineStart: 'auto', flex: 'none' }}>
                  <Count value={one.onDashboards} zero={false} />
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {trace.dashboards.length === 0 ? null : (
        <Section title={tr('اللوحات التابعة', 'Tableaux dépendants', 'Dependent dashboards')}>
          <div>
            {trace.dashboards.map((one) => (
              <div key={one.id} style={ROW}>
                <Stack title={one.title} caption={one.key} mono />
                <span style={{ marginInlineStart: 'auto', flex: 'none' }}>
                  <StateChip value={one.status} tones={STATUS_TONE} labels={STATUS_LABEL} />
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {trace.dependents.length === 0 ? null : (
        <Section title={tr('تعريفات تعتمد عليه', 'Définitions dépendantes', 'Dependent definitions')}>
          <div>
            {trace.dependents.map((one: BiLineageDependent) => (
              <div key={`${one.kind}:${one.id}`} style={ROW}>
                <Stack title={one.name} caption={one.key} mono />
                <span style={{ marginInlineStart: 'auto', flex: 'none', ...WRAP }}>
                  <Chip text={one.relation.replace(/_/g, ' ')} />
                  {one.status === null ? null : (
                    <StateChip value={one.status} tones={STATUS_TONE} labels={STATUS_LABEL} />
                  )}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/**
 * The trace, or a stated reason there is none.
 *
 * Three states and the back button survives all three, which is the point of declaring it
 * before the guards: a reader who opened lineage on a definition the server cannot trace
 * is still a reader who wants out of lineage, and a dead end with no way back is the one
 * failure this pane must not have.
 *
 * The warning bar above the sections fires on `publishedDashboards > 0` rather than on
 * `dashboards > 0`. A draft dashboard reading a definition about to be deprecated is a
 * problem for whoever is drafting it; a *published* one is a problem for everybody, and
 * it is also the condition the server's own deprecate guard refuses on — so the bar
 * appears under exactly the circumstance the verb will refuse.
 */
export function LineagePane({ shell }: Desk): ReactElement {
  const { t, tr } = useLocale();
  const read = shell.model.lineage;
  const trace = read.value;

  const back = (
    <IconButton
      icon={ArrowLeft}
      label={tr('رجوع', 'Retour', 'Back')}
      onClick={() => shell.showLineage(null)}
    />
  );

  if (read.loading && trace === null) return <Waiting />;
  if (trace === null) {
    return (
      <div style={PANE}>
        <div style={WRAP}>{back}</div>
        <EmptyState
          icon={GitBranch}
          title={tr('لا أثر', 'Aucune trace', 'No trace')}
          description={read.error ?? tr(
            'لم يُعِد الخادم نسبًا لهذا التعريف.',
            'Le serveur n’a renvoyé aucune traçabilité pour cette définition.',
            'The server returned no lineage for this definition.',
          )}
          compact
        />
      </div>
    );
  }

  const kindLabel = ENTITY_KIND_LABEL[trace.kind as BiEntityKind];

  return (
    <div style={PANE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {back}
        <span style={{ fontSize: 'var(--fx-subtitle)', fontWeight: 600, minWidth: 0 }} className="fx-title-ellipsis">
          {trace.label}
        </span>
      </div>
      <div style={WRAP}>
        <Chip text={kindLabel === undefined ? trace.kind : t(kindLabel)} tone="info" />
        <Chip
          text={trace.status === 'N/A' ? tr('تابع', 'Hérité', 'Inherited') : t(STATUS_LABEL[trace.status])}
          tone={statusTone(trace.status)}
          title={trace.status === 'N/A'
            ? tr(
                'حالة البُعد هي حالة مجموعة بياناته',
                'Le statut d’une dimension est celui de son jeu de données',
                'A dimension’s status is its dataset’s',
              )
            : undefined}
        />
        <span className="fx-mono" style={CAPTION}>{trace.key}</span>
      </div>

      {trace.impact.publishedDashboards > 0 ? (
        <InfoBar
          tone="warning"
          icon={AlertTriangle}
          title={tr('قيد الاستخدام المنشور', 'Utilisé en production', 'In published use')}
        >
          {tr(
            `${trace.impact.analyses} تحليلًا على ${trace.impact.publishedDashboards} لوحة منشورة تقرأ هذا التعريف.`,
            `${trace.impact.analyses} analyses sur ${trace.impact.publishedDashboards} tableaux publiés lisent cette définition.`,
            `${trace.impact.analyses} analyses on ${trace.impact.publishedDashboards} published dashboards read this definition.`,
          )}
        </InfoBar>
      ) : null}

      <LineageFacts trace={trace} />
      <LineageLists trace={trace} />
    </div>
  );
}
