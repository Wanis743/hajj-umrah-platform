/**
 * Tenancy configuration.
 *
 * This deployment serves a SINGLE agency: there is no agency switching and no
 * multi-branch scoping in the UI. Every query runs against the one agency the
 * signed-in staff member belongs to (enforced server-side by RLS).
 *
 * If a future deployment ever needs branch scoping again, flip
 * `MULTI_BRANCH_ENABLED` to true — the branch selector and branch performance
 * panel are gated on it rather than deleted.
 */
export const SINGLE_AGENCY = true;
export const MULTI_BRANCH_ENABLED = false;
