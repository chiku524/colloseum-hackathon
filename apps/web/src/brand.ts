/** Public product name, URLs, and copy used for UI + SEO. On-chain program / widget protocol IDs stay unchanged elsewhere. */
export const BRAND_NAME = 'web3stronghold';

/** Production site (Vercel). Swap when you add a custom domain. */
export const SITE_CANONICAL_ORIGIN = 'https://web3stronghold.app';

export const SITE_CANONICAL_URL = `${SITE_CANONICAL_ORIGIN}/`;

/** Public GitHub repository (source, issues, PRs). */
export const GITHUB_REPO_URL = 'https://github.com/chiku524/web3stronghold';

export const BRAND_DESCRIPTION =
  'web3stronghold: secure team escrow on Solana — policy templates, multi-approver releases, artifacts, and disputes. Lock down, govern, and audit your creator treasury.';

export const BRAND_TAGLINE =
  'Secure team escrow vault — policy templates, multi-approver releases, artifacts, and disputes — on Solana.';

/** Browser tab titles by entry route */
export const DOCUMENT_TITLES = {
  main: `${BRAND_NAME} — Secure creator treasury on Solana`,
  status: `Public treasury status — ${BRAND_NAME}`,
  simulate: `Payout “what if” calculator — ${BRAND_NAME}`,
  docs: `Documentation — ${BRAND_NAME}`,
} as const;
