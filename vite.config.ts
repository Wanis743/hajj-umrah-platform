import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Everything that ships as part of the Fluent design system, checked against the
 * dependency graph rather than guessed: `@griffel/*` is its styling runtime,
 * `@emotion/hash` and `stylis` are Griffel's own two dependencies, `tabster` and
 * `keyborg` are the focus machinery behind its tab lists and menus, and
 * `@swc/helpers` is what every one of its compiled packages calls at runtime. No
 * other dependency in the tree imports any of the six.
 */
const FLUENT_SCOPES = [
  '@fluentui/',
  '@griffel/',
  '@emotion/hash',
  'stylis/',
  'tabster/',
  'keyborg/',
  '@swc/helpers',
] as const;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        /**
         * Three groupings, all because the default split was paying for the same
         * bytes more than once.
         *
         * The icon set is imported by nearly every lazy route, and the icons a
         * route uses were being left inside that route's chunk. One vendor chunk
         * downloads the set once and serves it from cache for every screen after,
         * instead of delivering it in fragments that overlap.
         *
         * The DMS panels are tabs of one workspace, reached through a single dynamic
         * import in AdminDashboard, and nothing else in the tree imports into that
         * folder. So merging a folder's tabs costs no round trip a visitor was not
         * already making -- opening the workspace fetches the folder instead of the
         * first tab, and switching tabs then fetches nothing -- while recovering the
         * per-chunk overhead and the shared table markup that thirteen chunks were
         * each compressing alone. The CRM had the same rule until it became an OS app
         * (`src/apps/crm`); with nothing importing the old folder there is no chunk
         * left to group, and the rule went with it.
         *
         * Fluent is the design system the Finance OS controls are built on, and it
         * arrives as one package with fifty-odd siblings plus a CSS-in-JS runtime.
         * Left alone, Rollup folds all of it into the OS's own lazy chunk, which
         * then carries both the desktop shell and the whole control library in a
         * single download and lands well over the largest-chunk budget. Split out,
         * the shell and the design system are fetched in parallel on first boot and
         * the design system is then cached for every later visit, which is the one
         * part of the OS that does not change when the apps do. The six support
         * libraries named beside it -- Griffel's runtime and its two hashing and
         * serialising helpers, Tabster and Keyborg for focus, and the SWC helpers
         * every Fluent package's compiled output calls -- are imported by nothing
         * else in the tree, so they belong in the same chunk as the thing that
         * needs them rather than scattered through the routes.
         *
         * `scheduler` is deliberately absent from that list: it is React's, and
         * moving it here would make the React chunk import from the Fluent one.
         *
         * Narrow on purpose. Grouping all of node_modules, or the App-* route
         * chunks, or the BI studio's ten panels, each buys a smaller total with a
         * chunk big enough to fail the largest-chunk budget, or with a first paint
         * carrying code the visitor never opens.
         */
        manualChunks: (id: string) => {
          const file = id.replace(/\\/g, '/');
          if (file.includes('node_modules/lucide-react')) return 'vendor-icons';
          if (FLUENT_SCOPES.some((scope) => file.includes(`node_modules/${scope}`))) return 'vendor-fluent';
          return undefined;
        },
        /**
         * Without this, a manual chunk is a seed rather than a list: Rollup walks
         * the static dependencies of everything the function matched and pulls them
         * in too, so the first alias in execution order swallows React, the admin
         * UI kit and the Supabase client. Measured, that put the whole CRM
         * workspace on the critical path of the landing page -- index.html started
         * preloading a 132 KB crm-workspace chunk that the entry then imported
         * React from -- which is the opposite of the intent above. Confining each
         * alias to the modules actually matched keeps both groupings lazy and
         * leaves the rest of the split to Rollup, which was already doing it well.
         */
        onlyExplicitManualChunks: true,
      },
    },
  },
});
