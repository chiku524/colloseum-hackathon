export const STRONGHOLD_DASHBOARD_TOUR_KEY = 'web3stronghold-dashboard-tour-v1';

export type DashboardTourPayloadV1 = {
  v: 1;
  /** User finished or skipped the guided tour */
  completed: boolean;
};

export function readDashboardTour(): DashboardTourPayloadV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STRONGHOLD_DASHBOARD_TOUR_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as DashboardTourPayloadV1;
    if (o.v !== 1) return null;
    return o;
  } catch {
    return null;
  }
}

export function writeDashboardTour(p: Omit<DashboardTourPayloadV1, 'v'> & { v?: 1 }): void {
  const full: DashboardTourPayloadV1 = {
    v: 1,
    completed: p.completed,
  };
  try {
    window.localStorage.setItem(STRONGHOLD_DASHBOARD_TOUR_KEY, JSON.stringify(full));
  } catch {
    /* ignore */
  }
}

/** Clears completion so the tour can auto-open on sign-in again until the user finishes or skips. */
export function clearDashboardTourStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STRONGHOLD_DASHBOARD_TOUR_KEY);
  } catch {
    /* ignore */
  }
}
