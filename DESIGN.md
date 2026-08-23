# Hajj & Umrah ERP - Design System

## 1. Brand Philosophy
- **Serious & Professional**: The ERP handles critical logistics, massive financial flows, and people's spiritual journeys. The UI must inspire trust, competence, and reliability.
- **Deep Operational Capability**: Interfaces should support high data density without feeling cluttered. We are building professional tools ("Finance OS", "Operations OS"), not simple consumer apps.
- **Dark Mode Focused**: The primary aesthetic is a sleek, modern dark mode. This reduces eye strain for operators working long hours and provides a premium, command-center feel.
- **Glassmorphism Aesthetic**: We use subtle glassmorphism (translucency, background blur, and refined borders) to create depth and hierarchy without relying on harsh shadows or flat, solid surfaces.

## 2. Color Palette
The color system relies heavily on cool grays (Slate/Zinc) for the structural elements, with strategic use of color for actions and states.

- **Backgrounds & Surfaces**:
  - `bg-slate-950` / `bg-zinc-950`: App background.
  - `bg-slate-900/50`: Glass panels and card backgrounds (paired with `backdrop-blur`).
  - `bg-slate-800/50`: Hover states for interactive elements.
- **Borders**:
  - `border-slate-800` / `border-white/10`: Subtle borders to define edges on glass panels.
- **Accents (Brand & Active States)**:
  - `text-indigo-400` / `text-blue-400`: Primary actions, active tabs, selected states.
  - `bg-indigo-500/20`: Subtle background highlights for active elements.
- **Semantics**:
  - **Success**: `text-emerald-400`, `bg-emerald-500/10`, `border-emerald-500/20`. Used for completed payments, successful visa issuances, arrived flights.
  - **Warning**: `text-amber-400`, `bg-amber-500/10`, `border-amber-500/20`. Used for pending actions, approaching deadlines (e.g., passport expiration).
  - **Error/Destructive**: `text-rose-400`, `bg-rose-500/10`, `border-rose-500/20`. Used for failed transactions, rejected visas, critical alerts.
- **Text**:
  - Primary: `text-slate-200` (Main headings, critical data)
  - Secondary: `text-slate-400` (Labels, secondary information, table headers)
  - Muted: `text-slate-500` (Disabled states, minor metadata)

## 3. Typography
- **Typeface**: `Inter` (or system sans-serif like SF Pro). It offers excellent legibility for data-dense applications.
- **Tracking (Letter-spacing)**:
  - Tighter tracking for large headings (`tracking-tight` for `text-2xl` and above) to maintain a compact, professional look.
  - Normal or slightly loose tracking for all caps labels (e.g., `uppercase tracking-wider text-xs` for table headers or small metadata).
- **Weights**:
  - Regular (`font-normal`) for body text.
  - Medium (`font-medium`) for buttons, tabs, and interactive labels.
  - Semibold (`font-semibold`) for headers and important data points (e.g., financial totals).

## 4. Layout & Spacing
- **Densities**:
  - **Data Grids / Tables**: High density. Use `p-2` or `p-3` for cells. Focus on alignment and scanning. No unnecessary padding.
  - **Summary Views / Dashboards**: Medium density. Use `p-4` or `p-6` for cards to give key metrics room to breathe.
- **Grid System**: Use CSS Grid for complex dashboards to ensure strict alignment.
- **Max Widths**: Constrain reading widths for text, but allow data tables to expand or scroll horizontally if necessary.

## 5. UI Components Guardrails
- **Glass Panels (Cards, Modals)**:
  - Always use `backdrop-blur-md bg-slate-900/40 border border-white/10 rounded-xl` for primary containers.
  - Avoid stacking too many glass layers (max 2) to maintain performance and visual clarity.
- **Tabs**:
  - Minimalist design. Active tab: `text-indigo-400 border-b-2 border-indigo-400`. Inactive: `text-slate-400 hover:text-slate-200`.
- **Command Palettes (Cmd+K)**:
  - Central to the "OS" feel. Operators should be able to navigate to any module (Finance, Visas, Transport) via keyboard.
  - Should have a very blurred background overlay (`backdrop-blur-sm bg-black/50`).
- **Icons**:
  - Use `Lucide Icons`. Keep sizes consistent (`w-4 h-4` for inline, `w-5 h-5` for standard buttons/nav). Use `stroke-width={2}` or `1.5` depending on size.

## 6. Animation Guidelines
Animations must feel snappy, deliberate, and professional. No bouncy or lingering effects.

- **Framer Motion**:
  - Use for layout transitions, modal enter/exit, and list item staggered reveals.
  - Timing: Fast. `duration: 0.2`, `ease: "easeOut"` or `"easeInOut"`.
  - Example transition: `initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}`.
- **Anime.js**:
  - Reserved for complex data visualizations, such as "data rings", progress indicators, or financial dashboards that need sequential path animations or complex easing.
- **Hover States**:
  - Use simple CSS transitions (`transition-all duration-200 ease-in-out`) for buttons and links.
