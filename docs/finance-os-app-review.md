# Finance OS — per-app review

Written as the layout work touched each app, so this reports what was found rather
than what was guessed. Nineteen apps became eighteen when Sheets was removed; of
the eighteen, twelve were given a layout of their own, one already had one, and
five are system tools that were deliberately left alone.

Three kinds of finding are separated throughout, because they have different costs:
**missing** (the feature was never built), **not showing** (it was built and nothing
renders it), and **not working** (it renders and the act behind it fails).

---

## Platform findings

These are not per-app. Each one affects several apps at once, and the first is the
most serious thing in this document.

### 0. No dead wiring — a clean result, re-verified

Every command id declared in every app's `manifest.ts` is handled somewhere in that
app: 183 unique `(app, id)` pairs across the eighteen manifests — 175 in `commands`
and eight more that appear only in a `jumpList` — and every one resolves. Three apps
dispatch by construction rather than by literal, and each was checked by hand:

- `eventviewer` builds `channel:${candidate}` at `src/apps/eventviewer/App.tsx:116`,
  and all four channel values are declared at `catalog.ts:68`.
- `settings` builds `page:${entry.page}` at `src/apps/settings/App.tsx:139`–`140`
  over the seven pages its `GROUPS` declares.
- `journal` handles `view:*` by prefix at `src/apps/journal/commands.ts:75`–`78`.

The four export ids come only from the `...EXPORT_COMMANDS` spread
(`src/apps/shared/export/commands.ts:53`), and every app that spreads them also
calls `parseExportCommand`.

So nothing in this suite advertises a command it cannot run. What *is* broken is
one layer down, in the capability table — see finding 1.

### 1. Ninety-seven commands are denied to every app — NOT WORKING

`src/platform/kernel/core/security.ts:38` declares `ROLE_CAPABILITIES` for seven
roles, and `:144` declares the `BASELINE` every principal gets regardless of role.
Six capabilities appear in neither:

| Capability | Commands and syscalls behind it |
|---|---|
| `crm.write` | 29 |
| `dms.write` | 25 |
| `bi.write` | 23 |
| `model.write` | 12 |
| `spine.handoff` | 6 |
| `model.publish` | 2 |

`computeCapabilities` builds the grant set from `BASELINE` plus the roles' lists
(`security.ts:339`–`345`), so a capability named in neither is unreachable: there is
no role — not `super_admin`, not `admin` — that can obtain it. `kernel.ts:383` then
intersects each app's declared `manifest.capabilities` with what the principal can
hold (`intersectCapabilities`, `security.ts:353`), so the capability never reaches
the process record. `authorize` checks the process record at `syscalls.ts:231`–`236`
*before* it considers elevation, and `ensureElevated` returns early for anything
outside `PRIVILEGED_CAPABILITIES` (`syscalls.ts:248`–`249`), so the failure is a flat
`PERMISSION_DENIED` and not a UAC prompt somebody could accept.

Two qualifications, so the claim is exact rather than sweeping. Five system services
are spawned with capability lists taken verbatim rather than intersected
(`systemservices.ts:207`, `:256`, `:396`, `:473`, `:578`, `:660`), so "no process can
hold these" would be an overreach — but none of the six appears in any of those
lists, so those paths are unaffected either way. And `appregistry` does not consult
grants at all. Both roads lead to the same place for the six.

So these 97 are permanently denied to every app: `docs.upload` (`abi.ts:1418`), the
whole CRM write surface, the whole BI authoring surface, every modeling mutation, and
the entire handoff spine that the inbox's three handoff verbs depend on.

**What the database does about it, which is the part that decides how bad this is.**
Each of the six has a real server-side gate underneath it, and they are not equally
strict:

