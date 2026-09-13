/**
 * The window.
 *
 * This file only wires the shell to the chrome; it decides nothing and stores
 * nothing. Every prop below is read off `useBiShell()` and handed to a component
 * that already knows what to do with it — the toolbar, the rail, the list, the
 * inspector, the status bar, the context menu and the dialogs. A second copy of
 * *'which row is selected'* living here would be a second answer to that question.
 *
 * The taskbar title is the app name and the rows shown of the rows read, never
 * the current view. A title is read while the window is behind something else,
 * and *'is anything filtered or partial'* is the question worth answering from
 * over there.
 *
 * `scroll={false}`, because every one of the three content wells scrolls itself:
 * a virtualized grid, a result grid, and the overview's own card column. A frame
 * that also scrolled would give the desk two bars and carry the column headers
 * off the top of the rows they name.
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  AppFrame,
  type AppEntryProps,
  type AppLocale,
  fmt,
  useAppCommands,
  useWindowTitle,
} from '@/platform/sdk';
import { BiMenu, BiRail, BiStatusBar, BiToolbar } from './chrome';
import { BiDetail } from './detail';
import { BiDialogHost } from './dialogs';
import { BiList } from './list';
import { BiOverviewPane } from './overview';
import { BiResultTable } from './result';
import { useBiShell } from './shell';
import type { BiShell } from './shell';

/**
 * What the taskbar says.
 *
 * The app's own name, and the count when anything is on screen. Zero rows and
 * zero read is dropped rather than drawn as `(0/0)`: *'nothing loaded yet'* is
 * not news, and a badge that is always there stops being looked at.
 */
function windowTitle(shown: number, total: number, locale: AppLocale): string {
  const name = locale.tr('ذكاء الأعمال', 'Analytics', 'Analytics');
  if (shown === 0 && total === 0) return name;
  return `${name} (${fmt.integer(shown, locale.lang)}/${fmt.integer(total, locale.lang)})`;
}

/** The window, so `shell.keyDown` sees a keystroke wherever in it the key was typed. */
const WINDOW: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

/**
 * The overview's own scroller.
 *
 * The one content well that is a column of cards rather than a grid, so it is the one
 * that needs padding and an overflow of its own. `fx-scroll` for the thin bar the rest
 * of the OS uses; `minHeight: 0` because a flex child will otherwise refuse to be
 * shorter than its content and push the scrollbar onto the window.
 */
const OVERVIEW: CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto', padding: 16 };

/**
 * What fills the content well, which is not the same question for all seven tabs.
 *
 * Five are a grid and `BiList` draws them. `analysis` is the result of the run, with
 * the shelves in the aside beside it. `overview` is cards. `BiList` already answers
 * null for the latter two — this switch is what puts something there instead, and
 * keeping it here rather than inside `BiList` is what lets the overview bring its own
 * scroller without every grid inheriting one.
 */
function content(shell: BiShell): ReactNode {
  if (shell.view === 'overview') {
    return (
      <div className="fx-scroll" style={OVERVIEW}>
        <BiOverviewPane shell={shell} />
      </div>
    );
  }
  if (shell.view === 'analysis') return <BiResultTable shell={shell} />;
  return <BiList shell={shell} />;
}

/**
 * The analytics desk: a filtered list on the left, an inspector on the right,
 * and one command path behind all of it.
 *
 * `useAppCommands(shell.command)` is what makes the jump list, the command
 * palette and the taskbar's own verbs land in the same function the toolbar
 * buttons call, so a dataset created from Start and a dataset created from this
 * window are the same event.
 *
 * The rails are 248 and 360 against the manifest's 960px floor, which is not a
 * free choice: `AppFrame` folds a rail out of flow once the content column would
 * fall under 160px, and `verify-app-fold` replays the real arithmetic across
 * sixteen widths to prove no desktop window can trigger it. 248 + 360 + 160 is
 * 768, so this desk keeps both rails from 768px up — comfortably below the 960
 * it is never opened narrower than — and drops both by the time it is
 * phone-width.
 */
export default function BiApp({ runtime }: AppEntryProps) {
  const shell = useBiShell();
  const model = shell.model;
  // Bound to a local before the JSX so the null check still holds inside `onSelect`:
  // narrowing a property access does not survive a closure, and the menu is exactly
  // the thing a menu verb needs.
  const menu = shell.menu;
  useAppCommands(shell.command);
  useWindowTitle(windowTitle(shell.shown, shell.total, runtime.locale));

  return (
    <div style={WINDOW} onKeyDown={shell.keyDown}>
      <AppFrame
        scroll={false}
        navWidth={248}
        asideWidth={360}
        commands={
          <BiToolbar
            view={shell.view}
            search={shell.search}
            searchRef={shell.searchRef}
            busy={shell.busy}
            loading={model.loading}
            powers={model.powers}
            hasDataset={model.dataset.value !== null}
            hasAnalysis={shell.loadedAnalysis !== null}
            stale={shell.stale}
            selected={shell.selectedRow}
            onCommand={shell.command}
            onSearch={shell.setSearch}
          />
        }
        nav={
          <BiRail view={shell.view} counts={model.counts} onCommand={shell.command} />
        }
        aside={<BiDetail shell={shell} />}
        status={
          <BiStatusBar
            view={shell.view}
            model={model}
            shown={shell.shown}
            total={shell.total}
            truncated={shell.truncated}
            durationMs={shell.result?.durationMs ?? null}
            queryError={shell.queryError}
          />
        }
      >
        {content(shell)}
      </AppFrame>
      {/*
        Siblings of the frame rather than children of it, because a flyout
        positioned against the viewport and a modal that dims the window have no
        business inside a scroll container. They stay inside the outer div all
        the same, which is what lets `shell.keyDown` see — and refuse — a
        keystroke typed into an open dialog.
      */}
      {menu === null ? null : (
        <BiMenu
          anchor={menu}
          busy={shell.busy}
          onSelect={(id) => shell.perform(id, menu.row)}
          onDismiss={shell.closeMenu}
        />
      )}
      <BiDialogHost shell={shell} />
    </div>
  );
}
