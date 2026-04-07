# On-chain invariants — creator-treasury (Phases A–D)

These are the properties the `creator-treasury` program is designed to uphold. Formal verification is out of scope; **integration tests** and **code review** are the enforcement mechanisms for now.

The sections below are ordered by phase so you can see how later phases extend earlier guarantees without rewriting the whole doc.

## Roles and authority

- **Project PDA** is derived from `("project", team_lead, project_id_u64_le)`.
- **`initialize_project`** requires `approvers[0] == team_lead` (signer), unique approvers, `1 ≤ approval_threshold ≤ approvers.len()`, and at most **5** approvers.
- **`propose_release`** and **`cancel_proposal`** require the **team lead** signer matching `project.team_lead`.
- **`approve_release`** requires the signer to be one of `project.approvers[0..approver_count)`.
- **`set_frozen`** is **team lead only**.
- **`set_require_artifact`** is **team lead only** (same PDA / authority pattern as **`set_frozen`**). Emits **`RequireArtifactToggled`** `{ project, require }` for indexers (same idea as **`FrozenToggled`**).
- **`execute_release`** has **no approver gate** (anyone may pay fees to crank); execution still requires **timelock elapsed**, **not frozen**, and **valid token accounts**.

## Vault and tokens

- **Vault state PDA** is `("vault", project.key())`.
- **Vault token account** is the **ATA** of `vault_state` for `vault_state.mint`, with **off-curve owner** (PDA) allowed.
- **Deposits** move tokens **from** `depositor_token_account` **to** `vault_token_account` with `depositor` as SPL authority; mint must match vault mint.
- **Releases** move `proposal.amount` **from** vault ATA **to** `recipient_token_account`, signed by the **vault_state PDA** via CPI seeds.

## Proposals and timelock

- Proposal PDA: `("proposal", project.key(), proposal_id_u64_le)` where `proposal_id` is taken from `project.next_proposal_id` at creation time, then **incremented**.
- **Status flow:** `Pending` → (threshold met) → `Timelock` → `Executed`, or `Cancelled` by lead while still `Pending` or `Timelock`.
- **Threshold:** When the number of distinct approvers recorded in `approved_mask` reaches `approval_threshold`, `timelock_ends_at = now + timelock_duration_secs` and status becomes `Timelock`. **`timelock_duration_secs` may be zero** (useful for tests and instant release after approvals).
- **Double approval:** An approver cannot set their bit twice (`AlreadyApproved`).
- **Execute:** Requires `status == Timelock`, `now >= timelock_ends_at`, `!project.frozen`, vault balance `≥ amount`, recipient ATA **owner == proposal.recipient**, recipient ATA **mint == vault mint**. If **`project.require_artifact_for_execute`**, **`proposal.artifact_sha256`** must be non-zero.

## Freeze

- While **`project.frozen`**, **`approve_release`** and **`execute_release`** fail. **`propose_release`** is also blocked at the account constraint level.
- **Deposits** are intentionally **still allowed** while frozen (optional policy; change later if you want hard stops).

## Phase B — Policy versioning (`policy_hash`, `policy_version`)

- **`Project.policy_version`** is a **monotonic u32** starting at `0` at `initialize_project`. A value of `0` with **`policy_hash` all zero** means no policy has been committed on-chain yet (UI should treat this as “unset”).
- **`set_policy(policy_hash)`**
  - **Signer:** team lead only (`project.team_lead`), same PDA seeds as other lead-gated instructions.
  - **Frozen:** rejected while `project.frozen` (same as `propose_release`).
  - **Hash:** `policy_hash` **must not** be the all-zero digest (`PolicyHashZero`).
  - **Version:** `policy_version` increments by **exactly 1** per successful call; overflow errors with `PolicyVersionOverflow` (practically unreachable).
  - **Event:** emits **`PolicySet`** with `{ project, policy_version, policy_hash }` for indexers.