| Capability | Server-side gate |
|---|---|
| `dms.write` | Strongest. `private.dms_reserve_upload` checks `has_permission('dms_document_versions','create')`, and every review transition derives its required permission from the target state — approving needs `approve`, not `update` (`20260831120000_dms_vertical_slice.sql:1002`, `:1311`). |
| `bi.write` | Stricter than the capability. `bi_set_status_command` requires `has_permission(v_table,'publish')` (`20260901120000_bi_studio_vertical_slice.sql:2231`), the client holds select-only grants on BI tables (`:2107`), and no seeded role holds `publish` on a dataset or metric — so `bi.status.set` on a dataset is ADMIN-only in practice. |
| `model.write` | Real. Every write body opens with `private.modeling_guard` → `has_permission(resource, action)` (`20260901180000_modeling_engine_vertical_slice.sql:1112`). |
| `spine.handoff` | Real and seeded widest, deliberately: `spine_guard_chain` / `spine_guard_handoff` at `20260902120000_integration_spine.sql:892`, `:926`, with read/create/update seeded to all six non-ADMIN roles. |
| `crm.write` | Partly. The seven lifecycle bodies gate properly — `has_permission('crm_quotes','update')` inside `private.accept_crm_quote` (`20260830120000_crm_vertical_slice.sql:873`) — but plain create/update/delete delegate to the shared scoped adapters, which check **scope only** (`20260823130000_missing_create_commands.sql:85`, `20260630134500_business_command_adapters.sql:3`). For bare record edits the client capability is the only gate. |
| `model.publish` | Coarser than the capability. `private.modeling_publish_model` gates through `'modeling_models','update'` (`20260901180000_modeling_engine_vertical_slice.sql:1237`), so the same seed that lets FINANCE edit a model lets FINANCE publish it — the database cannot separate draft from publish here. |

So the fix is not "make the syscalls work"; it is a decision, because the kernel role
names (`super_admin`, `finance_manager`, …) and the database role vocabulary (`ADMIN`,
`FINANCE`, `OPERATIONS_MANAGER`, `CRM`, `AGENT`, …) are separate strings with no mapping
in `src/` — `ROLE_CAPABILITIES` is keyed on the former, every `staff_permissions` seed
on the latter. Granting the six at the kernel is a client-side decision, and the
database will answer independently either way.

The fix is a data change, not a code change — add the six to the roles that should
hold them — but it needs a decision about *which* roles, which is why it is reported
here rather than guessed at. It is the single highest-value item left in the
Finance OS.

### 2. The document extensions disagree with themselves — latent, not yet harmful

The virtual filesystem registers `.fjournal` and `.freport`
(`src/platform/kernel/core/vfs.ts:37`–`38`); the icon table and the Settings
association list name `.fxjournal` and `.fxreport`
(`src/apps/shared/fileIcons.ts:81`, `:83`; `src/apps/settings/apps.tsx:57`–`58`).
Two halves of one feature disagreeing about a single letter.

It does not currently break anything, and the reason is worth recording because it
is not obvious: `contentTypeFor` (`vfs.ts:45`) — the only consumer of the vfs
extension table — has **zero callers** in the repository. `fs.writeText` takes
`contentType` as a required argument that every writer supplies explicitly
(`src/apps/journal/actions.ts:181`, `src/apps/statements/actions.ts:108`); icons key
on content type rather than extension (`fileIcons.ts:33`–`36` and the shell's copy
at `src/platform/shell/iconRegistry.ts:37`, `:39`); and association resolution
matches content type first, falling back to the manifests' own `.fx*` extensions
(`src/platform/kernel/core/appregistry.ts:198`, `:204` against
`src/apps/journal/manifest.ts:54` and `src/apps/statements/manifest.ts:64`). So a
file the OS writes gets both its icon and its association today.

The finding stands as a trap rather than a bug: the moment anything calls
`contentTypeFor`, or an extension-first lookup is added, the two tables will
disagree in production. Either delete the dead table or correct it to `.fx*`.

### 3. `Field horizontal` associates no label — NOT WORKING (accessibility)

The vertical branch is Fluent's `Field`, which fixed a real defect: the old label's
`htmlFor` named an id no child ever received, so clicking a field label focused
nothing. The horizontal branch — the Windows-Settings row shape — is still
hand-built, and renders its label as a plain `<div>` with no `id`, no `htmlFor` and
no `aria-labelledby` (`src/platform/sdk/ui/primitives.tsx:834`–`839`). A screen
reader does not associate that label with its control, and clicking it focuses
nothing.

**Nothing calls it.** Repo-wide there is not one call site that passes `horizontal`
to `Field`; the only occurrences of the prop are its own declaration
(`primitives.tsx:807`, `:821`, `:823`). So this is dead code carrying a live defect
— which makes it a smaller problem than it reads as, and a decidable one: either
give the horizontal branch a `useId`-based label association like the vertical one,
or delete the branch. The shape it was written for is not in this app suite.

