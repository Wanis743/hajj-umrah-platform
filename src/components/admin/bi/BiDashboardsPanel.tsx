/**
 * Dashboards: a grid you scan, and the only screen that edits one.
 *
 * The tiles are the same `BiSavedTile` the report screen renders. That is not reuse for
 * its own sake -- a saved analysis is one object, and drawing it two ways would be two
 * definitions of the same number, one of which would eventually stop matching the
 * compiled statement the tile can be asked for.
 *
 * Two facts are put in front of the reader before anything is drawn:
 *
 * 1. `fully_readable_by_me` is on the list row. A grid where four tiles render and two
 *    say "denied" reads as a broken page, so the list says which dashboards will do that
 *    before one is opened.
 * 2. Arranging is offered only when the server says `can_edit`, and only at grid width.
 *    Below that the grid is one column and there is no visible geometry to move.
 *
 * A save writes through `biCommands.tile.relayout`, which applies one row at a time and
 * stops at the first refusal. `layoutDiff` sends only the tiles that actually moved, so a
 * dashboard of nine tiles where one was widened writes one audited update rather than
 * nine.
 */
import { useMemo, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronsDown, ChevronsLeft,
  ChevronsRight, ChevronsUp, LayoutGrid, Pencil, Star, Undo2, type LucideIcon,
} from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { biAnalytics } from '@/services/biAnalytics';
import { biCommands } from '@/services/domainCommands';
import type {
  BiDashboardDetail, BiDashboardSummary, BiDashboardTile, BiTileGrid,
} from '@/types/bi';
import { InlineNote, Panel, Pill, StatusPill } from './atoms';
import { BiSavedTile } from './BiSavedTile';
import { fmtDate, fmtInt, useBiI18n, useBiLabels, useBiRead } from './biFormat';
import {
  GRID_COLUMNS, GRID_GAP_PX, GRID_ROW_PX, canMove, chartHeight, gridStyle, gridSummary,
  layoutDiff, moveTile, orderedTiles, tileLayout, useWideGrid,
  type TileLayout, type TileNudge,
} from './biTileLayout';
import { useBiCommand } from './useBiCommand';

/** One shared empty array, so an unloaded payload does not hand the derived values a
 *  fresh identity on every render. */
const NO_DASHBOARDS: readonly BiDashboardSummary[] = [];

export function BiDashboardsPanel() {
  const { t } = useBiI18n();
  const { data, loading, error, reload } = useBiRead<BiDashboardSummary[]>(
    () => biAnalytics.dashboards(), [],
  );
  const [selected, setSelected] = useState<string | null>(null);

  const dashboards = data ?? NO_DASHBOARDS;
  const active = dashboards.find((d) => d.id === selected)
    ?? dashboards.find((d) => d.is_default)
    ?? dashboards[0]
    ?? null;

  if (loading && !data) return <Spinner className="p-10" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {dashboards.length === 0 ? (
        <Panel title={t('اللوحات', 'Tableaux de bord', 'Dashboards')}>
          <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
            {t('لا لوحة بعد — احفظ تحليلًا من المُنشئ ثم ضعه في لوحة',
              'Aucun tableau de bord — enregistrez une analyse depuis le générateur, puis placez-la dans un tableau',
              'No dashboard yet — save an analysis from the builder, then place it on a dashboard')}
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <p className="px-1 text-[11px] text-[var(--text-muted)] tabular">
              {t(`${fmtInt(dashboards.length)} لوحة`, `${fmtInt(dashboards.length)} tableaux`,
                `${fmtInt(dashboards.length)} dashboards`)}
            </p>
            <ul className="space-y-2">
              {dashboards.map((dashboard) => (
                <li key={dashboard.id}>
                  <DashboardRow
                    dashboard={dashboard}
                    active={dashboard.id === active?.id}
                    onSelect={() => setSelected(dashboard.id)}
                  />
                </li>
              ))}
            </ul>
          </div>

          {active && <DashboardShell dashboardId={active.id} />}
        </div>
      )}
    </div>
  );
}

/**
 * One dashboard in the list.
 *
 * The tile count and the readability warning are both here because both change whether
 * opening it is worth doing: an empty dashboard and a half-denied one look the same from
 * the outside, and neither is what the reader is looking for.
 */
