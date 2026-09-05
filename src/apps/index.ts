/**
 * The OS image: every app that ships, and how it is loaded.
 *
 * Two halves per entry, and the split is the whole point. A `manifest` is data
 * the shell installs at boot — Start, search, the taskbar, jump lists and file
 * associations are all built from these before a single app has been downloaded.
 * `load` is a dynamic `import()`, so an app's code arrives the first time it is
 * launched and never before; a cold desktop pays for chrome only.
 *
 * Order is the order Start's "All apps" lists them, which is why the system tools
 * come first, the customer desk follows them, and the finance suite comes last in
 * the order a month is worked: record, reconcile, close, then plan and report on
 * it. The customer desk sits between the two halves because that is where the
 * money the finance suite argues about is first promised to somebody.
 */
import type { AppPackage } from '@/platform/sdk';
import { budgetsManifest } from './budgets/manifest';
import { calculatorManifest } from './calculator/manifest';
import { closeManifest } from './close/manifest';
import { crmManifest } from './crm/manifest';
import { dashboardManifest } from './dashboard/manifest';
import { dmsManifest } from './dms/manifest';
import { eventViewerManifest } from './eventviewer/manifest';
import { inboxManifest } from './inbox/manifest';
import { journalManifest } from './journal/manifest';
import { ledgerManifest } from './ledger/manifest';
import { modelingManifest } from './modeling/manifest';
import { notepadManifest } from './notepad/manifest';
import { profitabilityManifest } from './profitability/manifest';
import { reconcileManifest } from './reconcile/manifest';
import { settingsManifest } from './settings/manifest';
import { sheetsManifest } from './sheets/manifest';
import { statementsManifest } from './statements/manifest';
import { treasuryManifest } from './treasury/manifest';

export const APP_PACKAGES: readonly AppPackage[] = [
  { manifest: settingsManifest, load: () => import('./settings/App') },
  { manifest: eventViewerManifest, load: () => import('./eventviewer/App') },
  { manifest: notepadManifest, load: () => import('./notepad/App') },
  { manifest: calculatorManifest, load: () => import('./calculator/App') },
  { manifest: sheetsManifest, load: () => import('./sheets/App') },
  // Before the book, the desk the book is written from: a lead becomes a customer, a quote
  // becomes a booking, and the booking is what everything below this line later records.
  // Nothing in the finance suite has anything to post until this window has been worked.
  { manifest: crmManifest, load: () => import('./crm/App') },
  // And beside the desk, the filing cabinet both halves cite: a passport scan is attached to a
  // pilgrim on this side of the line and produced as evidence on the other, which is why the
  // library sits between them rather than with the tools it resembles.
  { manifest: dmsManifest, load: () => import('./dms/App') },
  // The first window of the morning, and the one every other finance app is opened
  // from: it reads the whole book and hands the work to whichever app owns it.
  { manifest: dashboardManifest, load: () => import('./dashboard/App') },
  // The queue before the ledger it acts on: a month starts with what is waiting.
  { manifest: inboxManifest, load: () => import('./inbox/App') },
  { manifest: journalManifest, load: () => import('./journal/App') },
  { manifest: ledgerManifest, load: () => import('./ledger/App') },
  // Reconciliation follows the book it checks, because there is nothing to reconcile
  // against until something has been posted to the account the bank mirrors.
  { manifest: reconcileManifest, load: () => import('./reconcile/App') },
  // Last of the month: nothing is closed until the book and the bank agree, so the
  // close comes after the two windows that make them agree.
  { manifest: closeManifest, load: () => import('./close/App') },
  // Planning reads the closed book: a variance is only worth arguing about once the
  // actual it is measured against has stopped moving.
  { manifest: budgetsManifest, load: () => import('./budgets/App') },
  // The forecast comes after the plan it is compared against: a projection with no budget
  // beside it is a shape, and the argument this window exists for is the gap between them.
  { manifest: modelingManifest, load: () => import('./modeling/App') },
  // Reporting is last because it reports on all of it: one window that states what the book
  // says, on the whole book or over one period, and writes nothing back to it.
  { manifest: statementsManifest, load: () => import('./statements/App') },
  // And after the statement, the question it does not answer: not what the agency earned but
  // where the earning came from — which is the same book, sliced by the tags it carries.
  { manifest: profitabilityManifest, load: () => import('./profitability/App') },
  // Last, and the only one of them that looks forward: the same book read for what it can
  // pay rather than what it earned. A profit is an opinion about a period; a balance is a
  // fact about this morning, and the two are not the same question.
  { manifest: treasuryManifest, load: () => import('./treasury/App') },
];