### 4. `InfoBar` has no live region — known limitation, stated on purpose

`InfoBar` keeps `role="status"` in place of Fluent's `role="group"` and clears
`aria-labelledby` (`src/platform/sdk/ui/layout.tsx:660`–`661`). Fluent announces
through an `AnnounceProvider`, which neither `FluentProvider` nor this shell
installs, so Fluent's own `announce` is a no-op; without the live region an error
appearing in a window would be silent. `role="status"` is the honest substitute.
Installing `AnnounceProvider` in the shell would be the complete fix and is not
done.

---

## The twelve apps that changed shape

Each entry says what the app is now, what the change cost, and what the review
found in passing. Where an app has several views, only the named view changed — the
register-shaped views kept their grids, because a register is the right shape for a
register.

### dashboard — tile wall

Resizable KPI tiles, no grid. Nothing was found missing.

### crm — kanban board for the pipeline

The **pipeline** view is now a board whose cards drag between stages
(`src/apps/crm/board.tsx:313`). The app's other six views — leads, customers,
quotes, activities, follow-ups, campaigns (`src/apps/crm/model.ts:34`–`41`) — keep
their registers, and the fourteen sortable columns in `src/apps/crm/list.tsx` are
all theirs. So nothing was traded away: a pipeline is the one CRM view whose
question is "what stage is this in", and it is the only one that became a board.
**Not working:** every CRM write is behind `crm.write`, which no role holds — see
platform finding 1. The board's drag therefore renders, computes the move, and is
refused by the kernel.

### dms — gallery for the library

The **library** view is now a wall of document tiles with a preview pane
(`src/apps/dms/list.tsx:186`–`197`). The other five views — dashboard, review,
expiry, extraction, packages (`src/apps/dms/types.ts:141`) — keep their registers,
and all twenty-eight sortable columns in `src/apps/dms/list.tsx` belong to them. A
library is the one view whose rows are things you recognise by looking.
**Not working:** `docs.upload` is behind `dms.write`, which no role holds — see
platform finding 1.

### reconcile — side-by-side match board

Statement on the left, mirrored ledger account on the right, the difference between
the two selected rows written between them in the tone of its own answer.
**Changed meaning:** the third view, `'ledger'`, used to mean "show me the ledger
instead of the statement". On a board that would blank the left half, so it now
narrows the *right* half to the postings nobody has reconciled and leaves the
statement whole — which is what its own rail label already said
(`src/apps/reconcile/model.ts:134`–`178`).

### inbox — three-pane reader

Queues, the queue's rows, and the selected row read at length. The reader folds
list-or-item below 600px of content rather than hiding the reading pane behind a
button, and the thresholds are set against the app's own declared `minSize` so it
never folds inside a window the OS calls large enough. **Not working:** the three
handoff verbs (`accept`, `complete`, `decline`) are behind `spine.handoff`, which
no role holds — see platform finding 1. The approvals queue's own verbs carry
`ledger.post` and work.

### ledger — tree and drill

The chart of accounts is a resizable tree column; the selected account's general
ledger takes the rest of the window. **Cost:** the chart's eight columns — code,
name, type, currency, debit, credit, balance and posting count — went with the grid.
Of those, only three carried a figure that the tree does not now show somewhere
else: debit, credit and balance survive as one rolled-up badge on each node, and the
full table of every account's totals is the trial balance, one press away, which
foots properly. The child count was never a column of its own; it was rendered
inside the code cell, and it now drives the chevron instead.
**Also lost:** the chart's double-click, which opened the account for editing. The
Edit button is now permanently beside the account instead of three hundred pixels
away in a gutter.

### treasury — runway hero

The projected balance at display size in the tone of its own verdict, with the four
figures it is made of drawn as a waterfall beside it, over a demoted grid. **Not
showing, now fixed:** four KPI tiles in the aside repeated the hero's figures; they
were removed, and the pane keeps the provenance it was actually for. **Honest
limitation:** the waterfall is withheld rather than drawn with a hole when the riyal
has no rate on record, because every cross-currency figure is `null` at that
moment — not approximate, absent. The rate bar in the pane names the one row in
`exchange_rates` that would fix it.

### budgets — variance bars with a meter per line

