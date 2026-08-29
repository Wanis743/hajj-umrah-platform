/**
 * Search (Win+S).
 *
 * Windows 11's search box is one field over several indexes; this is the same
 * idea over the three the kernel actually has: installed apps, the VFS, and the
 * commands manifests publish. That third one is what makes it a command palette
 * — "Post journal", "Close period", "New reconciliation" are declared in
 * manifests, so Search can offer them without knowing what any app does.
 *
 * A command is dispatched with `kernel.sendCommand`, the only shell→app channel
 * (`system/app-command` is reserved from applications). A cold app is launched
 * with the command in its arguments, a running one is brought forward — the
 * kernel decides, not this component.
 */
import { CornerDownLeft, Search as SearchGlyph, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AppCommandDef, VfsStat } from '../kernel/abi';
import { KERNEL_USER_FOLDER } from '../kernel/kernel';
import type { InstalledApp } from '../kernel/contracts';
import type { AppLocale } from '../sdk';
import { fmt } from '../sdk';
import { useDismissOnOutside, useKernel, useKernelAction, useKernelView, useKernelView2 } from './bindings';
import { iconForContentType } from './iconRegistry';
import { AppIcon } from './icons';
import { rankApps, rankCommands } from './ranking';

const MAX_APPS = 6;
const MAX_COMMANDS = 6;
const MAX_FILES = 6;
/** Apps offered before anything is typed. */
const MAX_TOP = 6;

type Hit =
  | { readonly kind: 'app'; readonly key: string; readonly app: InstalledApp }
  | { readonly kind: 'command'; readonly key: string; readonly app: InstalledApp; readonly command: AppCommandDef }
  | { readonly kind: 'file'; readonly key: string; readonly stat: VfsStat };

interface Section {
  readonly title: string;
  readonly hits: readonly Hit[];
}

/** Most-used apps, which is the honest answer to an empty query. */
function topApps(apps: readonly InstalledApp[], limit: number): readonly InstalledApp[] {
  return [...apps]
    .filter((app) => app.enabled)
    .sort((a, b) => b.launches - a.launches || (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))
    .slice(0, limit);
}

export interface SearchPanelProps {
  readonly locale: AppLocale;
  readonly onDismiss: () => void;
}

