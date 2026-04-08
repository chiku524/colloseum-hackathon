export const STRONGHOLD_ONBOARDING_KEY = 'stronghold-onboarding-v1';

export type OnboardingPayloadV1 = {
  v: 1;
  complete: boolean;
  projectName: string;
  projectId: string;
  approversText: string;
  threshold: string;
};

export function readOnboarding(): OnboardingPayloadV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STRONGHOLD_ONBOARDING_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as OnboardingPayloadV1;
    if (o.v !== 1) return null;
    return o;
  } catch {
    return null;
  }
}

export function writeOnboarding(p: Omit<OnboardingPayloadV1, 'v'> & { v?: 1 }): void {
  const full: OnboardingPayloadV1 = {
    v: 1,
    complete: p.complete,
    projectName: p.projectName,
    projectId: p.projectId,
    approversText: p.approversText,
    threshold: p.threshold,
  };
  try {
    window.localStorage.setItem(STRONGHOLD_ONBOARDING_KEY, JSON.stringify(full));
  } catch {
    /* ignore */
  }
}

export function dispatchOnboardingApplied(detail: OnboardingPayloadV1): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('stronghold-onboarding-applied', { detail }));
}
