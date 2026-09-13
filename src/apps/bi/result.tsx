/**
 * The result grid: the one grid in this app with no column table behind it.
 *
 * Every other list knows its columns before it runs, because every other list reads a
 * fixed projection. This one is built from `result.columns` at render time, since a
 * result's shape is whatever the reader put on the shelves — and that is the reason it
 * lives apart from `./detail.tsx`, whose panes are all the other kind.
 *
 * It is also content rather than aside. The inspector describes the row that is
 * selected; this *is* the answer, and it fills the content well while the shelves that
 * asked for it sit in the 360 beside it.
 */
import type { CSSProperties, ReactElement } from 'react';
import { AlertTriangle, MousePointerClick, SearchX } from 'lucide-react';
import {
  DataGrid,
  EmptyState,
  InfoBar,
  useLocale,
  type Column,
} from '@/platform/sdk';

import { ResultCell } from './cells';
import { int } from './format';
import type { BiShell } from './shell';
import type { BiColumn, BiRow } from './types';

/** The padding a refusal is read at. The grid itself is flush, because a virtualized
 *  scroller with a margin scrolls its own margin. */
const PANE: CSSProperties = {
  display: 'grid',
  gap: 14,
  alignContent: 'start',
  padding: 14,
  minWidth: 0,
};

/**
 * A result column as a grid column.
 *
 * The grid is built from `result.columns` at render time, because a result's shape is whatever
 * the reader put on the shelves — this is the one grid in the app with no column table. A row is
 * a `Readonly<Record<string, BiScalar>>` indexed by `column.alias`, which is the compiler's own
 * output name and the only key the row is guaranteed to carry; `column.key` is the definition's
 * key and collides across dimensions and metrics.
 *
 * Sorting is client-side over the page, and that is a real limitation stated rather than hidden:
 * a truncated result sorted here is the top N by the server's order re-sorted by the reader's,
 * not the top N by the reader's. The status bar says the result is truncated for exactly this
 * reason.
 */
function resultColumn(
  column: BiColumn,
  shell: BiShell,
  label: string,
  canDrill: boolean,
): Column<BiRow> {
  const measure = column.kind === 'METRIC';
  return {
    id: column.alias,
    header: label,
    align: measure ? 'end' : 'start',
    title: column.unit ?? undefined,
    render: (row) => {
      const value = row[column.alias] ?? null;
      if (!canDrill) return <ResultCell value={value} column={column} />;
      return (
        <button
          type="button"
          title={column.drillToKey === null
            ? undefined
            : `${label} → ${column.drillToKey}`}
          onClick={() => shell.drillDown(column, value, label)}
          onDoubleClick={() => shell.drillThrough(column, value, label)}
          style={{
            all: 'unset',
            cursor: 'pointer',
            minWidth: 0,
            textDecoration: 'underline',
            textDecorationStyle: 'dotted',
            textUnderlineOffset: 3,
          }}
        >
          <ResultCell value={value} column={column} />
        </button>
      );
    },
    sort: (a, b) => {
      const left = a[column.alias] ?? null;
      const right = b[column.alias] ?? null;
      if (typeof left === 'number' && typeof right === 'number') return left - right;
      return String(left ?? '').localeCompare(String(right ?? ''));
    },
  };
}

export interface BiResultTableProps {
  readonly shell: BiShell;
}

/**
 * The answer, once there is one.
 *
 * Four states again, and the middle two matter as much here as in the 360. A run that has not
 * returned is *running*; a run that was refused is the refusal, in full, because a compiler's
 * sentence about an unknown metric key is the most useful thing on the screen; a run that
 * returned nothing is nothing, which is an answer; and a run that returned rows is the grid.
 *
 * A dimension cell is clickable in two ways and they ask different questions. A single click
 * drills *down* — regroup by the next dimension in the hierarchy, filtered to this mark, which
 * is a new query over the same aggregate. A double click drills *through* — which rows is this
 * mark made of, which leaves the semantic layer entirely and lands in the app that owns them.
 * `drillStepFor` returns null for a metric cell, for the invented period column and for a
 * dimension with nowhere to go, which is how the first is refused; the second is always offered,
 * because every dimension value stands for rows even when it does not drill.
 */
export function BiResultTable({ shell }: BiResultTableProps): ReactElement {
  const { t, tr, lang } = useLocale();
  const result = shell.result;

  if (shell.queryError !== null) {
    return (
      <div style={{ ...PANE, paddingTop: 24 }}>
        <InfoBar
          tone="danger"
          icon={AlertTriangle}
          title={tr('رُفض الاستعلام', 'Requête refusée', 'The query was refused')}
        >
          <span className="fx-mono" style={{ whiteSpace: 'pre-wrap' }}>{shell.queryError}</span>
        </InfoBar>
      </div>
    );
  }

  if (result === null) {
    return (
      <EmptyState
        icon={MousePointerClick}
        title={tr('لم يُشغَّل شيء بعد', 'Rien n’a encore été exécuté', 'Nothing has been run yet')}
        description={tr(
          'ضع بُعدًا ومقياسًا على الرفوف، ثم شغِّل.',
          'Posez une dimension et une mesure sur les étagères, puis exécutez.',
          'Put a dimension and a metric on the shelves, then run.',
        )}
      />
    );
  }

  const columns: readonly Column<BiRow>[] = result.columns.map((column) => {
    const label = column.labelAr === null ? column.label : t({ ar: column.labelAr, fr: column.label, en: column.label });
    return resultColumn(column, shell, label, column.kind === 'DIMENSION');
  });

  /**
   * A row's key is its position, looked up by object identity.
   *
   * Not a hash of the cell values, which is the obvious choice and the wrong one: two
   * identical rows are an ordinary result — `GROUP BY` over a subset of the dimensions
   * that distinguish them — and a key built from their contents would collide, which
   * React answers by dropping one of them.
   */
  const rowKeys = new Map<BiRow, string>();
  result.rows.forEach((row, index) => rowKeys.set(row, String(index)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      {result.truncated ? (
        <div style={{ padding: '8px 12px 0' }}>
          <InfoBar
            tone="warning"
            icon={AlertTriangle}
            title={tr('نتيجة مقتطعة', 'Résultat tronqué', 'Truncated result')}
          >
            {tr(
              `عاد ${int(result.rowCount, lang)} صفًا عند حد ${int(result.rowLimit, lang)}. كل مجموع تقرؤه هنا مجموع جزئي.`,
              `${int(result.rowCount, lang)} lignes revenues à la limite de ${int(result.rowLimit, lang)}. Tout total lu ici est partiel.`,
              `${int(result.rowCount, lang)} rows came back at the limit of ${int(result.rowLimit, lang)}. Every total you read here is a partial total.`,
            )}
          </InfoBar>
        </div>
      ) : null}
      <DataGrid
        rows={result.rows}
        columns={columns}
        rowKey={(row) => rowKeys.get(row) ?? ''}
        loading={shell.busy === 'query'}
        density="compact"
        virtualized
        rowHeight={33}
        empty={
          <EmptyState
            icon={SearchX}
            title={tr('لا صفوف', 'Aucune ligne', 'No rows')}
            description={tr(
              'تم تشغيل الاستعلام ولم يطابقه شيء. هذه إجابة أيضًا.',
              'La requête a été exécutée et rien n’y correspond. C’est une réponse aussi.',
              'The query ran and nothing matched it. That is an answer too.',
            )}
          />
        }
      />
    </div>
  );
}
