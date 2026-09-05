/**
 * The DMS window: six tabs over one document library, and the panes around them.
 *
 * The last file of the app and the only one that knows the whole of it. Every other module here
 * takes either the shell or one slice of the model and draws it; this one arranges them into a
 * window, hands the manifest's six commands to the kernel, and writes the taskbar title.
 *
 * Four decisions are copied from `crm/App.tsx` on purpose, because a second app that arranges
 * its window differently for no reason is a third thing to learn. `onKeyDown` sits on the outer
 * div rather than on the frame, since `shell.keyDown` already refuses to fire while a dialog is
 * open. The flyout and the dialog host are siblings of the frame rather than children of it.
 * The taskbar title is the app name plus one number, never the current tab. And the rails are
 * 248 and 360 against the manifest's 900px floor — 248 + 360 + 160 = 768 — which is the
 * arithmetic `verify-app-fold.mjs` sweeps at every width from the floor up.
 *
 * One decision is this app's own. `scroll={false}` is right for five of the six tabs, because a
 * `DataGrid` is its own scroller and a frame that scrolled as well would give the window two of
 * them; but the dashboard is a stack of cards with neither a scroller nor padding of its own,
 * so it is given both here instead.
 *
 * Two of the toolbar's props are arithmetic no other surface performs, so they are computed in
 * this file: they are readings of the model taken for one control each, not state, and putting
 * them on the shell would only mean two more members nobody else reads.
 */
import type { CSSProperties } from 'react';
import {
  AppFrame,
  type AppEntryProps,
  type AppLocale,
  fmt,
  useAppCommands,
  useWindowTitle,
} from '@/platform/sdk';
import { DmsMenu, DmsRail, DmsStatus, DmsToolbar } from './chrome';
import { DmsOverview } from './dashboard';
import { DmsDetail } from './detail';
import { DmsDialogHost } from './dialogs';
import { DmsList } from './list';
import type { DmsModel } from './model';
import { useDmsShell } from './shell';

/** The window, so `shell.keyDown` sees a keystroke wherever in it the key was typed. */
const WINDOW: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

/**
 * The dashboard's scroller, which the five grids neither need nor may have.
 *
 * `DmsOverview` returns a bare grid — no overflow, no padding, `alignContent: 'start'` — and
 * `AppFrame` supplies neither once `scroll` is off. Cards flush against the rail's border read
 * as a rendering fault rather than as a design, hence the padding as well as the overflow.
 */
const OVERVIEW: CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto', padding: 16 };

/**
 * Documents already inside their own notice window.
 *
 * The toolbar's standing alarm, and the only reading of `expiryNoticeDays` in the app:
 * `expiryTone` deliberately bands on a fixed 7/30 instead, so that one column stays comparable
 * down its own length. An expired document counts — a negative `daysRemaining` is inside every
 * window there is — which is right for an alarm that means *somebody has to act*.
 */
function renewalsOf(model: DmsModel): number {
  const report = model.expiry.value;
  if (report === null) return 0;
  return report.documents.filter((doc) => doc.daysRemaining <= doc.expiryNoticeDays).length;
}

/**
 * Whether the refresh button has anything to wait for.
 *
 * The six collections `refreshAll` re-issues, and deliberately not the selected document's 360.
 * That report is refetched too, but it is in flight for a beat after every row click, and a
 * refresh button that greys itself each time a reviewer picks a row is lying about being busy.
 */
function reading(model: DmsModel): boolean {
  return (
    model.documents.loading ||
    model.dashboard.loading ||
    model.queue.loading ||
    model.expiry.loading ||
    model.quality.loading ||
    model.packages.loading
  );
}

/**
 * The app name, plus the queue this app exists to drive to zero.
 *
 * `counts.review` rather than the renewals alarm, which already has a home on the toolbar, and
 * rather than the active tab, which is the window's business and not the taskbar's.
 */
function windowTitle(review: number, locale: AppLocale): string {
  const name = locale.tr('الوثائق', 'Documents', 'Documents');
  if (review === 0) return name;
  return `${name} (${fmt.integer(review, locale.lang)})`;
}

export default function DmsApp({ runtime }: AppEntryProps) {
  const shell = useDmsShell();
  const model = shell.model;
  useAppCommands(shell.command);
  useWindowTitle(windowTitle(model.counts.review, runtime.locale));
  return (
    <div style={WINDOW} onKeyDown={shell.keyDown}>
      <AppFrame
        scroll={false}
        navWidth={248}
        asideWidth={360}
        commands={
          <DmsToolbar
            view={shell.view}
            selected={shell.selectedRow}
            busy={shell.busy}
            loading={reading(model)}
            search={shell.search}
            searchRef={shell.searchRef}
            renewals={renewalsOf(model)}
            windowDays={shell.windowDays}
            horizonDays={shell.horizonDays}
            onSearch={shell.setSearch}
            onCommand={shell.command}
            onWindowDays={shell.setWindowDays}
            onHorizonDays={shell.setHorizonDays}
          />
        }
        nav={<DmsRail view={shell.view} counts={model.counts} onCommand={shell.command} />}
        aside={<DmsDetail shell={shell} />}
        status={<DmsStatus view={shell.view} model={model} shown={shell.shown} total={shell.total} />}
      >
        {shell.view === 'dashboard' ? (
          <div className="fx-scroll" style={OVERVIEW}>
            <DmsOverview shell={shell} />
          </div>
        ) : (
          <DmsList shell={shell} />
        )}
      </AppFrame>
      {/*
        Siblings of the frame, for the reason `crm/App.tsx` gives: a flyout positioned against
        the viewport and a modal that dims the window have no business inside a scroll
        container. They stay inside the outer div all the same, which is what lets
        `shell.keyDown` see — and refuse — a keystroke typed into an open dialog.

        `MenuFlyout` calls `onSelect` and then `onDismiss` itself, so the row is still on the
        anchor when the verb reads it, and the menu is gone by the time anything it opened
        appears. Nothing here closes the menu by hand.
      */}
      {shell.menu === null ? null : (
        <DmsMenu
          view={shell.view}
          anchor={shell.menu}
          busy={shell.busy}
          detail={model.selected.value}
          onSelect={(id) => shell.perform(id, shell.menu?.row ?? null)}
          onDismiss={shell.closeMenu}
        />
      )}
      <DmsDialogHost shell={shell} />
    </div>
  );
}
