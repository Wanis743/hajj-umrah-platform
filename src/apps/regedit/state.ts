/**
 * Registry Editor — navigation, selection and command routing.
 *
 * Everything the window does, minus how it looks. It lives apart from `App.tsx`
 * for the same reason Event Viewer's `actions.ts` does: the composition reads as
 * a picture of the window, and the behaviour reads as a list of what each verb
 * means, instead of the two being interleaved down 200 lines of JSX.
 *
 * One choice recorded here rather than in the UI: the selected key is *not*
 * persisted. `registry.set` is audited into the Security channel, so remembering
 * the last key would file a security record for every click on a tree node.
 * Favourites are persisted — starring a key is a decision, not a movement.
 */
import { useCallback, useMemo, useState } from 'react';
import { Database, FolderTree } from 'lucide-react';
import {
  type RegistryEntry,
  type RegistryValue,
  type TreeNode,
  useContextMenu,
  useSetting,
} from '@/platform/sdk';
import { useRegActions } from './actions';
import {
  DEFAULT_VALUE_NAME,
  type FindHit,
  ROOTS,
  displayData,
  editText,
  isVolatileKey,
  keyName,
  kindOf,
  parentKey,
  toLongPath,
} from './catalog';
import { useHive } from './hive';
import type { EditorTarget } from './values';

const NO_NAMES: ReadonlySet<string> = new Set();
const NO_FAVOURITES: readonly string[] = [];
/** Opening on `HKCU` mirrors regedit landing on the first hive in the tree. */
const HOME = 'HKCU';

/** `HKCU\Control Panel\Desktop` → the keys above it, so the tree can unfold. */
function ancestorsOf(key: string): readonly string[] {
  const parts = key.split('\\');
  const out: string[] = [];
  for (let index = 1; index < parts.length; index += 1) out.push(parts.slice(0, index).join('\\'));
  return out;
}
/** The walked hive as the tree draws it; depth is bounded by `hive.ts`. */
function buildNodes(children: ReadonlyMap<string, readonly string[]>, parent: string): readonly TreeNode[] {
  return (children.get(parent) ?? []).map((key) => {
    const kids = children.get(key) ?? [];
    return {
      id: key,
      label: parent === '' ? toLongPath(key) : keyName(key),
      icon: parent === '' ? FolderTree : Database,
      expandable: kids.length > 0,
      children: buildNodes(children, key),
      tone: isVolatileKey(key) ? ('warning' as const) : undefined,
    };
  });
}

