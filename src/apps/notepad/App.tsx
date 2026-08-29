/**
 * Notepad — the window.
 *
 * Composition only: the menu strip and toolbar above, tabs, the editor (beside a
 * Markdown preview when one is asked for), the status bar, and Find & Replace over
 * the top. Behaviour is in `state.ts`, documents and the volume in `documents.ts`,
 * and everything pure in `text.ts`.
 *
 * The keyboard is handled on the wrapper rather than on the textarea, so an
 * accelerator still works when focus is on a tab or the toolbar — and stays inside
 * this window rather than reaching the shell.
 */
import { AppFrame, SplitPane, ToolbarSeparator, useApp, useAppCommands, useDirtyState, useWindowTitle } from '@/platform/sdk';
import { Editor, FindReplace, MarkdownPreview, NotepadMenus, NotepadStatus, NotepadToolbar, TabStrip } from './chrome';
import { isDirty } from './documents';
import { hotkey, useNotepad } from './state';

export default function NotepadApp() {
  const { tr } = useApp().locale;
  const pad = useNotepad();
  const { documents, doc } = pad;

  useWindowTitle(`${doc.name} — ${tr('المفكرة', 'Bloc-notes', 'Notepad')}`);
  useDirtyState(pad.anyDirty);
  useAppCommands(pad.command);

  const commands = (
    <>
      <NotepadMenus wrap={pad.wrap} preview={pad.preview} canPreview={pad.canPreview} onCommand={pad.command} />
      <ToolbarSeparator />
      <NotepadToolbar
        wrap={pad.wrap}
        saving={documents.busy}
        readOnly={doc.readOnly}
        dirty={pad.dirty}
        onCommand={pad.command}
      />
    </>
  );

  const status = (
    <NotepadStatus
      caret={pad.caret}
      stats={pad.stats}
      eol={doc.eol}
      onEol={documents.setEol}
      zoom={pad.zoomPercent}
      path={doc.path}
    />
  );

  const editor = (
    <Editor
      area={pad.area}
      value={doc.text}
      onChange={documents.edit}
      onCaret={(start, end) => pad.setRange({ start, end })}
      wrap={pad.wrap}
      fontSize={pad.fontSize}
      readOnly={doc.readOnly}
    />
  );

  return (
    <AppFrame commands={commands} status={status} scroll={false}>
      <div
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        onKeyDown={(event) => {
          const id = hotkey(event);
          if (id === null) return;
          event.preventDefault();
          pad.command(id);
        }}
      >
        <TabStrip
          docs={documents.docs}
          activeId={doc.id}
          dirtyOf={isDirty}
          onSelect={documents.select}
          onClose={documents.close}
          onNew={documents.openBlank}
        />
        {pad.preview ? (
          <SplitPane
            initial={520}
            min={280}
            max={900}
            first={editor}
            second={<MarkdownPreview source={doc.text} fontSize={pad.fontSize} />}
          />
        ) : (
          editor
        )}
      </div>

      {pad.finding ? (
        <FindReplace
          needle={pad.needle}
          onNeedle={pad.setNeedle}
          replacement={pad.replacement}
          onReplacement={pad.setReplacement}
          options={pad.options}
          onOptions={pad.setOptions}
          total={pad.matches}
          current={pad.current}
          readOnly={doc.readOnly}
          onFind={pad.find}
          onReplace={pad.replaceOne}
          onReplaceAll={pad.replaceEvery}
          onClose={pad.closeFind}
        />
      ) : null}
    </AppFrame>
  );
}
