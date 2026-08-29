/**
 * Explorer navigation — history and the side tree.
 *
 * Back/Forward behave the way Explorer's do: navigating truncates anything ahead
 * of the cursor, and going back keeps the forward tail intact so Alt+Right
 * returns. History is per-window state, deliberately — it is not something the
 * kernel should remember for you.
 */
import { useCallback, useMemo, useState } from 'react';
import { HardDrive, Home, type LucideIcon } from 'lucide-react';
import type { TreeNode, VfsVolumeInfo } from '@/platform/sdk';
import { DESKTOP, DOCUMENTS, HOME, REPORTS, STATEMENTS } from '../shared/paths';

export interface History {
  readonly path: string;
  readonly canBack: boolean;
  readonly canForward: boolean;
  readonly go: (next: string) => void;
  readonly back: () => void;
  readonly forward: () => void;
}

export function useHistory(initial: string): History {
  // Trail and cursor move together — held as one value so a navigation cannot
  // land between the two updates and read a cursor that points past the trail.
  const [state, setState] = useState<{ trail: readonly string[]; cursor: number }>({ trail: [initial], cursor: 0 });

  const go = useCallback((next: string) => {
    setState((current) => {
      if (current.trail[current.cursor] === next) return current;
      const trail = [...current.trail.slice(0, current.cursor + 1), next];
      return { trail, cursor: trail.length - 1 };
    });
  }, []);

  const back = useCallback(() => {
    setState((current) => (current.cursor === 0 ? current : { ...current, cursor: current.cursor - 1 }));
  }, []);

  const forward = useCallback(() => {
    setState((current) =>
      current.cursor >= current.trail.length - 1 ? current : { ...current, cursor: current.cursor + 1 },
    );
  }, []);

  return {
    path: state.trail[state.cursor] ?? initial,
    canBack: state.cursor > 0,
    canForward: state.cursor < state.trail.length - 1,
    go,
    back,
    forward,
  };
}

interface Quick {
  readonly path: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

/**
 * The tree is two groups, as in Windows 11: pinned folders under Home, then the
 * mounted volumes. Volume labels come from the kernel — a projection volume is
 * read-only and says so through its own label, so nothing is invented here.
 */
export function buildTree(
  volumes: readonly VfsVolumeInfo[],
  tr: (ar: string, fr: string, en: string) => string,
  t: (label: { ar: string; fr: string; en: string }) => string,
): readonly TreeNode[] {
  const quick: readonly Quick[] = [
    { path: DESKTOP, label: tr('سطح المكتب', 'Bureau', 'Desktop'), icon: Home },
    { path: DOCUMENTS, label: tr('المستندات', 'Documents', 'Documents'), icon: Home },
    { path: REPORTS, label: tr('التقارير', 'Rapports', 'Reports'), icon: Home },
    { path: STATEMENTS, label: tr('القوائم', 'États', 'Statements'), icon: Home },
  ];
  return [
    {
      id: HOME,
      label: tr('الرئيسية', 'Accueil', 'Home'),
      icon: Home,
      children: quick.map((entry) => ({ id: entry.path, label: entry.label, icon: entry.icon })),
    },
    {
      id: 'volumes',
      label: tr('هذا الحاسوب', 'Ce PC', 'This PC'),
      icon: HardDrive,
      children: volumes.map((volume) => ({
        id: `${volume.letter}:\\`,
        label: `${t(volume.label)} (${volume.letter}:)`,
        icon: HardDrive,
        badge: volume.readOnly ? tr('للقراءة', 'Lecture', 'Read-only') : undefined,
      })),
    },
  ];
}

/** Ids the tree starts out expanded on, so the profile is visible immediately. */
export function useInitialExpansion(): [ReadonlySet<string>, (id: string) => void] {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([HOME, 'volumes']));
  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  return [expanded, toggle];
}

/** Total and used bytes across every mounted volume, for the status bar. */
export function useCapacity(volumes: readonly VfsVolumeInfo[]) {
  return useMemo(() => {
    let used = 0;
    let quota = 0;
    for (const volume of volumes) {
      used += volume.usedBytes;
      quota += volume.quotaBytes;
    }
    return { used, quota };
  }, [volumes]);
}
