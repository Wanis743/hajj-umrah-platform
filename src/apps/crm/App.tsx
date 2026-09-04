/**
 * The window.
 *
 * Fifteen files decided things; this one only wires them together, and that is the whole of
 * its job. Every prop below is read off `useCrmShell()` and handed to a component that
 * already knows what to do with it — the toolbar, the rail, the grid, the inspector, the
 * status bar, the context menu and the eight dialogs. Nothing is computed here that any of
 * them could compute for itself, and nothing is *stored* here at all: the shell owns the
 * state, and a second copy living in the frame would be a second answer to *'which row is
 * selected'*.
 *
 * Four things below are decisions rather than plumbing.
 *
 * `onKeyDown` goes straight onto the outer div with no guard around it. `close/App.tsx`
 * wraps its own in a test for an open dialog because its shell does not make that test;
 * CRM's `keyDown` already refuses to fire while `shell.dialog` is set, for the reason its
 * own comment gives — the dialogs render *inside* this element, so Ctrl+F typed into a
 * decline reason would otherwise pull focus to the search box behind it. A second lock on
 * that door would be the kind that rots: the day the shell's rule changed, this one would
 * not.
 *
 * Two bridges reverse an argument order rather than change a signature. `CrmList` reports a
 * context menu as `(row, event)` because a grid thinks in rows, while `shell.openMenu` takes
 * `(event, row)` because a flyout needs coordinates first. The same asymmetry sits between
 * `CrmMenu`'s `onSelect(id)` and `shell.perform(id, row)`: a menu knows which entry was
 * clicked, but only the shell's anchor knows which row it was clicked over. Either could
 * have been settled by changing a component's signature; both were left alone, because the
 * grid's shape is right for a grid and the shell's is right for a shell.
 *
 * The taskbar title is the app's name and the number of overdue follow-ups, never the
 * current view. Three private tables already spell the seven views out — `VIEW` in
 * `chrome.tsx`, `VIEW_NOUN` in `detail.tsx`, `VIEW_ROWS` in `shell.ts` — and a fourth copy
 * here would be a fourth place to forget. The count earns the space instead: a title is
 * read while the window is behind something else, and *'is anything late'* is the only
 * question worth answering from over there.
 *
 * `scroll={false}`, because the grid scrolls itself. A frame that also scrolled would give
 * the desk two bars and carry the column headers off the top of the rows they name.
 */
import {
  AppFrame,
  type AppEntryProps,
  type AppLocale,
  fmt,
  useAppCommands,
  useWindowTitle,
} from '@/platform/sdk';
import { CrmMenu, CrmRail, CrmStatus, CrmToolbar } from './chrome';
import { CrmDetail, CrmKpis } from './detail';
import { CrmDialogHost } from './dialogs';
import { CrmList } from './list';
import { useCrmShell } from './shell';

/**
 * What the taskbar says.
 *
 * The app's own name, and the overdue count when there is one. Zero is dropped rather than
 * drawn as `(0)`: *'nothing is late'* is not news, and a badge that is always there stops
 * being looked at. The number is formatted for the reading language like every other number
 * in the app, because a taskbar button is not a place to start writing Latin digits into an
 * Arabic desktop.
 */
function windowTitle(overdue: number, locale: AppLocale): string {
  const name = locale.tr('العلاقات التجارية', 'Relation client', 'Customers');
  if (overdue === 0) return name;
  return `${name} (${fmt.integer(overdue, locale.lang)})`;
}

/**
 * The customer desk: a register on the left, an inspector on the right, and one command path
 * behind all of it.
 *
 * `useAppCommands(shell.command)` is what makes the jump list, the command palette and the
 * taskbar's own verbs land in the same function the toolbar buttons call, so a lead created
 * from Start and a lead created from this window are the same event. `shell.command` means
 * *'on the selected row'*; `shell.perform` means *'on this row'*, and the only caller that
 * needs the second is the context menu.
 *
 * The rails are 248 and 360 against the manifest's 900px floor, which is not a free choice:
 * `AppFrame` folds a rail out of flow once the content column would fall under 160px, and
 * `verify-app-fold` replays the real arithmetic across sixteen widths to prove no desktop
 * window can trigger it. 248 + 360 + 160 is 768, so this desk keeps both rails from 768px
 * up — comfortably below the 900 it is never opened narrower than — and drops both by the
 * time it is phone-width.
 */
export default function CrmApp({ runtime }: AppEntryProps) {
  const shell = useCrmShell();
  const model = shell.model;
  useAppCommands(shell.command);
  useWindowTitle(windowTitle(model.summary.overdueFollowups, runtime.locale));
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={shell.keyDown}
    >
      <AppFrame
        scroll={false}
        navWidth={248}
        asideWidth={360}
        commands={
          <CrmToolbar
            view={shell.view}
            search={shell.search}
            searchRef={shell.searchRef}
            busy={shell.busy}
            loading={model.loading}
            selected={shell.selectedRow}
            overdue={model.summary.overdueFollowups}
            onCommand={shell.command}
            onSearch={shell.setSearch}
          />
        }
        nav={
          <CrmRail
            view={shell.view}
            counts={model.counts}
            summary={model.summary}
            onCommand={shell.command}
          />
        }
        aside={
          <CrmDetail
            model={model}
            view={shell.view}
            selectedId={shell.selectedId}
            onAddLine={shell.addLine}
            onEditLine={shell.editLine}
            onRemoveLine={shell.removeLine}
          />
        }
        status={
          <CrmStatus
            view={shell.view}
            shown={shell.shown}
            total={shell.total}
            summary={model.summary}
            truncated={model.truncated}
            error={model.error}
            fetchedAt={model.fetchedAt}
          />
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            flex: 1,
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <CrmKpis summary={model.summary} />
          <CrmList
            view={shell.view}
            model={model}
            search={shell.search}
            selectedId={shell.selectedId}
            onSelect={shell.pickRow}
            onContext={(row, event) => shell.openMenu(event, row)}
            onActivate={(row) => shell.perform('edit', row)}
          />
        </div>
      </AppFrame>
      {/*
        Both of these are siblings of the frame rather than children of it, because a flyout
        positioned against the viewport and a modal that dims the window have no business
        inside a scroll container. They stay inside the outer div all the same, which is what
        lets `shell.keyDown` see — and refuse — a keystroke typed into an open dialog.

        `MenuFlyout` calls `onSelect` and then `onDismiss` itself, so the row is still on the
        anchor when the verb reads it and the menu is gone by the time anything it opened
        appears. Nothing here closes the menu by hand.
      */}
      {shell.menu === null ? null : (
        <CrmMenu
          view={shell.view}
          anchor={shell.menu}
          busy={shell.busy !== null}
          onSelect={(id) => shell.perform(id, shell.menu?.row ?? null)}
          onDismiss={shell.closeMenu}
        />
      )}
      <CrmDialogHost shell={shell} />
    </div>
  );
}
