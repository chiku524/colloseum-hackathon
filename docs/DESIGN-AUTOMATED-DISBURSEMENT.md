# Design note: “set and forget” / automated payouts to many wallets

This captures how we **could** extend Creator Team Treasury so creators opt into **more automatic** fund movement—without pretending Solana runs cron jobs or executes natural language on-chain.

For current behavior (manual propose → approve → timelock → execute), see [`ESSENTIALS.md`](./ESSENTIALS.md).

---

## 1. What blockchains can and cannot do

- **No native schedulers.** Nothing on Solana “wakes up” at 9am Friday and sends tokens. Something must **submit a transaction** (human, bot, or serverless cron).
- **Plain English is not executable on-chain.** The chain can only enforce **deterministic rules** over **fixed fields** (numbers, pubkeys, hashes, time comparisons). “Pay collaborators fairly when revenue spikes” must become **structured data** (splits, caps, schedules) that the program interprets—or stay **off-chain** with only a **hash** committed for audit (today’s `policy_hash` pattern).
- **Every fund movement still needs a transaction.** That includes **escrow-style** flows: e.g. a contributor submits work off-chain, an **admin or project lead signs** “pay this person / this milestone” in your dapp, and the program **enforces** policy (who may propose, approvers, timelock, caps) on that instruction. No cron required—the **human action is the trigger**; the smart contract is the rulebook and vault.
- **Optional automation** (if you add it later) still implies a trigger, e.g.:
  - **Permissionless crank:** anyone can call `tick_auto_payout` (or similar) when conditions are met; they pay tx fees and maybe get a tiny incentive, or
  - **Trusted keeper:** your backend or Vercel cron calls the instruction on a schedule.

### 1.1 Can a deployed smart contract “do the scheduling itself”?

**Not in the sense of a background process.** A Solana program is **passive**: it only runs when a **transaction** invokes one of its instructions. There is no long-running loop inside the deployed `.so` and no built-in “run every Friday.”

What the program **can** do when it **is** invoked (e.g. by a crank transaction):

- Read **`Clock`** sysvar and compare to stored `next_eligible_ts`.
- If the time is right, perform payouts and **advance** the stored schedule (e.g. set the next eligible time).

So the **rules** and **state** live on-chain, but **something in the world** must still **submit** each transaction—whether that is an **admin payout**, a **bot/crank**, or **cron**. The contract does not submit transactions on its own; it **validates** them when they arrive.

---

## 2. Product shape: opt-in at project creation

A realistic v1 adds **flags + parameters** on `Project` (or a separate PDA) set in **`initialize_project`** (or a dedicated `configure_automation` after vault init), for example:

| Idea | Meaning |
|------|--------|
| `automation_mode` | `None` (current behavior) \| `ScheduleCrank` \| `SplitOnCrank` (examples). |
| `automation_paused` | Team lead can pause without migrating accounts. |
| On-chain **schedule** | e.g. `interval_secs`, `next_eligible_ts`, max per tick, recipient list cap. |
| On-chain **split definition** | Fixed list of `(recipient_ata_or_owner, bps_or_amount)` **bounded** (e.g. ≤8 rows) so the program stays within compute/space limits. |

**Policies as you have them today** (JSON off-chain, hash on-chain) could **reference** automation: e.g. the JSON includes `automation: { mode, cadence, splits }` and the hash still commits that document; the **program** only enforces a **sanitized subset** that is also stored or derivable in accounts so execution does not need to parse JSON inside BPF.

---

## 3. Execution model (how money actually moves)

1. **Vault still holds funds** (same SPL pattern).
2. New instruction, e.g. **`execute_automated_payout`** or **`crank_scheduled_release`**:
   - `require!(!project.frozen)`;
   - check **clock** ≥ `next_eligible_ts` (or slot-based if you prefer);
   - read **fixed split table** from account data (not free-form text);
   - create or use known ATAs, CPI transfer from vault PDA to each recipient **within per-tick limits**;
   - advance `next_eligible_ts` by `interval_secs`;
   - emit events for indexers.
