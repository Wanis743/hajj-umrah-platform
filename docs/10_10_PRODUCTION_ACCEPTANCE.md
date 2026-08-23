# 10/10 Production Acceptance & Execution Plan

This document serves as the definitive runbook and execution criteria required to issue the final **10/10 Certification** for the Hajj & Umrah Agency ERP. 

As per the final audit requirements, **code existence is not proof**. The following runtime verifications must be executed against a real staging environment or a freshly provisioned Supabase instance, with cryptographic evidence of the output.

---

## 1. CI/CD Release Certification (The Evidence)

The `.github/workflows/release-certification.yml` is configured to run all gates. To satisfy the 10/10 requirement:
1. **GitHub Actions Workflow** must complete with a green checkmark.
2. The final step of the workflow must compress the raw `stdout/stderr` logs of the following jobs into an immutable `evidence.zip` artifact:
   - `toolchain`
   - `fresh-db`
   - `browser-e2e`
   - `browser-e2e-mutation`
   - `storage`
   - `concurrency`
3. A JSON manifest must be generated containing the `commit SHA`, `timestamp`, `environment`, `pass/fail` counts, and `artifact_hash` for each gate.

---

## 2. Fresh Database & Security Replay

**Test Command:** `npm run verify:fresh-db` (Requires Supabase CLI & Docker)
**Execution:**
1. Spins up an empty Postgres instance.
2. Applies 71 migrations sequentially.
3. Seeds test identities and roles.
4. Executes the automated test suites for:
   - `schema verification`
   - `RLS` (Agency isolation, Branch isolation, Privilege escalation)
   - `RBAC matrix`
   - `Finance invariants`

**Success Criteria:** Zero migration failures, zero manual SQL needed, test runner outputs `PASS`.

---

## 3. BOLA / IDOR & Storage Certification

**Test Command:** `npm run verify:storage` && `npm run verify:e2e`
**Execution:**
1. The script will attempt to access foreign Agency resources using standard API keys and legitimate `Bearer` tokens belonging to different users.
2. It will attempt cross-tenant reads, updates, and deletes via PostgREST, RPC, and Storage API directly.
3. Storage script will attempt to access expired URLs, orphan files, and cross-branch bucket structures.
**Success Criteria:** 100% `401 Unauthorized`, `403 Forbidden`, or `404 Not Found` for all foreign access attempts. Zero cross-tenant leakage.

---

## 4. Reservation Concurrency & Finance

**Test Command:** `npm run verify:reservation-concurrency`
**Execution:**
1. Deploys a test package with `capacity = 10`.
2. Fires 100 concurrent booking requests to the staging environment.
**Success Criteria:**
- Exact number of successful bookings `≤ 10`.
- Zero double payments, zero race-condition oversells.
- Debit matches Credit perfectly in the financial journal for successful bookings, and reversals apply cleanly for rejects.

---

## 5. Performance & Accessibility

**Performance Criteria (To be documented during run):**
- **API:** p50 and p95 latency.
- **Frontend:** Route load times and rendering for lists up to 10k records.
- **Capacity:** Documented limits (e.g. "Certified for 250 concurrent reservation ops/sec").

**Accessibility & Localization:**
- Execute Lighthouse CI or manual QA.
- Prove semantic RTL layout (Arabic/DZ) and strict keyboard navigation mapping.

---

## 6. Backup & Disaster Recovery (DR)

**Manual Runbook (Mandatory):**
1. Take a snapshot/backup of the current database via Supabase Dashboard.
2. Introduce a known test state (e.g., create a test booking).
3. Restore the backup to a Point-in-Time prior to the test state.
4. Verify counts, financial ledger consistency, and document RLS integrity.
5. Record **RPO** (Recovery Point Objective) and **RTO** (Recovery Time Objective) in the agency's SLA contract.

---

## 7. Supabase Auth Hardening (Provider Config)

**Mandatory Action:**
- Log into the Supabase Dashboard for the production project.
- Navigate to **Authentication -> Providers -> Email**.
- Ensure **"Leaked-password protection"** is explicitly ENABLED.
*(This satisfies the provider-level security baseline).*

---

## 8. External Integrations UAT

**Mandatory Action:**
- Test standard email/SMS delivery in a Sandbox environment.
- Confirm explicitly in the UI that the Nusuk integration is labeled "Manual/Offline" to prevent false expectations of external API syncing.

---

## 9. Transferability ("Cold Team Test")

**Mandatory Action:**
To prove project maintainability, assign a new DevOps/Developer to the repository with zero prior context. 
They must achieve the following using ONLY `README.md` and standard tools:
1. `git clone`
2. `npm ci`
3. `supabase start`
4. Run all local tests
5. Deploy to a test project
**Success Target:** Time-to-Independent-Developer ≤ 2 business days.

---

### Final Closure
Once all 9 gates above are executed and their evidence artifacts are attached to the release payload, the system is officially granted the **10/10 Production-Ready** certification.