Each line drawn against zero on one shared scale, ordered by the size of the gap,
with a meter beside it for how much of the plan is gone. **Cost:** eight sortable
columns. The ordering that mattered — biggest gap first — is now the default, which
is what a review meeting opens on. **Correctness note:** sign is not meaning here,
so the bar is told which gaps are favourable rather than inferring it; spending less
than budgeted on a cost line is a negative number and a good result.

### profitability — treemap and contribution ladder

The treemap says what the business is made of by area; the ladder says which members
carry the result, from a centre line, on one scale. **Cost:** nine sortable columns.
**Known defect:** `Treemap` identifies a tile by its label, so two members of one
dimension that share a label would share a tile's identity. The ladder is keyed
properly and is unaffected. **Design note:** the map is sized by revenue and not by
margin, because a treemap's areas must sum to something and margins do not — a
loss-making member would need negative area.

### journal — ribbon and register

Three ribbon tabs: Entry acts on the held row, Book acts on the window, Data is the
four export formats with a button each. Under it a vertical split: the book over the
open entry's double-entry register. **Not showing, now fixed:** the entry's lines
were a stacked list in a 324-pixel gutter with a comment above it admitting a pane
that narrow is no place for a table. **Cost:** the detail pane's four buttons were
removed in favour of the ribbon's, so there is one copy of each verb and one set of
rules deciding whether it is allowed. The register foots the lines rather than the
header, which is deliberate: the header carries its own pair, and the pane says so
when the two disagree.

### close — vertical timeline with gates

The close as the sequence it is worked in, each step carrying its own evaluated
gates. A dependency naming a task that does not exist is a gate that can never
close, and it now says so in words. Every state has a glyph as well as a colour.
**Cost:** three sortable columns — task, status and last-updated; the fourth column,
owner, was never sortable and still is not. And the two pointer gestures changed
target — double-click and right-click now act on the *selected* step rather than the
step under the pointer, because the timeline owns the single click.

### statements — document page

Paper width, centred on a desk surface, with a running header naming the statement
and its period and a footer stating the basis of preparation. A real table with row
and column headers, which the grid could not be: a statement's rows are not peers.
**Kept as a grid:** the trial balance, because two columns per account and no
structure to indent is a register wearing a statement's name.

---

## The six apps that were left alone

Their layouts were already their own, or they are system tools where a layout is
not the point. Reviewed anyway, and three of them are not clean.

### modeling — canvas workbench, untouched

Two frames, not one: the `workbench` view returns early with its own `AppFrame`
(`src/apps/modeling/workbench/index.tsx:785`), and the three projection views use
the outer frame at `navWidth={272}` / `asideWidth={360}` whose aside swaps
`AccountPane` for `ScenarioPane` by view (`App.tsx:199`–`297`). That is why it was
left alone — it never had the suite's uniform shape to begin with.

**Not showing — the larger half of the engine is unreachable.** `simulate`
(`engine/monte.ts:411`) has no caller outside `engine/index.ts`, so
`Simulation.percentiles`, `.standardError`, `.thresholds` and `.bins` are computed
and never read, as are `Threshold.at` / `.atOrBelow` / `.probability`
(`engine/monte.ts:107`–`109`). Seven more entry points are exported and never
called: `sweepOne` (`engine/sensitivity.ts:247`), `tornado` (`:297`), `twoWay`
(`:406`), `goalSeek` (`engine/optimize.ts:292`), `solve` (`:646`), `driverTree`
(`engine/drivers.ts:169`), `attribute` (`:231`). Whether to wire them up or delete
them is a product decision; leaving both is the one option that is indefensible.

**Not working:** the workbench cannot save anything. Every command in
`workbench/commands.ts` costs `model.write`, and publish/revise cost
`model.publish` — neither is granted to any role (platform finding 1). The app
half-knows: `useCapability('model.publish')` (`workbench/index.tsx:652`) reports
not-granted, so Publish is correctly greyed, while the `model.write` verbs fail at
the syscall with no gate in front of them.

### bi — studio, untouched

`AppFrame` with both rails (`App.tsx:118`–`174`), with `BiMenu` and `BiDialogHost`
as frame siblings rather than children.

