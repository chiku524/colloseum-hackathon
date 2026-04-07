/** Public product name, URLs, and copy used for UI + SEO. Program / widget protocol IDs stay unchanged elsewhere. */
export const BRAND_NAME = 'Stronghold';

/** Production site (Vercel). Swap when you add a custom domain. */
export const SITE_CANONICAL_ORIGIN = 'https://colloseum-hackathon.vercel.app';

export const SITE_CANONICAL_URL = `${SITE_CANONICAL_ORIGIN}/`;

export const BRAND_DESCRIPTION =
  'Stronghold: secure team escrow on Solana — policy templates, multi-approver releases, artifacts, and disputes. A creator treasury you can lock down, govern, and audit.';

export const BRAND_TAGLINE =
  'Secure team escrow vault — policy templates, multi-approver releases, artifacts, and disputes — on Solana.';

/** Browser tab titles by entry route */
export const DOCUMENT_TITLES = {
  main: `${BRAND_NAME} — Secure creator treasury on Solana`,
  status: `Public treasury status — ${BRAND_NAME}`,
  simulate: `Payout “what if” calculator — ${BRAND_NAME}`,
} as const;
