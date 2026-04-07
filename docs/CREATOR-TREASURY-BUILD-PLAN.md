# Creator Team Treasury & Settlement — Build Plan

This document describes phased delivery for a **Solana-native ops layer for creator team leads**: policy-defined payouts, staged settlements, dispute windows, and cryptographic accountability. It is written so each phase produces **production-shaped** artifacts (specs, tests, security thinking), not throwaway demos.

---

## 1. Product vision

**Primary user:** Creator **team lead** (operations/finance for a creator org).

**Core promise:** Run collaborator payouts and revenue splits with **explicit policies**, **safe fund movement** (holdbacks, timelocks, approvals), and a **verifiable trail** (who approved what, what artifact justified release).

**Non-goals (initially):** Replacing full streaming/social platforms; becoming a generic DAO framework; supporting every chain and every token on day one.

---

## 2. Design principles

- **One spine, many modules:** Treasury + policy + state machine first; integrations and widgets attach to stable APIs.
- **Policy is versioned:** Every payout run references a **policy revision** so disputes reference a frozen config.
- **Verification is first-class:** Human attestations and/or artifact commitments (hashes) are modeled explicitly, not bolted on.
- **Fail safe:** Default to **hold** > **incorrect release**; prefer **explicit approvals** over implicit automation until invariants are proven.
- **Indexability:** Emit structured **events** and keep account layouts friendly for off-chain indexers and widgets.

---

## 3. High-level architecture

| Layer | Responsibility |
|--------|----------------|
| **On-chain program (Anchor)** | Vaults, policies, roles, state machine, releases, disputes, events. |
| **Indexer / API** | Aggregate on-chain state into queries for dashboards and widgets (can start serverless + cron, evolve to dedicated indexer). |
| **Web app (team lead)** | Project dashboard, policy editor, simulator, approval inbox, audit export. |
| **Embeds / widgets** | Read-only or action-limited surfaces for collaborators and sponsors (see §8). |
| **Integrations** | Wallet adapters, optional storage (IPFS/Arweave) for artifact URIs, webhooks (Discord/Telegram), CSV import/export. |

---

## 4. Phase A — Custody, roles, approvals, timelock

**Outcome:** A team can fund a vault, configure **2-of-N** style approvals (or lead-only with optional second signer), and release USDC after a **timelock** unless frozen.

### Steps

1. **Requirements**
   - Define actors: `TeamLead`, `Finance`, `Collaborator`, `Payee` (may overlap in v1).
   - Define instruction set sketch: `init_project`, `init_vault`, `deposit`, `propose_release`, `approve_release`, `cancel_proposal`, `execute_release` (post-timelock), `freeze_vault`.
   - Document **invariants** (e.g., released amount ≤ available; proposal cannot double-spend same allocation).

2. **Program layout (Anchor)**
   - PDAs: `Project`, `Vault`, `PolicySnapshot` (or embed policy hash in `Project`), `ReleaseProposal`, `ApprovalRecord` (or compact bitmap per proposal).
   - Use **SPL Token** transfers from **vault authority** PDA; document ATA creation flow for payees.

3. **Token & account hygiene**
   - USDC (devnet + mainnet-beta) assumptions; decimals; associated token accounts; rent-exempt closes where applicable.
   - Explicit error codes; no silent truncation.

4. **Tests**
   - Happy path: deposit → propose → approve → timelock → execute.
   - Negative: double execution, insufficient balance, wrong signer, expired vs active proposal.
   - Fuzz-light: randomized approval order if applicable.

5. **Minimal CLI or script**
   - Seed project + deposit for local/devnet demos ( speeds iteration before UI).

6. **Event emission**
   - `ProjectCreated`, `Deposited`, `ReleaseProposed`, `Approved`, `Released`, `Frozen` with stable field ordering.

**Exit criteria:** Devnet deployment; invariant doc; core integration tests green; one scripted end-to-end flow documented.

---

## 5. Phase B — Versioned policies & payout simulator (client)

**Outcome:** Policies are **editable**, **versioned**, and **simulatable** in the UI before on-chain submission.

### Steps

1. **Policy schema (off-chain JSON + on-chain hash)**
   - Fields: split map (payee → bps or fixed), caps, holdback bps, allowed mints, approval threshold, timelock duration, policy version integer.
   - On-chain: store `policy_hash` + `version`; optionally anchor full config in Arweave/IPFS later—**hash must match** what UI shows.

2. **Web app foundation**
   - Wallet connect (Phantom + one more adapter).
   - Project list; project detail; vault balance read.

3. **Policy editor**
   - Form + JSON “advanced” tab; **diff view** between current and proposed policy.
   - Validation: sums to 100% (or explicit remainder to vault), max payees, max timelock bounds.

4. **Simulator**
   - Given hypothetical deposit and policy, compute **per-payee amounts**, **holdback**, **timeline** (when executable).
   - Read-only; no signing until user confirms “Apply policy vN on-chain.”

5. **Instruction: `set_policy`**
   - Updates version; optionally requires **re-approval** from lead/finance if material change (configurable rule).

**Exit criteria:** User can create a project, set policy v1/v2, see diff, simulate payout, and apply policy with matching on-chain hash.

---

## 6. Phase C — Artifact commitments & audit export

**Outcome:** Releases can cite **deliverable commitments** (hash + URI); team leads export **audit packages** for accounting.

### Steps

1. **Artifact model**
   - `ArtifactCommitment`: `sha256`, optional `uri` (IPFS/Arweave/HTTPS), `label`, `linked_milestone_id`.
   - Instruction: attach commitment to `ReleaseProposal` or milestone record.

2. **Storage**
   - Start with **hash-only** + optional URI (teams bring their own storage).
   - Optional integration: upload helper in UI using a provider you control or env-based key (document security boundaries).