**Not showing:** `BiMenuSubject` (`chrome.tsx:615`) is exported and referenced
nowhere. `BiChartFrame.visualizationKey` (`types.ts:335`, written at
`model.ts:1263`) and `BiSourceColumn.isDimension` / `.isMeasure` (`types.ts:470`–
`471`, written at `model.ts:527`–`528`) are built and never read. `BiUi.showDrillPath`
(`shell.ts:400`) is wired to `setDrill` and never called.

**Not working:** two capabilities are missing from its manifest
(`manifest.ts:51`) and both failures are silent. Twenty-two of the twenty-six
`bi.*` commands it sends cost `bi.write` (platform finding 1), so authoring a
metric is refused. And `notify` is absent, so every one of its six toasts
(`actions.ts:589`, `:594`, `:597`, `:653`, `:658`, `:946`) is denied and swallowed —
which is how the first failure goes unreported.

### settings — clean

`AppFrame commands nav navWidth={252} status padded` (`App.tsx:246`), no aside;
seven pages resolve through a `PANELS` lookup (`App.tsx:114`–`122`) rather than JSX
branches. Nothing missing, nothing unrendered, every syscall's capability is held.
It over-declares `eventlog.read` and `window.manage` (`manifest.ts:22`), which costs
nothing but is noise.

### eventviewer — clean

`AppFrame commands nav={<TreeView/>} navWidth={244} status` (`App.tsx:270`), no
aside, the filter strip and grid sharing the content well. Clean on all three
points, and the one place in the suite that already used `TreeView`. Over-declares
`process.enumerate`, `registry.read` and `window.manage`.

### notepad — clean but for one field

`AppFrame commands status scroll={false}` with no rails (`App.tsx:65`); the
structure is internal — a tab strip, then a `SplitPane` when preview is on.
**Not showing:** `TextStats.lines` (`text.ts:53`) is computed by `statsOf`
(`text.ts:61`) and never read; the status bar prints the caret's line and column
and only `stats.words` / `stats.chars` (`chrome.tsx:316`–`322`). A character count
that omits lines is a small thing, and it is a thing somebody wrote on purpose.

### calculator — clean

`AppFrame commands status scroll={false}`, no rails (`App.tsx:124`), the content
well holding one of three mode panels plus an optional history tape. The smallest
manifest in the suite and all four of its capabilities are used.

---

## Export, which was the breakage

The survey's second banked finding, fixed before any of the layout work: there was
not one `URL.createObjectURL` or download `Blob` anywhere in `src/platform/`.
`exportCsv` called `shell.fileDialog` then `fs.writeText`, and `fs.writeText` lands
in the *virtual* filesystem. Clicking Export in any of the fourteen apps that offer
it produced a toast, a file at a simulated `C:\Reports\…` inside the OS, and no file
on the user's computer. The ABI had no binary write and no download path at all.

It now has `fs.writeBinary` (`abi.ts:1232`, mapped to the existing `fs.write`
capability at `:1378`) and `shell.download` (`:1324`, `:1440`); the shell owns the
delivery in `src/platform/shell/host.ts:263`–`273` — `createObjectURL`, an anchor
click, and a revoke ten seconds later, with the UTF-8 BOM branch kept for CSV so
Excel reads Arabic instead of the system codepage. Four writers produce CSV, PDF,
Word and Excel from one `TableDocument` that every report module already built. Both
copies are written: the virtual one, because that is what the file manager browses,
and the real one. Two limitations are worth stating:

- **PDF cannot render Arabic.** The writer is hand-built on the standard-14
  Helvetica face with WinAnsi encoding (`src/apps/shared/export/pdf.ts:242`–`243`),
  which is Latin-only; the repo ships no font file and no PDF library is installed.
  Excel and Word render Arabic correctly for free, because OOXML is UTF-8. So PDF
  export writes a real file for Latin-script documents and falls back to the
  browser's print dialog through `shell.print` for Arabic ones
  (`src/apps/shared/export/index.ts:67`). WinAnsi also has no slot for the arrow
  eight report modules write into their provenance lines, so `winAnsiFold`
  substitutes ASCII for eleven such glyphs — `→` becomes `->`
  (`src/apps/shared/export/document.ts:116`–`120`). Those are substitutions, not
  escapes: they change what the page says, which is why the list is short and holds
  only pairs a reader loses nothing by.
