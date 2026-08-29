/**
 * Guards the promise that made the app layer responsive without touching desktop.
 *
 * `AppFrame` folds its navigation and detail rails out of the flow when its own
 * box is too narrow to hold them (see `src/platform/sdk/ui/responsive.ts`). The
 * threshold is a single number, `CONTENT_MIN`, and it was chosen so that no app
 * can fold at or above the `minSize` its manifest declares — which is the reason
 * a desktop window looks exactly as it did before the rails learned to fold.
 *
 * That promise is a relationship between three numbers living in three places:
 * the manifest's `minSize.w`, the app's `navWidth`/`asideWidth`, and the SDK's
 * `CONTENT_MIN`. Any of them can drift. Lower one manifest minimum, widen one
 * rail, and an app starts folding on a desktop with nothing to catch it. So this
 * runs the real `fitRails` — imported, not reimplemented — over every app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_MIN, fitRails, splitGeometry } from '../src/platform/sdk/ui/responsive.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appsDir = path.join(root, 'src', 'apps');

/** Phones, phablets, snapped thirds and halves, tablets, laptops, desktops, 4K. */
const SWEEP = [320, 360, 375, 414, 480, 540, 640, 720, 768, 820, 900, 1024, 1180, 1280, 1440, 1920];
/** The narrowest compact work area the shell will hand an app. */
const PHONE = 375;

const failures = [];
const fail = (message) => failures.push(message);
let assertions = 0;
const expect = (condition, message) => {
  assertions += 1;
  if (!condition) fail(message);
};

const number = (text, key) => {
  const match = new RegExp(`${key}=\\{(\\d+)\\}`).exec(text);
  return match === null ? null : Number(match[1]);
};

const apps = fs
  .readdirSync(appsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
  .map((entry) => {
    const dir = path.join(appsDir, entry.name);
    const source = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((file) => file.isFile() && /\.tsx?$/.test(file.name))
      .map((file) => fs.readFileSync(path.join(dir, file.name), 'utf8'))
      .join('\n');
    const manifest = fs.readFileSync(path.join(dir, 'manifest.ts'), 'utf8');
    const min = /minSize:\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/.exec(manifest);
    if (min === null) fail(`${entry.name}: manifest declares no minSize, so its desktop floor is unknown`);
    return {
      id: entry.name,
      minWidth: min === null ? 0 : Number(min[1]),
      // A rail with no explicit width takes the AppFrame default.
      nav: /\n\s*nav=\{/.test(source) ? (number(source, 'navWidth') ?? 220) : null,
      aside: /\n\s*aside=\{/.test(source) ? (number(source, 'asideWidth') ?? 300) : null,
    };
  });

if (apps.length === 0) fail('no apps found under src/apps — this check would otherwise pass vacuously');

/** What the app's own content is left with once the folding is decided. */
const contentColumn = (app, width, fit) =>
  width - (fit.nav || app.nav === null ? 0 : app.nav) - (fit.aside || app.aside === null ? 0 : app.aside);

for (const app of apps) {
  const rails = `nav ${app.nav ?? '—'} / aside ${app.aside ?? '—'}`;

  // 1. The desktop promise. At its declared minimum and anywhere above it, an
  //    app keeps every rail it has: a window manager cannot produce a width that
  //    folds one.
  for (const width of [app.minWidth, ...SWEEP.filter((w) => w >= app.minWidth)]) {
    const fit = fitRails(width, app.nav, app.aside);
    expect(
      !fit.nav && !fit.aside,
      `${app.id}: folds at ${width}px, at or above its own minSize ${app.minWidth} (${rails}). Either the manifest ` +
        `minimum dropped, a rail grew, or CONTENT_MIN (${CONTENT_MIN}) rose — a desktop window would now fold.`,
    );
  }

  // 2. A phone keeps no rails at all: 375px cannot seat one and still show work.
  const phone = fitRails(PHONE, app.nav, app.aside);
  if (app.nav !== null) expect(phone.nav, `${app.id}: keeps its ${app.nav}px nav at ${PHONE}px`);
  if (app.aside !== null) expect(phone.aside, `${app.id}: keeps its ${app.aside}px aside at ${PHONE}px`);

  for (const width of SWEEP) {
    const fit = fitRails(width, app.nav, app.aside);
    // 3. Whatever it decided, the layout it produced is usable.
    const column = contentColumn(app, width, fit);
    expect(column >= CONTENT_MIN, `${app.id}: at ${width}px the content column is ${column}px, under CONTENT_MIN (${rails})`);
    // 4. Fold order: an app without its inspector is inconvenienced, an app
    //    without its navigation is unusable, so the nav is always the survivor.
    if (app.nav !== null && app.aside !== null) {
      expect(!(fit.nav && !fit.aside), `${app.id}: at ${width}px it folded the nav while keeping the aside`);
    }
  }
}

// `SplitPane` shares the module and the promise: above two pane minimums its
// geometry is the pixel-for-pixel one it had before it learned to stack.
const desktopSplit = splitGeometry('horizontal', 900, 520, 280);
expect(
  !desktopSplit.column && !desktopSplit.stacked && desktopSplit.first.width === 520 && desktopSplit.grip.cursor === 'col-resize',
  'SplitPane: a 900px horizontal split is no longer the plain 520px pane with a col-resize grip',
);
const unmeasuredSplit = splitGeometry('horizontal', 0, 520, 280);
expect(
  unmeasuredSplit.first.width === 520 && unmeasuredSplit.grip.width === 5,
  'SplitPane: an unmeasured split must render exactly as it did before, not as a stack',
);
const verticalSplit = splitGeometry('vertical', 900, 520, 280);
expect(
  verticalSplit.column && !verticalSplit.stacked && verticalSplit.first.height === 520 && verticalSplit.grip.cursor === 'row-resize',
  'SplitPane: a vertical split changed shape',
);
expect(splitGeometry('horizontal', 700, 900, 280).first.width === 420, 'SplitPane: a pane dragged wider than its window is no longer clamped');
expect(splitGeometry('horizontal', 559, 520, 280).stacked, 'SplitPane: below two minimums it must stack instead of squashing');
expect(!splitGeometry('horizontal', 560, 520, 280).stacked, 'SplitPane: two minimums exactly must still split horizontally');

if (failures.length > 0) {
  console.error(`App fold verification FAILED (${failures.length} of ${assertions} assertions):`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

const folding = apps.filter((app) => app.nav !== null || app.aside !== null).length;
console.log(
  `App fold threshold verification passed (${assertions} assertions: ${apps.length} apps, ${folding} with rails, ` +
    `CONTENT_MIN ${CONTENT_MIN}, no app folds at or above its own minSize).`,
);