export function useRegedit() {
  const hive = useHive();
  const [selected, setSelected] = useState(HOME);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(ROOTS));
  const [selection, setSelection] = useState<ReadonlySet<string>>(NO_NAMES);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [creating, setCreating] = useState(false);
  const [finding, setFinding] = useState(false);
  const [favourites, setFavourites] = useSetting<readonly string[]>('favourites', NO_FAVOURITES);
  const keyMenu = useContextMenu<string>();
  const valueMenu = useContextMenu<RegistryEntry>();
  const actions = useRegActions(hive.refresh);

  const navigate = useCallback((key: string) => {
    const target = key.trim() === '' ? HOME : key;
    setSelected(target);
    setSelection(NO_NAMES);
    setExpanded((current) => new Set([...current, ...ancestorsOf(target)]));
  }, []);

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const nodes = useMemo(() => buildNodes(hive.children, ''), [hive.children]);
  const subkeys = hive.children.get(selected) ?? [];

  /** `(Default)` sits first, the way regedit pins it above the sorted rest. */
  const values = useMemo(() => {
    const rows = [...(hive.values.get(selected) ?? [])];
    return rows.sort((a, b) => {
      if (a.name === DEFAULT_VALUE_NAME) return -1;
      if (b.name === DEFAULT_VALUE_NAME) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [hive.values, selected]);
  const subtreeOf = useCallback(
    (key: string): readonly (readonly [string, readonly RegistryEntry[]])[] => {
      const lower = key.toLowerCase();
      const prefix = `${lower}\\`;
      const out: (readonly [string, readonly RegistryEntry[]])[] = [];
      for (const [candidate, entries] of hive.values) {
        const seen = candidate.toLowerCase();
        if (seen === lower || seen.startsWith(prefix)) out.push([candidate, entries]);
      }
      return out;
    },
    [hive.values],
  );

  const openEditor = (entry: RegistryEntry) =>
    setEditor({ mode: 'edit', key: selected, name: entry.name, kind: kindOf(entry.value), text: editText(entry.value) });
  const openNewValue = (key: string) => setEditor({ mode: 'new', key, name: '', kind: 'REG_SZ', text: '' });

  const toggleFavourite = (key: string) =>
    setFavourites(favourites.includes(key) ? favourites.filter((item) => item !== key) : [...favourites, key]);

  /** Deleting a key is recursive, so the confirmation is told what it takes. */
  const deleteKey = (key: string) => {
    const branch = subtreeOf(key);
    const held = branch.reduce((sum, [, entries]) => sum + entries.length, 0);
    void actions.removeKey(key, Math.max(branch.length - 1, 0), held).then((gone) => {
      if (gone) navigate(parentKey(key));
    });
  };

  const onKeyMenu = (id: string) => {
    const key = keyMenu.menu?.target ?? selected;
    keyMenu.close();
    if (id === 'newKey') {
      navigate(key);
      setCreating(true);
    } else if (id === 'new') openNewValue(key);
    else if (id === 'copy') actions.copy(toLongPath(key));
    else if (id === 'export') actions.exportKey(key, subtreeOf(key));
    else if (id === 'favorite') toggleFavourite(key);
    else if (id === 'delete') deleteKey(key);
  };
  const onValueMenu = (id: string) => {
    const entry = valueMenu.menu?.target;
    valueMenu.close();
    if (entry === undefined) return;
    if (id === 'modify') openEditor(entry);
    else if (id === 'copyName') actions.copy(entry.name);
    else if (id === 'copyData') actions.copy(displayData(entry.value) ?? '');
    else if (id === 'delete') {
      void actions.removeValue(selected, entry.name).then((gone) => {
        if (gone) setSelection(NO_NAMES);
      });
    }
  };

  const commit = (name: string, value: RegistryValue) => {
    if (editor === null) return;
    void actions.write(editor.key, name, value).then((ok) => {
      if (ok) setEditor(null);
    });
  };

  /** New ▸ Key: an unset `(Default)`, because a valueless key cannot exist. */
  const createKey = (name: string) => {
    const child = `${selected}\\${name}`;
    void actions.write(child, DEFAULT_VALUE_NAME, null).then((ok) => {
      if (!ok) return;
      setCreating(false);
      navigate(child);
    });
  };

  const pick = (hit: FindHit) => {
    navigate(hit.key);
    if (hit.name !== null) setSelection(new Set([hit.name]));
    setFinding(false);
  };

  const command = (id: string) => {
    if (id === 'find') setFinding(true);
    else if (id.startsWith('goto:')) navigate(id.slice('goto:'.length));
  };

  return {
    hive,
    selected,
    expanded,
    selection,
    editor,
    creating,
    finding,
    favourites,
    keyMenu,
    valueMenu,
    busy: actions.busy,
    nodes,
    subkeys,
    values,
    /** The address bar accepts anything; a typo lands on a key that is not there. */
    missing: !hive.loading && !hive.values.has(selected),
    navigate,
    toggle,
    command,
    setSelection,
    setEditor,
    setCreating,
    setFinding,
    openEditor,
    openNewValue,
    toggleFavourite,
    onKeyMenu,
    onValueMenu,
    commit,
    createKey,
    pick,
    exportSelected: () => actions.exportKey(selected, subtreeOf(selected)),
  };
}