3. **Milestones**
   - `Milestone` account or embedded enum state: `Pending` → `ReadyForReview` → `ApprovedForPayout` → `Paid`.

4. **Audit export**
   - JSON + CSV: policies, proposals, approvals (pubkeys + sigs or tx ids), releases, artifact hashes, timestamps.
   - **PDF one-pager** optional later (nice for judges/sponsors).

**Exit criteria:** A release proposal cannot be marked “ready” without required artifact fields (if policy mandates); export produces a single zip or structured folder.

---

## 7. Phase D — Disputes, partial release, clawback paths

**Outcome:** Real-world friction: **dispute**, **partial payout**, **refund to vault**, **freeze**.

### Steps

1. **Dispute state**
   - `DisputeOpened { proposal_id, reason_hash, opener }`.
   - Rules: dispute **blocks execute** until resolved or timeout (choose: lead-only resolution v1).

2. **Partial release**
   - Split proposal into **tranches** or allow **subset payees** in one proposal (design choice—document tradeoffs).

3. **Resolution flows**
   - `ResolveDispute { action: ReleaseSubset | Cancel | ExtendTimelock }` with appropriate signers.

4. **UI**
   - Dispute inbox; timeline component; clear copy for collaborators.

**Exit criteria:** Test matrix covers dispute → resolve → payout; no path allows exceeding vault balance.

---

## 8. Phase E — Integrations, notifications, widgets

**Outcome:** Product feels **deployable**: imports, alerts, and **embeddable surfaces** for partners and teammates.

### Steps

1. **CSV import**
   - Import payee list + split bps; map to policy draft; validation errors inline.

2. **Webhooks**
   - Signed outbound events (`proposal.created`, `approval.received`, `released`, `dispute.opened`) for Discord/Telegram bots or Zapier-style glue.

3. **Read API**
   - Stable REST or tRPC behind API keys: project summary, vault balance, latest policy version, public audit slice.

### 8.1 Widget & embed strategy

**Goals:** Let collaborators and sponsors **see truth** (balances, policy, payout status) and perform **narrow actions** without exposing full admin power.

| Embed type | Audience | Capabilities | Suggested tech |
|------------|----------|--------------|----------------|
| **Status widget** | Collaborators, public fans | Read-only: milestone status, next payout date, policy hash link, explorer links | `<iframe>` + postMessage or Web Component; host on `embed.yourdomain.com` |
| **Approval button (deep link)** | Finance / second signer | Opens full app at pre-filled `proposalId`; no signing inside iframe initially | Universal links + wallet adapter in main app |
| **Sponsor dashboard tile** | Brand/agency | Campaign-scoped read API + branded iframe (logo, colors via query params) | Themed CSS variables; CSP allowlist |
| **Team digest** | Slack/Discord | Webhook-rendered cards (not iframe); link “verify on-chain” | Webhook payloads referencing tx signatures |

**Security for widgets**

- **Never** embed privileged keys in widgets; widgets use **read-only** API or **public** on-chain data.
- **postMessage** origin allowlist; **nonce** for handshake; short-lived **embed tokens** (JWT) scoped to `project_id` + `read` only.
- **CSP** headers on embed host; **frame-ancestors** controlled per customer subdomain if you white-label later.

**SDK (optional Phase E+)**

- Thin **npm package**: `createTreasuryWidget({ projectId, mode: 'status' \| 'milestones' })` mounting a shadow-DOM component; consumes your read API.

**Exit criteria:** Documented embed contract; demo page with two themes; read API auth; security checklist signed off for iframe/postMessage.

---

## 9. Cross-cutting work (run parallel to phases)

### Security & operations

- **Threat model doc:** malicious payee, compromised lead key, race on proposals, reentrancy (Solana-specific: CPI ordering), signer spoofing in UI.
- **Key management guide:** recommend **multisig** or **hardware wallet** for lead; separate **hot** vs **cold** roles in copy.
- **Upgrade authority policy:** who holds program upgrade; process for devnet → mainnet migration.

### Quality

- **CI:** `anchor test`, client lint/typecheck, fmt.
- **Devnet → mainnet checklist:** mint addresses, ATA program ids, RPC limits, fee payer strategy.

### Legal / compliance (informational, not legal advice)

- Disclose that teams remain responsible for **tax**, **employment classification**, and **sanctions**; add **ToS placeholders** before public launch.

### Performance & UX

- **Optimistic UI** only where safe (show pending tx); never optimistic for final balances without confirmation.
- **Loading states** per instruction; human-readable error mapping from program errors.

---

## 10. Suggested extras (high leverage)

1. **Policy templates:** “Standard creator squad (4-way split)”, “Sponsor deliverable (milestone + holdback)”.
2. **Simulator sharing:** Shareable read-only link for accountants (no wallet).
3. **On-chain policy registry mirror:** Store IPFS CID of full policy JSON for external auditors.
4. **Rate-limited public proof page:** `/p/:projectId/proof` showing last release tx + artifact hashes (great for hackathon judges).
5. **Feature flags:** Ship widgets behind flags until postMessage auth is hardened.

---

## 11. Milestone checklist (rollup)

| Phase | Deliverable |
|-------|-------------|
| A | Program v0 + devnet + tests + events + scripted E2E |
| B | Policy versioning + editor + simulator + `set_policy` |
| C | Artifacts + milestones + audit export |
| D | Disputes + partial release + resolution paths |
| E | CSV import + webhooks + read API + embed host + widget docs |

---

## 12. Document history

- **v1** — Initial build plan: phased treasury/settlement OS, widget/embed strategy, cross-cutting security and quality.

When phases complete, append dated **retros** (what changed, what was cut, mainnet readiness).