export function SearchPanel({ locale, onDismiss }: SearchPanelProps) {
  const kernel = useKernel();
  const run = useKernelAction();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useDismissOnOutside(true, onDismiss, '.fx-search, .fx-taskbar, .fx-menu');

  const installed = useKernelView(kernel.apps, () => kernel.apps.list());
  const needle = query.trim().toLowerCase();

  const sections = useKernelView2(kernel.vfs, kernel.apps, (): readonly Section[] => {
    if (needle.length === 0) {
      return [
        {
          title: locale.tr('الأكثر استخدامًا', 'Les plus utilisées', 'Most used'),
          hits: topApps(installed, MAX_TOP).map<Hit>((app) => ({
            kind: 'app',
            key: `app:${app.manifest.id as string}`,
            app,
          })),
        },
      ];
    }
    const enabled = installed.filter((app) => app.enabled);
    const apps = rankApps(enabled, needle, locale, MAX_APPS).map<Hit>((entry) => ({
      kind: 'app',
      key: `app:${entry.app.manifest.id as string}`,
      app: entry.app,
    }));
    const commands = rankCommands(enabled, needle, locale, MAX_COMMANDS).map<Hit>((entry) => ({
      kind: 'command',
      key: `cmd:${entry.app.manifest.id as string}:${entry.command.id}`,
      app: entry.app,
      command: entry.command,
    }));
    const found = kernel.vfs.search(KERNEL_USER_FOLDER, needle, MAX_FILES);
    const files = (found.ok ? found.value : []).map<Hit>((stat) => ({
      kind: 'file',
      key: `file:${stat.path}`,
      stat,
    }));
    return [
      { title: locale.tr('التطبيقات', 'Applications', 'Apps'), hits: apps },
      { title: locale.tr('الأوامر', 'Commandes', 'Commands'), hits: commands },
      { title: locale.tr('الملفات', 'Fichiers', 'Files'), hits: files },
    ].filter((section) => section.hits.length > 0);
  });

  const flat = useMemo<readonly Hit[]>(() => sections.flatMap((section) => section.hits), [sections]);
  const current = flat.length === 0 ? -1 : Math.min(cursor, flat.length - 1);

  const open = (hit: Hit) => {
    onDismiss();
    if (hit.kind === 'app') {
      void run(locale.t(hit.app.manifest.name), () => kernel.launch(hit.app.manifest.id));
      return;
    }
    if (hit.kind === 'command') {
      void run(locale.t(hit.command.title), () =>
        kernel.sendCommand(hit.app.manifest.id, hit.command.id, hit.command.args),
      );
      return;
    }
    void run(hit.stat.name, () => kernel.openPath(hit.stat.path));
  };

  const move = (delta: number) => {
    if (flat.length === 0) return;
    const next = (current + delta + flat.length) % flat.length;
    setCursor(next);
    listRef.current?.querySelector(`[data-index='${next}']`)?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (query.length > 0) setQuery('');
      else onDismiss();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = flat[current];
      if (hit !== undefined) open(hit);
    }
  };

  let index = -1;
  return (
    <div
      className="fx-flyout fx-search"
      data-anchor="center"
      role="dialog"
      aria-label={locale.tr('البحث', 'Rechercher', 'Search')}
    >
      <div className="fx-search-box">
        <SearchGlyph size={16} strokeWidth={1.8} />
        <input
          className="fx-search-input"
          autoFocus
          value={query}
          placeholder={locale.tr(
            'ابحث عن التطبيقات والملفات والأوامر',
            'Applications, fichiers et commandes',
            'Search apps, files and commands',
          )}
          aria-label={locale.tr('البحث', 'Rechercher', 'Search')}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className="fx-kbd">Esc</kbd>
      </div>

      <div ref={listRef} className="fx-search-results fx-scroll">
        {flat.length === 0 ? (
          <p className="fx-search-empty fx-caption-text">
            <Sparkles size={20} strokeWidth={1.5} />
            {locale.tr('لا توجد نتائج', 'Aucun résultat', 'No results found')}
          </p>
        ) : (
          sections.map((section) => (
            <section key={section.title} className="fx-search-section">
              <h3 className="fx-caption-text">{section.title}</h3>
              {section.hits.map((hit) => {
                index += 1;
                return (
                  <HitRow
                    key={hit.key}
                    hit={hit}
                    index={index}
                    active={index === current}
                    locale={locale}
                    onOpen={() => open(hit)}
                    onHover={() => setCursor(index)}
                  />
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function HitRow({
  hit,
  index,
  active,
  locale,
  onOpen,
  onHover,
}: {
  hit: Hit;
  index: number;
  active: boolean;
  locale: AppLocale;
  onOpen: () => void;
  onHover: () => void;
}) {
  const shared = {
    type: 'button' as const,
    className: 'fx-search-row',
    'data-index': index,
    'data-active': active ? 'true' : 'false',
    onClick: onOpen,
    onPointerEnter: onHover,
  };

  if (hit.kind === 'file') {
    const Glyph = iconForContentType(hit.stat.contentType, hit.stat.kind);
    return (
      <button {...shared}>
        <Glyph size={20} strokeWidth={1.6} />
        <span className="fx-search-text">
          <span className="fx-title-ellipsis">{hit.stat.name}</span>
          <span className="fx-caption-text fx-title-ellipsis">{hit.stat.path}</span>
        </span>
        <span className="fx-caption-text">{fmt.relativeTime(hit.stat.modifiedAt, locale.lang)}</span>
      </button>
    );
  }

  const { manifest } = hit.app;
  return (
    <button {...shared}>
      <AppIcon icon={manifest.icon} category={manifest.category} size={24} />
      <span className="fx-search-text">
        <span className="fx-title-ellipsis">
          {hit.kind === 'command' ? locale.t(hit.command.title) : locale.t(manifest.name)}
        </span>
        <span className="fx-caption-text fx-title-ellipsis">
          {hit.kind === 'command' ? locale.t(manifest.name) : locale.t(manifest.description)}
        </span>
      </span>
      {hit.kind === 'command' && hit.command.accelerator !== undefined ? (
        <kbd className="fx-kbd">{hit.command.accelerator}</kbd>
      ) : active ? (
        <CornerDownLeft size={14} className="fx-search-enter" />
      ) : null}
    </button>
  );
}
