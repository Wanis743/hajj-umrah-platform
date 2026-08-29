/**
 * Sheets — the window.
 *
 * Composition only. The menus and the toolbar go in the command bar, the formula
 * bar and the grid and the sheet tabs stack under it, and the status bar reports
 * what the selection adds up to.
 *
 * The grid is the only thing here that takes `api` whole rather than props: it is
 * not a view of the workbook so much as the workbook's own surface — every cell it
 * draws reads the calculator, the selection and the editor at once, and threading
 * forty callbacks through it to prove a point about purity would make it slower and
 * no clearer.
 */
import { AppFrame, ToolbarSeparator, useApp, useAppCommands, useDirtyState, useWindowTitle } from '@/platform/sdk';
import { FormulaBar, SheetTabs, SheetsMenus, SheetsStatus, SheetsToolbar } from './chrome';
import { SheetGrid } from './grid';
import { useSheets } from './workbook';

export default function SheetsApp() {
  const { tr } = useApp().locale;
  const api = useSheets();

  useWindowTitle(`${api.name} — ${tr('الجداول', 'Feuilles', 'Sheets')}`);
  useDirtyState(api.dirty);
  useAppCommands(api.command);

  const commands = (
    <>
      <SheetsMenus
        cell={api.cell}
        onCommand={api.command}
        onFormat={api.format}
        onAlign={(align) => api.style({ align })}
      />
      <ToolbarSeparator />
      <SheetsToolbar
        cell={api.cell}
        dirty={api.dirty}
        busy={api.busy}
        canUndo={api.canUndo}
        canRedo={api.canRedo}
        onCommand={api.command}
        onFormat={api.format}
        onAlign={(align) => api.style({ align })}
      />
    </>
  );

  const status = (
    <SheetsStatus
      calc={api.calc}
      index={api.index}
      range={api.selection.range}
      cell={api.cell}
      path={api.path}
      busy={api.busy}
    />
  );

  return (
    <AppFrame commands={commands} status={status} scroll={false}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <FormulaBar
          range={api.selection.range}
          cell={api.cell}
          value={api.value}
          editing={api.editing}
          onGo={(ref) => api.selection.select(ref)}
          onBegin={() => api.begin(null)}
          onChange={api.change}
          onCommit={api.commit}
          onCancel={api.cancel}
        />
        <SheetGrid api={api} />
        <SheetTabs
          sheets={api.book.sheets}
          index={api.index}
          onSelect={api.selectTab}
          onAdd={api.addTab}
          onRename={api.renameTab}
          onClose={api.closeTab}
          onMove={api.moveTab}
        />
      </div>
    </AppFrame>
  );
}
