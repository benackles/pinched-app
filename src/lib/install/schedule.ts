/**
 * When to offer "install Pinched" (PRD → Install and push): after the first grocery list or prep
 * plan, tied to a benefit, and re-asked at most once, seven days later. Pure, so it is unit-tested.
 */
export type InstallState = {
  /** When each ask was dismissed (epoch ms). */
  dismissedAt: number[];
  installed: boolean;
};

export const EMPTY_INSTALL_STATE: InstallState = { dismissedAt: [], installed: false };

const DAY = 86_400_000;
export const REASK_AFTER_DAYS = 7;
export const MAX_ASKS = 2;

export function shouldAskToInstall(
  state: InstallState,
  context: { standalone: boolean; now: number },
): boolean {
  if (context.standalone || state.installed) return false;
  if (state.dismissedAt.length === 0) return true;
  if (state.dismissedAt.length >= MAX_ASKS) return false;
  const last = state.dismissedAt[state.dismissedAt.length - 1]!;
  return context.now - last >= REASK_AFTER_DAYS * DAY;
}

export const afterDismiss = (state: InstallState, now: number): InstallState => ({
  ...state,
  dismissedAt: [...state.dismissedAt, now],
});

export const afterInstall = (state: InstallState): InstallState => ({ ...state, installed: true });

export function parseInstallState(raw: string | null): InstallState {
  if (!raw) return EMPTY_INSTALL_STATE;
  try {
    const value = JSON.parse(raw) as Partial<InstallState>;
    return {
      dismissedAt: Array.isArray(value.dismissedAt)
        ? value.dismissedAt.filter((n): n is number => typeof n === "number").slice(-MAX_ASKS)
        : [],
      installed: value.installed === true,
    };
  } catch {
    return EMPTY_INSTALL_STATE;
  }
}

/** iPhone, iPad and iPadOS-as-Mac — where there is no install prompt and the Share sheet is the way in. */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}