3. **Optional:** combine with **approval**—e.g. first automated tranche still needs N approvals once, then crank runs unattended (higher risk; document clearly).

---

## 4. “Plain English” policies

| Approach | Role of English | Role of chain |
|----------|-----------------|---------------|
| **A — Authoring only** | Users edit English in UI; **LLM or template** produces **canonical JSON**; user reviews; **hash** stored on-chain (extends current model). | Enforces only what is in **structured** fields or in a **small VM** (see B). |
| **B — Structured DSL only** | English is documentation; **machine schema** is source of truth. | Program validates schema version + executes. |
| **C — Oracle (not recommended for v1)** | English → off-chain agent → posts signed payload. | Verifies signature + executes. Adds trust in oracle; heavy for a treasury MVP. |

Recommendation: **A + B**—keep **plain English for humans**, **canonical JSON + hash** for audit, and add **on-chain fields** only for what `execute_automated_payout` must read (bounded splits, schedule).

---

## 4.1 How should the **average** user define policies? (UX, not algorithms)

Non-technical users should **not** hand-write JSON or “implement algorithms” into form fields.

Intended product pattern:

| Layer | What the user sees | What the system stores |
|--------|--------------------|-------------------------|
| **Templates / presets** | e.g. “Equal split among team”, “Fixed % per role”, “Weekly after timelock”, “Milestone escrow (admin releases per deliverable)” | Fills a structured form; generates canonical policy + hash. |
| **Toggles & wizards** | On/off for timelock, approval threshold, who may propose payouts, optional automation cadence, caps | Maps to fixed fields the program enforces on each release transaction. |
| **Credibility / reputation (product)** | e.g. roles, badges, delivery checklist—often **off-chain** or linked attestations | Policy can **reference** rules (“only role X can approve”); on-chain stays bounded; UX still toggles/templates. |
| **Recipient list UI** | Add wallet + percent or fixed amount (with validation) | Becomes a **bounded** table in account data or in canonical JSON mirrored on-chain. |
| **Advanced / power users** | Optional “edit JSON” or import | Same pipeline: validate → canonicalize → hash → on-chain commit. |
| **Optional assist** | “Describe in plain English” → draft structured policy (LLM or internal rules) | User **reviews and confirms**; never execute English directly on-chain. |

So: **policies feel like choices and toggles**, not coding. The **hash + structured schema** are implementation details hidden behind the UI (as much as possible), similar to how tax software hides the underlying form definitions.

---

## 5. Risks (must be explicit in UX)

- **Drained vault:** misconfigured splits or intervals can empty the vault faster than intended.
- **No clawback** from wrong recipient pubkey (same as today).
- **Crank liveness:** if nobody calls the instruction, nothing moves—“automatic” means **eligible when cranked**, not guaranteed wall-clock delivery unless you run a keeper.
- **Compute limits:** “many wallets” may require **multiple transactions** per tick (batching).

---

## 6. Implementation phases (suggested)

1. **Spec + UI mock** — opt-in toggle, schedule UI, split table, preview of next run.
2. **Program** — extend `Project` (account size migration or new PDA), new instruction(s), tests (time mocking, edge cases).
3. **Keeper** — optional Vercel cron or open-source worker that calls crank for subscribed projects.
4. **Policy schema** — version `creator_treasury.policy/v2` with `automation` block matching on-chain caps.

---

## 7. Summary answer to “can we allow set and forget?”

**Yes, as an opt-in mode**, if we define **automation = on-chain rules (bounded, structured) + off-chain crank or permissionless crank**, and treat **plain English** as **authoring/documentation** that compiles or maps to that structure—not as literal on-chain code.

If you want to proceed, the next step is a **short RFC** (interval + max recipients + whether approvals apply to auto-runs) before changing `Project` layout and adding instructions.
