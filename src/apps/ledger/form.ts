/**
 * Ledger — the account form.
 *
 * `upsert_chart_account` backs both create and update, and it refuses six things:
 * an empty code or name, a type outside the five, a parent in another agency, an
 * account that is its own parent, a retype of an account that already carries
 * postings, and — through `unique(agency_id, code)` — a code already in use.
 *
 * Every one of those is checked here as well. Not to be clever: a round trip that
 * comes back "22023" tells a person nothing about which of the two required fields
 * they left blank, and the two rules the RPC cannot check on its own — a parent
 * chain that closes a loop, and a code that collides — are exactly the two that
 * cost the most to discover afterwards.
 *
 * The one rule the server enforces and this file only mirrors is the retype:
 * `frozenType` is set when the account has postings, the Select is disabled, and
 * the problem list explains why rather than letting the RPC say `P0001`.
 */
import type { Localized } from '@/platform/sdk';
import {
  type Account,
  ACCOUNT_TYPE_LABEL,
  type AccountType,
  type Currency,
  isDebitNatured,
  statementOf,
} from '../shared/ledger';
import { byCode, wouldCycle } from './accounts';

export interface AccountDraft {
  /** `null` for a new account; the id being edited otherwise. */
  readonly id: string | null;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: Currency;
  readonly parentId: string | null;
  readonly active: boolean;
  /**
   * The type this account already carries postings under, or `null` when it is
   * free to change. Retyping a posted account would restate every statement
   * derived from it, so the server refuses and this freezes the field.
   */
  readonly frozenType: AccountType | null;
}

/**
 * A new account, optionally under a parent.
 *
 * The type is inherited from the parent because that is nearly always right — a
 * child of `4000 Revenue` is revenue — and being wrong here is one Select away.
 */
export function emptyDraft(parent: Account | null, code: string): AccountDraft {
  return {
    id: null,
    code,
    name: '',
    type: parent?.type ?? 'ASSET',
    currency: (parent?.currency === 'SAR' ? 'SAR' : 'DZD') as Currency,
    parentId: parent?.id ?? null,
    active: true,
    frozenType: null,
  };
}

export function draftFromAccount(account: Account, hasPostings: boolean): AccountDraft {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    currency: account.currency === 'SAR' ? 'SAR' : 'DZD',
    parentId: account.parentId,
    active: account.active,
    frozenType: hasPostings ? account.type : null,
  };
}

export type DraftPatch = Partial<Omit<AccountDraft, 'id' | 'frozenType'>>;

export const patchDraft = (draft: AccountDraft, patch: DraftPatch): AccountDraft => ({ ...draft, ...patch });

/** Whether anything has been typed, so the window can report itself dirty. */
export const hasContent = (draft: AccountDraft): boolean =>
  draft.code.trim() !== '' || draft.name.trim() !== '';

/**
 * Whether the form still says what the account says.
 *
 * Used to keep the primary button quiet on an edit nobody changed: `upsert` would
 * happily rewrite the row with itself and write an `ACCOUNT_UPDATE` into the audit
 * trail for it, which is a lie the trail then keeps.
 */
export function isUnchanged(draft: AccountDraft, account: Account | null): boolean {
  if (account === null) return false;
  return (
    draft.code.trim() === account.code &&
    draft.name.trim() === account.name &&
    draft.type === account.type &&
    draft.currency === account.currency &&
    draft.parentId === account.parentId &&
    draft.active === account.active
  );
}

/* ------------------------------------------------------------------ *
 * Suggested codes
 * ------------------------------------------------------------------ */

/** Where each type is numbered from, when the chart has nothing to go on yet. */
const TYPE_BASE: Readonly<Record<AccountType, number>> = {
  ASSET: 1000,
  LIABILITY: 2000,
  EQUITY: 3000,
  REVENUE: 4000,
  EXPENSE: 5000,
};

