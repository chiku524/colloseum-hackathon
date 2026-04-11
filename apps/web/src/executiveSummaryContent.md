# web3stronghold — Executive summary

**One-liner:** A Solana-native **creator team treasury** — shared custody, explicit payout rules, multi-approver releases, timelocks, and an auditable trail — delivered as an on-chain program plus a team-lead web dashboard and optional read-only/API surfaces.

---

## Problem

Creator organizations (channels, studios, collectives) often pool funds for collaborators, vendors, and community programs. Informal spreadsheets and single-signature wallets **do not scale**: unclear authority, weak dispute hygiene, and high operational risk when many people touch shared money.

---

## Solution

**web3stronghold** implements **governed custody** on Solana:

| Pillar | What it means |
|--------|----------------|
| **Vault** | SPL-token custody in a program-controlled vault tied to a **project** (team lead + project id). |
| **Policy** | Payout rules and constraints are represented by a **policy hash** on-chain; the UI edits structured policy and can **simulate** outcomes before committing. |
| **Approvals & timelocks** | Releases move through **propose → approve (threshold)** → **timelock** → **execute**, reducing impulse errors and aligning signers. |
| **Accountability** | Artifacts, dispute flags, freeze/cancel rules, and **JSON/CSV export** support reconciliation and external review. |
| **Automation (optional)** | Configurable **split crank** moves funds on a schedule within caps; can be triggered by cron when hosted on Vercel. |

---

## What it is not

Not a bank, not payroll-as-a-service, not a social platform, and not a generic DAO framework. It is **focused treasury logic** with **operator-grade** controls for teams that already operate on-chain.

---

## Surfaces

- **Team dashboard** — wallet (or optional cloud email + encrypted keybag flow when Supabase is configured), full project lifecycle, policy builder, releases, audit export.
- **Public read-only** — shareable **status** and **policy simulator** links for transparency (`?view=status`, `?view=simulate`).
- **Serverless API** (when deployed) — JSON snapshot, embed JWT minting, signed webhooks — see deployed documentation and repository security notes.

---

## Technical anchor

- **Chain:** Solana, Anchor program (`creator-treasury`), IDL-driven clients.
- **App:** Vite + React; **hosting** commonly Vercel (static + `api/` routes).

---

## Positioning

Differentiated from “just use a multisig” by combining **policy versioning**, **staged release state machines**, **artifact/dispute hooks**, and **first-class export** for teams that need **repeatable payout governance**, not only key quorum.

---

## Repository

Source and detailed operator guides: **[GitHub](https://github.com/chiku524/web3stronghold)**.  
Public product site: **https://web3stronghold.app** — in-app operator docs live at **`/docs`** (not linked from this page by design; share **`/docs`** with your team as needed).
