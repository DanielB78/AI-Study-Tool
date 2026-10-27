import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_USER_LAYOUT_SETTINGS,
  getUserLayoutSettings,
  normalizeUserLayoutSettings,
  resetUserLayoutSettings,
  setUserLayoutSettings,
  setUserLayoutSettingsForTests,
} from '../userLayoutSettings';

const KEY = 'ai-study-tool:user-layout-settings:v1';

function installMemoryLocalStorage() {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
  });
  return store;
}

describe('userLayoutSettings persistence', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    setUserLayoutSettingsForTests({ ...DEFAULT_USER_LAYOUT_SETTINGS });
  });
  afterEach(() => {
    setUserLayoutSettingsForTests({ ...DEFAULT_USER_LAYOUT_SETTINGS });
  });

  it('Test K — persists direction and both limits across reload', () => {
    setUserLayoutSettings({
      chronologicalDirection: 'sideways',
      maxColumnHeight: 600,
      maxRowWidth: 900,
    });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      chronologicalDirection: 'sideways',
      maxColumnHeight: 600,
      maxRowWidth: 900,
    });

    // Simulate reload from storage.
    setUserLayoutSettingsForTests(null);
    expect(getUserLayoutSettings()).toEqual({
      chronologicalDirection: 'sideways',
      maxColumnHeight: 600,
      maxRowWidth: 900,
    });
  });

  it('Test K — No limit toggles independently', () => {
    setUserLayoutSettings({ maxColumnHeight: 500, maxRowWidth: 800 });
    setUserLayoutSettings({ maxColumnHeight: null });
    expect(getUserLayoutSettings().maxColumnHeight).toBeNull();
    expect(getUserLayoutSettings().maxRowWidth).toBe(800);

    setUserLayoutSettings({ maxRowWidth: null });
    expect(getUserLayoutSettings().maxRowWidth).toBeNull();
    expect(getUserLayoutSettings().chronologicalDirection).toBe('down');
  });

  it('reset restores defaults', () => {
    setUserLayoutSettings({ chronologicalDirection: 'sideways', maxRowWidth: 400 });
    resetUserLayoutSettings();
    expect(getUserLayoutSettings()).toEqual(DEFAULT_USER_LAYOUT_SETTINGS);
  });

  it('normalize rejects invalid limits', () => {
    expect(
      normalizeUserLayoutSettings({
        chronologicalDirection: 'down',
        maxColumnHeight: -1,
        maxRowWidth: Number.NaN,
      }),
    ).toEqual(DEFAULT_USER_LAYOUT_SETTINGS);
  });
});