- **Off-chain source of truth:** the program stores **only** the hash. Clients must use a **canonical serialization** of policy JSON (see `apps/web/src/policy.ts`: sorted keys, sorted payees, stable `schema`) so the hash shown in the UI matches what was signed on-chain.
- **Proposal snapshot:** each **`ReleaseProposal`** records **`policy_version_at_proposal`** at **`propose_release`** time. That value is **immutable** for the life of the account. Audits can answer “which policy revision did this payout run claim?” even if the project’s current `policy_version` has since moved forward.
- **No automatic re-approval:** changing policy does **not** invalidate or reset in-flight proposals. Teams that want stricter rules must enforce them off-chain or in a future program version.

## Phase C — Proposal artifacts (deliverable commitments)

- **Layout (embedded in `ReleaseProposal`):**
  - **`artifact_sha256`:** 32-byte SHA-256 of the deliverable blob (or manifest) the team is committing to. All zero means **not attached**.
  - **`artifact_uri` + `artifact_uri_len`:** optional UTF-8 URI (IPFS, Arweave, HTTPS), max **200** bytes stored on-chain.
  - **`artifact_label` + `artifact_label_len`:** optional short human label, max **64** bytes.
  - **`linked_milestone_id`:** opaque **u64** for an off-chain milestone row (`0` = none). There is no on-chain `Milestone` account in this version.
- **`attach_proposal_artifact`**
  - **Signer:** team lead only.
  - **State:** proposal must be **`Pending` or `Timelock`** (not `Executed` / `Cancelled`).
  - **One-shot:** if `artifact_sha256` is already non-zero, the call fails with **`ArtifactAlreadyAttached`**.
  - **Hash:** new hash must be non-zero (`ArtifactHashZero`); URI and label lengths are capped (`ArtifactUriTooLong`, `ArtifactLabelTooLong`).
  - **Event:** **`ProposalArtifactAttached`**.
- **Optional on-chain gate:** **`Project.require_artifact_for_execute`** (default **`false`** at **`initialize_project`**) can be toggled by the team lead via **`set_require_artifact`**. When **`true`**, **`execute_release`** fails if **`proposal.artifact_sha256`** is still all zero (**`ArtifactRequiredForExecute`**). Approvals and timelock are unchanged; only execution is gated.
- **Policy hooks:** artifact attachment remains **optional** for projects with the flag off; teams can still treat hashes as operational policy off-chain.

## Phase D — Disputes (execute gate)

- **`ReleaseProposal.dispute_active`:** boolean, default `false` at proposal creation.
- **`open_dispute`**
  - **Who may open:** the **team lead** or any pubkey in `project.approvers[0..approver_count)`.
  - **State:** proposal must be **`Pending` or `Timelock`**.
  - **Idempotency:** if a dispute is already open, **`DisputeAlreadyOpen`**.
  - **Event:** **`DisputeOpened`** `{ project, proposal_id, opener }`.
- **`resolve_dispute`**
  - **Signer:** team lead only.
  - **Requires** an active dispute; otherwise **`DisputeNotActive`**.
  - Clears **`dispute_active`**; emits **`DisputeResolved`**.
- **`execute_release`:** if **`dispute_active`**, execution fails with **`DisputeActive`** regardless of timelock and balance. Approvals and timelock can already be satisfied; the dispute is an explicit **hard stop** until the lead resolves it.
- **Non-goals in this slice:** partial payouts, tranches, third-party arbitration, and automatic dispute timeout are **not** implemented; those belong in later iterations of Phase D / product policy.

## Phase E — Integrations (partial in this repo)

- **On-chain:** unchanged; no webhook or REST API in-program (by design).
- **Web (`apps/web`):** **CSV → splits** helper merges `payee,bps` rows into the policy JSON client-side. Full Phase E (signed webhooks, read API with keys, embed host) still requires backend services and is **not** implemented here.

## Explicit non-goals (remaining)

- **Not audited** — do not use for mainnet funds without review, multisig lead wallets, and upgraded threat modeling.
- **Milestone state machine** (Pending → Paid) is **off-chain** only; on-chain linkage is the opaque `linked_milestone_id` on proposals.
