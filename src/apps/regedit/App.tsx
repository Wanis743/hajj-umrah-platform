/**
 * Registry Editor — the window.
 *
 * Composition only: the tree rail, the value grid, the status bar and the four
 * overlays. Behaviour lives in `state.ts`, the writes in `actions.ts`, the walk
 * in `hive.ts`, and everything pure in `catalog.ts`.
 */
import { Star } from 'lucide-react';
import { AppFrame, NavItem, TreeView, useApp, useAppCommands, useWindowTitle } from '@/platform/sdk';
import { keyName, parentKey } from './catalog';
import { FindDialog, KeyMenu, NewKeyDialog, RegStatus, RegToolbar, ValueMenu } from './chrome';
import { useRegedit } from './state';
import { ValueEditor, ValueGrid } from './values';

export default function RegistryEditorApp() {
  const { tr } = useApp().locale;
  const reg = useRegedit();
  const { hive, selected, keyMenu, valueMenu } = reg;

  useWindowTitle(`${tr('محرّر السجل', 'Éditeur du Registre', 'Registry Editor')} — ${keyName(selected)}`);
  useAppCommands(reg.command);

  const nav = (
    <>
      {reg.favourites.map((key) => (
        <NavItem
          key={key}
          icon={Star}
          label={keyName(key)}
          selected={key === selected}
          onClick={() => reg.navigate(key)}
        />
      ))}
      {reg.favourites.length > 0 ? (
        <div style={{ height: 1, background: 'var(--fx-divider)', margin: '6px 4px' }} />
      ) : null}
      <TreeView
        nodes={reg.nodes}
        selectedId={selected}
        expandedIds={reg.expanded}
        onToggle={reg.toggle}
        onSelect={(node) => reg.navigate(node.id)}
        onContextMenu={(node, event) => keyMenu.open(event, node.id)}
      />
    </>
  );
  const commands = (
    <RegToolbar
      path={selected}
      onNavigate={reg.navigate}
      canGoUp={parentKey(selected) !== ''}
      onUp={() => reg.navigate(parentKey(selected))}
      onRefresh={hive.refresh}
      onFind={() => reg.setFinding(true)}
      onNewValue={() => reg.openNewValue(selected)}
      onExport={reg.exportSelected}
      favorite={reg.favourites.includes(selected)}
      onFavorite={() => reg.toggleFavourite(selected)}
      busy={reg.busy === 'export'}
    />
  );

  const status = (
    <RegStatus
      path={selected}
      values={reg.values.length}
      subkeys={reg.subkeys.length}
      keys={hive.values.size}
      error={hive.error ?? (reg.missing ? tr('لا يوجد مفتاح بهذا الاسم', 'Aucune clé de ce nom', 'No key by that name') : null)}
    />
  );
  return (
    <AppFrame commands={commands} nav={nav} navWidth={280} status={status} scroll={false}>
      <ValueGrid
        rows={reg.values}
        loading={hive.loading}
        selection={reg.selection}
        onSelectionChange={reg.setSelection}
        onActivate={reg.openEditor}
        onContextMenu={(entry, event) => valueMenu.open(event, entry)}
      />

      {keyMenu.menu === null ? null : (
        <KeyMenu
          x={keyMenu.menu.x}
          y={keyMenu.menu.y}
          path={keyMenu.menu.target}
          favorite={reg.favourites.includes(keyMenu.menu.target)}
          canDelete={parentKey(keyMenu.menu.target) !== ''}
          onSelect={reg.onKeyMenu}
          onDismiss={keyMenu.close}
        />
      )}

      {valueMenu.menu === null ? null : (
        <ValueMenu
          x={valueMenu.menu.x}
          y={valueMenu.menu.y}
          entry={valueMenu.menu.target}
          onSelect={reg.onValueMenu}
          onDismiss={valueMenu.close}
        />
      )}
      {reg.editor === null ? null : (
        <ValueEditor
          target={reg.editor}
          taken={reg.values.map((entry) => entry.name)}
          busy={reg.busy === 'save'}
          onCommit={reg.commit}
          onClose={() => reg.setEditor(null)}
        />
      )}

      {reg.creating ? (
        <NewKeyDialog
          parent={selected}
          taken={reg.subkeys.map((key) => keyName(key))}
          busy={reg.busy === 'save'}
          onCommit={reg.createKey}
          onClose={() => reg.setCreating(false)}
        />
      ) : null}

      {reg.finding ? (
        <FindDialog hive={hive.values} onPick={reg.pick} onClose={() => reg.setFinding(false)} />
      ) : null}
    </AppFrame>
  );
}
