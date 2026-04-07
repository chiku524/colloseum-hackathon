# Program keypair (dev / local / hackathon)

`creator_treasury-dev-keypair.json` is the **upgrade authority** keypair for program id:

`BYZFRa7NzDB7bKwxxkntewHfWwjBBqM6nsfrVeakBHjV`

- **Do not reuse this keypair for mainnet production.** Generate a fresh keypair, run `anchor keys sync`, and treat upgrade authority like root access.
- Before `anchor build` / `anchor deploy`, copy (or symlink) this file to:

  `target/deploy/creator_treasury-keypair.json`

  so the build artifact and `declare_id!` stay aligned.

If you rotate the keypair, update:

- `programs/creator-treasury/src/lib.rs` (`declare_id!`)
- `Anchor.toml` (`[programs.*]`)
- `idl/creator_treasury.json` (`address`)
