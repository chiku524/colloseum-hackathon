# Web app (Phase B)

Phase B adds the team-lead dashboard (wallet connect, project list, policy editor, simulator).

Scaffold when you are ready:

```bash
cd apps
npm create vite@latest web -- --template react-ts
cd web
npm install @solana/web3.js @solana/wallet-adapter-base @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets
```

Point the client at program id `BYZFRa7NzDB7bKwxxkntewHfWwjBBqM6nsfrVeakBHjV` (or your rotated id) and load `idl/creator_treasury.json` with `@coral-xyz/anchor`.
