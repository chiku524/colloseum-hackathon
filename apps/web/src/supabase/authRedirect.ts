/**
 * Base URL for Supabase email links (confirm signup, magic link, password reset).
 * Must appear in Supabase → Authentication → URL configuration → Redirect URLs.
 *
 * Set `VITE_AUTH_EMAIL_REDIRECT_ORIGIN` on Vercel (e.g. https://www.web3stronghold.app)
 * so confirmation emails use your production domain even if users register from a
 * preview URL or alternate hostname.
 */
export function getAuthEmailRedirectUrl(): string {
  const explicit = import.meta.env.VITE_AUTH_EMAIL_REDIRECT_ORIGIN?.trim();
  if (explicit) {
    const base = explicit.replace(/\/+$/, '');
    return `${base}/`;
  }
  if (typeof window === 'undefined') return '/';
  return `${window.location.origin}/`;
}
