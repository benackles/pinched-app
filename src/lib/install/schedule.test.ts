import { describe, expect, it } from "vitest";

import {
  afterDismiss,
  afterInstall,
  EMPTY_INSTALL_STATE,
  isIosDevice,
  parseInstallState,
  shouldAskToInstall,
} from "./schedule";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 1);

describe("shouldAskToInstall", () => {
  it("asks the first time, in a browser tab", () => {
    expect(shouldAskToInstall(EMPTY_INSTALL_STATE, { standalone: false, now: NOW })).toBe(true);
  });

  it("never asks inside the installed app or after installing", () => {
    expect(shouldAskToInstall(EMPTY_INSTALL_STATE, { standalone: true, now: NOW })).toBe(false);
    expect(
      shouldAskToInstall(afterInstall(EMPTY_INSTALL_STATE), { standalone: false, now: NOW }),
    ).toBe(false);
  });

  it("re-asks once, seven days after a dismissal — and not before", () => {
    const dismissed = afterDismiss(EMPTY_INSTALL_STATE, NOW);
    expect(shouldAskToInstall(dismissed, { standalone: false, now: NOW + 6 * DAY })).toBe(false);
    expect(shouldAskToInstall(dismissed, { standalone: false, now: NOW + 7 * DAY })).toBe(true);
  });

  it("stops after the second dismissal", () => {
    const twice = afterDismiss(afterDismiss(EMPTY_INSTALL_STATE, NOW), NOW + 8 * DAY);
    expect(shouldAskToInstall(twice, { standalone: false, now: NOW + 365 * DAY })).toBe(false);
  });
});

describe("parseInstallState", () => {
  it("tolerates missing, corrupt and hostile storage", () => {
    expect(parseInstallState(null)).toEqual(EMPTY_INSTALL_STATE);
    expect(parseInstallState("not json")).toEqual(EMPTY_INSTALL_STATE);
    expect(parseInstallState('{"dismissedAt":"x","installed":"yes"}')).toEqual(EMPTY_INSTALL_STATE);
    expect(parseInstallState('{"dismissedAt":[1,2,3,4],"installed":true}')).toEqual({
      dismissedAt: [3, 4],
      installed: true,
    });
  });
});

describe("isIosDevice", () => {
  it("recognises iPhone, iPad and iPadOS that reports as a Mac", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "iPhone", 5)).toBe(
      true,
    );
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(
      true,
    );
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(
      false,
    );
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5)).toBe(false);
  });
});