function DashboardRow({ dashboard, active, onSelect }: {
  dashboard: BiDashboardSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const title = (isAr && dashboard.title_ar) ? dashboard.title_ar : dashboard.title;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={`card w-full p-3 text-start transition-colors ${
        active ? 'border-[var(--accent)] bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-primary)]">
          {dashboard.is_default && (
            <Star
              className="h-3 w-3 shrink-0 text-[var(--accent)]"
              aria-label={t('الافتراضية', 'Par défaut', 'Default')}
            />
          )}
          {title}
        </span>
        <StatusPill status={dashboard.status} label={labels.status[dashboard.status]} />
      </div>
      <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
        {dashboard.key}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <span className="tabular">
          {t(`${fmtInt(dashboard.tile_count)} بطاقة`, `${fmtInt(dashboard.tile_count)} tuiles`,
            `${fmtInt(dashboard.tile_count)} tiles`)}
        </span>
        {dashboard.tile_count === 0 && <Pill tone="warn">{t('فارغة', 'Vide', 'Empty')}</Pill>}
        {dashboard.tile_count > 0 && !dashboard.fully_readable_by_me && (
          <Pill tone="warn">
            {t('قراءة جزئية', 'Lecture partielle', 'Partly unreadable')}
          </Pill>
        )}
      </div>
    </button>
  );
}

/** The read, split out so the body below never has to tolerate a null detail -- and so
 *  selecting a different dashboard reruns the read rather than reconciling two payloads. */
function DashboardShell({ dashboardId }: { dashboardId: string }) {
  const { t } = useBiI18n();
  const { data, loading, error, reload } = useBiRead<BiDashboardDetail>(
    () => biAnalytics.dashboard(dashboardId), [dashboardId],
  );

  if (loading && !data) return <Spinner className="p-10" />;
  if (!data) {
    return (
      <ErrorBanner
        message={error ?? t('لم تُحمَّل اللوحة', 'Tableau non chargé', 'Dashboard did not load')}
        onRetry={reload}
      />
    );
  }

  return <DashboardBody detail={data} reload={reload} />;
}

/**
 * The dashboard: its heading, the arrange controls when they are allowed, and the grid.
 *
 * The draft layout is reconciled against the payload's own tile array during render. A
 * reload is the server's word on where the tiles are, and a draft still measured against
 * a payload that no longer exists would save coordinates nobody asked for.
 */
function DashboardBody({ detail, reload }: {
  detail: BiDashboardDetail;
  reload: () => void;
}) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const wide = useWideGrid();
  const cmd = useBiCommand();
  const [editing, setEditing] = useState(false);

  const tiles = detail.tiles;
  const [draft, setDraft] = useState<{ layout: TileLayout; seen: readonly BiDashboardTile[] }>(
    () => ({ layout: tileLayout(tiles), seen: tiles }),
  );
  const stale = draft.seen !== tiles;
  if (stale) setDraft({ layout: tileLayout(tiles), seen: tiles });
  const layout = stale ? tileLayout(tiles) : draft.layout;

  const changes = useMemo(() => layoutDiff(tiles, layout), [tiles, layout]);
  const ordered = useMemo(() => orderedTiles(tiles, layout), [tiles, layout]);
  const arranging = editing && wide;
  const dash = detail.dashboard;
  const title = (isAr && dash.title_ar) ? dash.title_ar : dash.title;

  const save = () => {
    void cmd.run(() => biCommands.tile.relayout(changes), {
      notice: t(`حُفظ ترتيب ${fmtInt(changes.length)} بطاقة`,
        `Disposition enregistrée pour ${fmtInt(changes.length)} tuiles`,
        `Layout saved for ${fmtInt(changes.length)} tiles`),
      onSuccess: reload,
    });
  };

  return (
    <div className="min-w-0 space-y-4">
      <Panel
        title={title}
        subtitle={dash.description ?? undefined}
        actions={<StatusPill status={dash.status} label={labels.status[dash.status]} />}
      >
        <DashboardMeta detail={detail} />
        {detail.can_edit && (
          <ArrangeBar
            editing={editing}
            wide={wide}
            busy={cmd.busy}
            moved={changes.length}
            onEdit={() => { cmd.clear(); setEditing(true); }}
            onDone={() => setEditing(false)}
            onSave={save}
            onDiscard={() => setDraft({ layout: tileLayout(tiles), seen: tiles })}
          />
        )}
        {cmd.error !== null && <InlineNote tone="bad">{cmd.error}</InlineNote>}
        {cmd.notice !== null && <InlineNote tone="good">{cmd.notice}</InlineNote>}
      </Panel>

      {ordered.length === 0 ? (
        <p className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-10 text-center text-[13px] text-[var(--text-muted)]">
          <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          {t('هذه اللوحة لا تحتوي بطاقة', 'Ce tableau de bord ne contient aucune tuile',
            'This dashboard holds no tile')}
        </p>
      ) : (
        <div
          className="grid grid-cols-1 gap-4"
          style={wide ? {
            gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0,1fr))`,
            gridAutoRows: `${GRID_ROW_PX}px`,
            gap: `${GRID_GAP_PX}px`,
          } : undefined}
        >
          {ordered.map((tile) => (
            <TileCell
              key={tile.id}
              tile={tile}
              layout={layout}
              wide={wide}
              arranging={arranging}
              onMove={(nudge) => setDraft({ layout: moveTile(layout, tile.id, nudge), seen: tiles })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** What the dashboard is, beside its title: the key readers cite it by, the version, and
 *  whether it is a promise or a draft. */
function DashboardMeta({ detail }: { detail: BiDashboardDetail }) {
  const { t } = useBiI18n();
  const dash = detail.dashboard;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
      <span className="font-mono" dir="ltr">{dash.key}</span>
      <span aria-hidden="true">·</span>
      <span className="tabular">
        {t(`الإصدار ${fmtInt(dash.version)}`, `Version ${fmtInt(dash.version)}`,
          `Version ${fmtInt(dash.version)}`)}
      </span>
      <span aria-hidden="true">·</span>
      <span className="tabular">
        {t(`${fmtInt(detail.tile_count)} بطاقة`, `${fmtInt(detail.tile_count)} tuiles`,
          `${fmtInt(detail.tile_count)} tiles`)}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {dash.published_at === null
          ? t('غير منشورة', 'Non publié', 'Not published')
          : t(`نُشرت ${fmtDate(dash.published_at)}`, `Publié le ${fmtDate(dash.published_at)}`,
            `Published ${fmtDate(dash.published_at)}`)}
      </span>
      {dash.is_default && <Pill tone="info">{t('الافتراضية', 'Par défaut', 'Default')}</Pill>}
      {dash.deprecated_at !== null && (
        <Pill tone="bad">
          {t(`أُهملت ${fmtDate(dash.deprecated_at)}`, `Déprécié le ${fmtDate(dash.deprecated_at)}`,
            `Deprecated ${fmtDate(dash.deprecated_at)}`)}
        </Pill>
      )}
    </div>
  );
}

/**
 * Enter arranging, then save or put it back.
 *
 * Save is disabled when nothing moved rather than hidden, because a disabled save with
 * "nothing moved" next to it answers "did my nudge register?" and a missing button does
 * not. At narrow widths the whole thing says why it is not offered instead of offering
 * controls that would move something the reader cannot see.
 */
function ArrangeBar({ editing, wide, busy, moved, onEdit, onDone, onSave, onDiscard }: {
  editing: boolean;
  wide: boolean;
  busy: boolean;
  moved: number;
  onEdit: () => void;
  onDone: () => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { t } = useBiI18n();

  if (!wide) {
    return (
      <p className="mt-3 text-[11px] text-[var(--text-muted)]">
        {t('الترتيب يُحرَّر على شاشة أوسع — هنا اللوحة عمود واحد',
          'La disposition se modifie sur un écran plus large — ici le tableau est en une colonne',
          'The layout is arranged on a wider screen — here the dashboard is one column')}
      </p>
    );
  }

  if (!editing) {
    return (
      <div className="mt-3">
        <button type="button" onClick={onEdit} className="btn btn-ghost btn-sm">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          {t('رتّب البطاقات', 'Arranger les tuiles', 'Arrange the tiles')}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={busy || moved === 0}
        className="btn btn-primary btn-sm"
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        {busy ? t('يحفظ…', 'Enregistrement…', 'Saving…') : t('احفظ الترتيب', 'Enregistrer', 'Save layout')}
      </button>
      <button
        type="button"
        onClick={onDiscard}
        disabled={busy || moved === 0}
        className="btn btn-ghost btn-sm"
      >
        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t('أعِد كما كان', 'Rétablir', 'Put it back')}
      </button>
      <button type="button" onClick={onDone} disabled={busy} className="btn btn-ghost btn-sm">
        {t('انتهيت', 'Terminé', 'Done')}
      </button>
      <span className="text-[11px] text-[var(--text-muted)] tabular">
        {moved === 0
          ? t('لم يتغيّر شيء', 'Rien n’a changé', 'Nothing moved')
          : t(`${fmtInt(moved)} بطاقة تغيّرت`, `${fmtInt(moved)} tuiles déplacées`,
            `${fmtInt(moved)} tiles moved`)}
      </span>
    </div>
  );
}

/**
 * One cell of the grid: the analysis, and while arranging, where it sits.
 *
 * The tile's own title wins over the analysis's, resolved server-side, so one chart can
 * be labelled for two audiences on two dashboards without copying the definition it is
 * drawn from.
 */
function TileCell({ tile, layout, wide, arranging, onMove }: {
  tile: BiDashboardTile;
  layout: TileLayout;
  wide: boolean;
  arranging: boolean;
  onMove: (nudge: TileNudge) => void;
}) {
  const { isAr } = useBiI18n();
  const grid = layout.get(tile.id) ?? tile.grid;
  const title = (isAr && tile.title_ar) ? tile.title_ar : tile.title;

  return (
    <div className="flex min-w-0 flex-col" style={gridStyle(grid, wide)}>
      {arranging && (
        <NudgeGroup layout={layout} id={tile.id} title={title} grid={grid} onMove={onMove} />
      )}
      <BiSavedTile
        visualizationId={tile.visualization.id}
        title={title}
        subtitle={tile.visualization.dataset_key}
        readable={tile.readable_by_me}
        height={chartHeight(grid.h, wide, arranging)}
      />
    </div>
  );
}

/**
 * Eight buttons and the tile's current geometry.
 *
 * Every button carries a word, not only a glyph: four arrows that all point somewhere are
 * indistinguishable from four chevrons that all point somewhere, and the difference
 * between "move right" and "get wider" is exactly the thing a reader needs. The geometry
 * is printed beside them because a nudge that is refused leaves nothing else to look at.
 */
function NudgeGroup({ layout, id, title, grid, onMove }: {
  layout: TileLayout;
  id: string;
  title: string;
  grid: BiTileGrid;
  onMove: (nudge: TileNudge) => void;
}) {
  const { t } = useBiI18n();

  const moves: readonly { move: TileNudge; icon: LucideIcon; label: string }[] = [
    { move: 'LEFT', icon: ArrowLeft, label: t('يسار', 'Gauche', 'Move left') },
    { move: 'RIGHT', icon: ArrowRight, label: t('يمين', 'Droite', 'Move right') },
    { move: 'UP', icon: ArrowUp, label: t('أعلى', 'Haut', 'Move up') },
    { move: 'DOWN', icon: ArrowDown, label: t('أسفل', 'Bas', 'Move down') },
    { move: 'NARROWER', icon: ChevronsLeft, label: t('أضيق', 'Plus étroit', 'Narrower') },
    { move: 'WIDER', icon: ChevronsRight, label: t('أوسع', 'Plus large', 'Wider') },
    { move: 'SHORTER', icon: ChevronsUp, label: t('أقصر', 'Plus court', 'Shorter') },
    { move: 'TALLER', icon: ChevronsDown, label: t('أطول', 'Plus haut', 'Taller') },
  ];

  return (
    <div
      role="group"
      aria-label={t(`ترتيب ${title}`, `Disposition de ${title}`, `Layout of ${title}`)}
      className="mb-1 flex flex-wrap items-center gap-0.5"
    >
      <span className="me-1 font-mono text-[10px] text-[var(--text-muted)] tabular" dir="ltr">
        {gridSummary(grid)}
      </span>
      {moves.map(({ move, icon: Icon, label }) => (
        <button
          key={move}
          type="button"
          onClick={() => onMove(move)}
          disabled={!canMove(layout, id, move)}
          title={label}
          aria-label={label}
          className="btn btn-ghost btn-sm px-1.5"
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
