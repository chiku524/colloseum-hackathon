/** Public product name, URLs, and copy used for UI + SEO. Program / widget protocol IDs stay unchanged elsewhere. */
export const BRAND_NAME = 'Lithos';

/** Production site (Vercel). Swap when you add a custom domain. */
export const SITE_CANONICAL_ORIGIN = 'https://colloseum-hackathon.vercel.app';

export const SITE_CANONICAL_URL = `${SITE_CANONICAL_ORIGIN}/`;

export const BRAND_DESCRIPTION =
  'Team escrow vaults, policy templates, multi-approver releases, artifacts, and disputes on Solana — a creator treasury you can govern and audit.';

export const BRAND_TAGLINE =
  'Team escrow vault, policy templates, multi-approver releases, artifacts, and disputes — on Solana.';

/** Browser tab titles by entry route */
export const DOCUMENT_TITLES = {
  main: `${BRAND_NAME} — Creator treasury on Solana`,
  status: `Public treasury status — ${BRAND_NAME}`,
  simulate: `Policy payout simulator — ${BRAND_NAME}`,
} as const;