const leadingNumber = (code: string): number | null => {
  const parsed = Number.parseInt(code.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The next free code, in the numbering the chart already uses.
 *
 * Under a parent it continues that parent's block; at the top level it continues
 * the type's. Ten at a time, which is the gap a chart is normally numbered with so
 * there is room to insert later. A collision is then stepped past one at a time,
 * because a suggestion the unique index would reject is worse than no suggestion.
 */
export function suggestCode(
  accounts: readonly Account[],
  type: AccountType,
  parent: Account | null,
): string {
  const taken = new Set(accounts.map((account) => account.code.trim()));
  const pool =
    parent === null
      ? accounts.filter((account) => account.type === type && account.parentId === null)
      : accounts.filter((account) => account.parentId === parent.id);
  let highest: number | null = null;
  for (const account of pool) {
    const value = leadingNumber(account.code);
    if (value !== null && (highest === null || value > highest)) highest = value;
  }
  const base = parent === null ? TYPE_BASE[type] : (leadingNumber(parent.code) ?? TYPE_BASE[type]);
  let candidate = highest === null ? (parent === null ? base : base + 10) : highest + 10;
  for (let guard = 0; guard < 5000 && taken.has(String(candidate)); guard += 1) candidate += 1;
  return String(candidate);
}

/* ------------------------------------------------------------------ *
 * The payload
 * ------------------------------------------------------------------ */

/** `account.create` for a new row, `account.update` for an existing one. */
export const draftCommand = (draft: AccountDraft): 'account.create' | 'account.update' =>
  draft.id === null ? 'account.create' : 'account.update';

/**
 * The command payload.
 *
 * `accountId` is present only on an update — the binding requires it there and
 * would reject it here. Code and name are trimmed because the RPC trims them
 * anyway; sending the untrimmed text would store one string and return another.
 */
export function accountPayload(draft: AccountDraft): Readonly<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    code: draft.code.trim(),
    name: draft.name.trim(),
    accountType: draft.type,
    currencyCode: draft.currency,
    parentId: draft.parentId,
    isActive: draft.active,
  };
  if (draft.id !== null) payload.accountId = draft.id;
  return payload;
}

/**
 * The payload that only flips `is_active`.
 *
 * There is no `account.deactivate` — `upsert_chart_account` is the whole write
 * surface and it requires code, name and type on every call — so activating or
 * deactivating means resending the account unchanged but for the one flag.
 */
export const activePayload = (account: Account, next: boolean): Readonly<Record<string, unknown>> =>
  accountPayload({ ...draftFromAccount(account, false), active: next });

/* ------------------------------------------------------------------ *
 * Problems
 * ------------------------------------------------------------------ */

export type ProblemField =
  | 'code'
  | 'name'
  | 'duplicate'
  | 'parent'
  | 'cycle'
  | 'retype'
  | 'mismatch'
  | 'hidden'
  | 'branch'
  | 'numbering';

export interface Problem {
  readonly field: ProblemField;
  readonly text: Localized;
  /** `false` for the advisory ones: the write is allowed, the chart is worse for it. */
  readonly blocking: boolean;
}

/** Whether the primary button has to stay disabled. */
export const blocks = (problems: readonly Problem[]): boolean =>
  problems.some((problem) => problem.blocking);

/** Which way an account moves, and which statement it lands on. */
export interface Nature {
  readonly debit: boolean;
  readonly statement: 'balance' | 'income';
}

/** For the hint under the type Select: which way it moves and where it lands. */
export const natureOf = (type: AccountType): Nature => ({
  debit: isDebitNatured(type),
  statement: statementOf(type),
});

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

type Sink = (field: ProblemField, blocking: boolean, ar: string, fr: string, en: string) => void;

const indexById = (accounts: readonly Account[]): ReadonlyMap<string, Account> =>
  new Map(accounts.map((account) => [account.id, account]));

/**
 * The six the server would refuse.
 *
 * Two of them it refuses without being able to say which — `22023` covers both
 * empty fields — and two it cannot see at all from one row: a code held by
 * another account, and a parent chain that closes a loop through a grandparent.
 */
function hardProblems(draft: AccountDraft, accounts: readonly Account[], add: Sink): void {
  const code = draft.code.trim();
  const name = draft.name.trim();
  if (code === '') add('code', true, 'رمز الحساب مطلوب.', 'Le code du compte est requis.', 'An account code is required.');
  if (name === '') add('name', true, 'اسم الحساب مطلوب.', 'Le nom du compte est requis.', 'An account name is required.');

  const clash = accounts.find(
    (account) => account.id !== draft.id && account.code.trim().toLowerCase() === code.toLowerCase(),
  );
  if (code !== '' && clash !== undefined) {
    add(
      'duplicate',
      true,
      `الرمز ${code} مستخدم بالفعل في «${clash.name}».`,
      `Le code ${code} est déjà utilisé par « ${clash.name} ».`,
      `Code ${code} already belongs to “${clash.name}”.`,
    );
  }

  if (draft.parentId !== null && !indexById(accounts).has(draft.parentId)) {
    add('parent', true, 'الحساب الأب غير موجود.', 'Le compte parent est introuvable.', 'The parent account no longer exists.');
  }
  if (draft.id !== null && draft.parentId !== null && wouldCycle(accounts, draft.id, draft.parentId)) {
    add(
      'cycle',
      true,
      'هذا الأب يقع تحت هذا الحساب، فيتشكّل مسار مغلق.',
      'Ce parent est situé sous ce compte : la hiérarchie se refermerait sur elle-même.',
      'That parent sits under this account, which would close the tree into a loop.',
    );
  }
  if (draft.frozenType !== null && draft.type !== draft.frozenType) {
    add(
      'retype',
      true,
      'لا يمكن تغيير نوع حساب له قيود مسجّلة.',
      'Le type d’un compte déjà mouvementé ne peut pas changer.',
      'The type of an account that already carries postings cannot change.',
    );
  }
}

