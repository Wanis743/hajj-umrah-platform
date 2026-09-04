import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

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
         * Two groupings, both because the default split was paying for the same
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
         * Narrow on purpose. Grouping all of node_modules, or the App-* route
         * chunks, or the BI studio's ten panels, each buys a smaller total with a
         * chunk big enough to fail the largest-chunk budget, or with a first paint
         * carrying code the visitor never opens.
         */
        manualChunks: (id: string) => {
          const file = id.replace(/\\/g, '/');
          if (file.includes('node_modules/lucide-react')) return 'vendor-icons';
          if (file.includes('/src/components/admin/dms/')) return 'dms-workspace';
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
