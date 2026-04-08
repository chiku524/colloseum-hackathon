import { BRAND_NAME } from './brand';
import { UxIconOverview, UxIconPolicy } from './UxVisual';

type SharedViewBannerProps = {
  variant: 'status' | 'simulate';
};

/** Shown on read-only shared views (?view=status | simulate) with a path back to the full app. */
export function SharedViewBanner({ variant }: SharedViewBannerProps) {
  const mainHref =
    typeof window !== 'undefined' ? `${window.location.pathname}${window.location.hash || ''}` : '/';

  const title =
    variant === 'status' ? 'Shared read-only treasury view' : 'Shared payout calculator (no wallet)';

  return (
    <div className="shared-view-banner" role="region" aria-label="Shared link notice">
      <div className="shared-view-banner__lead">
        <div className="shared-view-banner__icon" aria-hidden>
          {variant === 'status' ? <UxIconOverview /> : <UxIconPolicy />}
        </div>
        <div className="shared-view-banner__text">
          <strong>{title}</strong>
          <span className="shared-view-banner__sub muted">
            {variant === 'status'
              ? `Anyone with this link can see public data from ${BRAND_NAME}.`
              : `Rules are loaded from the link only — not saved on-chain.`}{' '}
            Open the full app to connect a wallet and manage your team vault.
          </span>
        </div>
      </div>
      <a className="shared-view-banner__cta" href={mainHref}>
        Open full app
      </a>
    </div>
  );
}