- **The four formats are dynamically imported**, so a user who only ever exports CSV
  downloads none of the other three writers and they never enter the initial bundle.

---

## Fluent adoption, as actually done

The plan said full adoption. What was adopted is every control whose anatomy Fluent
does better. The complete set, taken from the two import blocks that exist
(`src/platform/sdk/ui/primitives.tsx:39`, `src/platform/sdk/ui/layout.tsx:18`):
`Badge`, `Button`, `Checkbox`, `Field`, `Input`, `ProgressBar`, `SearchBox`,
`Select`, `Slider`, `Spinner`, `Switch`, `Textarea`, `ToggleButton`, and
`MessageBar` with its body/title/actions slots behind the `InfoBar` name; plus
`Tab`/`TabList` behind `Pivot`, and `makeStyles`/`mergeClasses` for the recipes
Fluent leaves to the app.

Four things were deliberately not adopted, on measured and architectural grounds:

- **`Dialog`, `Menu`, `Tooltip` and `Popover` stay hand-built.** All four portal to
  `document.body`. An OS window here is an `overflow: hidden` box inside a z-index
  band, so a portalled surface would draw outside its own window, over the taskbar.
- **`DataGrid` and `TreeView` stay hand-built.** Fluent's table measured +38,077 B
  and is weaker than the existing virtualised grid that the register-shaped apps
  depend on; `TreeView` (`src/platform/sdk/ui/data.tsx:594`) is a hand-built
  registry tree with the fold and the keyboard contract already settled. Likewise the
  frame bar (`layout.tsx:121`). **`Toolbar` and `Avatar` are not in this codebase at
  all** — there is no Fluent `Toolbar` import and no `Avatar` anywhere in `src/`.
- **`lucide-react` was not replaced by `@fluentui/react-icons`.** 72 files outside
  `src/apps/` and `src/platform/` import lucide, so the swap would add a second icon
  library rather than replace one.

Two defects were found and fixed during the adoption: `toneSurface('accent')` had
been returning the *information* tone (it now maps to `--fx-accent-bg` at
`src/platform/sdk/ui/tokens.ts:43`–`46`, distinct from `info`), and `Treemap`
rendered nothing at all until its box had been measured (it now squarifies against
a 16:9 guess at `src/platform/sdk/ui/charts.tsx:754`, so the first paint is a real
layout).

Two earlier findings need restating more carefully than they were first recorded:

- **The `.fx-search` collision is resolved; the class is not gone.** `.fx-search`
  is still defined in `src/platform/shell/fluent.css` with ten `.fx-search-*`
  descendants, and the shell's Start-search flyout still renders it
  (`src/platform/shell/Search.tsx:154`, with `:63` using it as a dismiss boundary).
  What changed is ownership: nothing under `src/platform/sdk/` emits `.fx-search`
  any more, so the class has exactly one owner and two components can no longer
  disagree about what it means.
- **`Pivot` relies on `reserveSelectedTabSpace` rather than passing it.** `Pivot`
  is Fluent's `TabList` (`src/platform/sdk/ui/layout.tsx:481`, element at `:483`–
  `489`), which brings the roving tabindex, arrow keys, Home and End that closed the
  keyboard-contract gap. It passes `appearance`, `size`, `selectedValue`,
  `onTabSelect` and `className`; the reserved width for the selected tab's weight is
  Fluent's default and is named only in the doc comment at `:478`. That is a correct
  outcome resting on an upstream default, which is worth knowing if Fluent ever
  changes it.

**The perf budget the plan allowed to be raised was not needed.** `largest` stands
at 123,991 B against the 140,000 B ceiling (89%), and the largest chunk is still
`AdvancedAnalytics`, which is not part of the Finance OS. `total` is 1,043,737 B of
1,130,000 B (92%).

---

## What was not verified

The Finance OS is auth-gated and cannot be reached in the dev preview, so nothing in
this document was confirmed by clicking. Every layout claim was verified by rendering
the component under Vite SSR and asserting its markup — 81 assertions across the
four layout commits (16, 18, 18 and 29) — plus the fold gate's 653 responsive
assertions across 18 apps and 16 widths. Under SSR `useElementWidth` reports 0, which
means every responsive component drew its *unfolded* case: the folds are argued from
`fitRails` and `splitGeometry` arithmetic, not observed. No database work was involved
in any of it.