/** Which leading digits each type already uses, ignoring the account being edited. */
function digitOwners(
  accounts: readonly Account[],
  skipId: string | null,
): ReadonlyMap<string, ReadonlySet<AccountType>> {
  const owners = new Map<string, Set<AccountType>>();
  for (const account of accounts) {
    if (account.id === skipId) continue;
    const digit = account.code.trim().charAt(0);
    if (digit < '0' || digit > '9') continue;
    const seen = owners.get(digit) ?? new Set<AccountType>();
    seen.add(account.type);
    owners.set(digit, seen);
  }
  return owners;
}

/**
 * The four the server allows and a chart regrets.
 *
 * The numbering one is deliberately learned from the chart rather than from a
 * table: this book numbers expenses in both the 5000s and the 6000s, so a rule
 * that expected 5 would cry wolf on half of them. What it can say is that no
 * expense account has ever started with a 4 here, and this one does.
 */
function softProblems(draft: AccountDraft, accounts: readonly Account[], add: Sink): void {
  const parent = draft.parentId === null ? null : (indexById(accounts).get(draft.parentId) ?? null);
  if (parent !== null && parent.type !== draft.type) {
    const label = ACCOUNT_TYPE_LABEL[parent.type];
    add(
      'mismatch',
      false,
      `الأب «${parent.name}» من نوع ${label.ar}، فسيجمع المجموع نوعين مختلفين.`,
      `Le parent « ${parent.name} » est de type ${label.fr} : le cumul mêlerait deux natures.`,
      `Parent “${parent.name}” is ${label.en}, so its roll-up would mix two natures.`,
    );
  }
  if (parent !== null && !parent.active && draft.active) {
    add(
      'hidden',
      false,
      `الأب «${parent.name}» غير مفعّل، فلن يظهر هذا الحساب إلا بإظهار غير المفعّلة.`,
      `Le parent « ${parent.name} » est inactif : ce compte ne s’affichera qu’avec les inactifs.`,
      `Parent “${parent.name}” is inactive, so this account only shows when inactive ones do.`,
    );
  }
  const liveChildren = accounts.filter(
    (account) => draft.id !== null && account.parentId === draft.id && account.active,
  ).length;
  if (!draft.active && liveChildren > 0) {
    add(
      'branch',
      false,
      `تحت هذا الحساب ${liveChildren} حسابًا مفعّلًا سيبقى كذلك.`,
      `${liveChildren} compte(s) actif(s) restent sous ce compte.`,
      `${liveChildren} active account(s) sit under this one and will stay active.`,
    );
  }
  const digit = draft.code.trim().charAt(0);
  const owners = digitOwners(accounts, draft.id).get(digit);
  if (owners !== undefined && owners.size > 0 && !owners.has(draft.type)) {
    const label = ACCOUNT_TYPE_LABEL[[...owners][0]];
    add(
      'numbering',
      false,
      `الرموز التي تبدأ بـ ${digit} مخصّصة في هذا الدليل لحسابات ${label.ar}.`,
      `Dans ce plan, les codes commençant par ${digit} sont des comptes de type ${label.fr}.`,
      `Codes starting with ${digit} are ${label.en} accounts everywhere else in this chart.`,
    );
  }
}

/**
 * Everything wrong with the draft, blocking first.
 *
 * Ordered that way because the list is rendered as it comes and the reason the
 * button is disabled has to be the first line, not the fourth.
 */
export function validateAccount(draft: AccountDraft, accounts: readonly Account[]): readonly Problem[] {
  const problems: Problem[] = [];
  const add: Sink = (field, blocking, ar, fr, en) => {
    problems.push({ field, blocking, text: { ar, fr, en } });
  };
  hardProblems(draft, accounts, add);
  softProblems(draft, accounts, add);
  return problems;
}

/**
 * The accounts that may be chosen as a parent, code-sorted.
 *
 * The account itself and everything under it are removed rather than left in and
 * rejected: a Select that offers a choice it will refuse is a worse explanation
 * than a Select that never offered it.
 */
export function parentChoices(accounts: readonly Account[], draft: AccountDraft): readonly Account[] {
  return accounts
    .filter(
      (account) =>
        account.id !== draft.id && (draft.id === null || !wouldCycle(accounts, draft.id, account.id)),
    )
    .slice()
    .sort(byCode);
}
