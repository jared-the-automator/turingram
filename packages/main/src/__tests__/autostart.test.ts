import { describe, it, expect, vi, afterEach } from 'vitest';

const app = vi.hoisted(() => ({
  isPackaged: false,
  setLoginItemSettings: (() => { /* replaced per test */ }) as (s: unknown) => void,
  getLoginItemSettings: () => ({ openAtLogin: false }),
}));
vi.mock('electron', () => ({ app }));

import { quoteExecPath, setAutostart } from '../autostart';

// Exec= lines follow the desktop-entry quoting rules, not shell rules. This
// bit for real once already: an autostart entry with a stale unquoted path is
// exactly how "the tray icon is broken" presented in July.
describe('quoteExecPath', () => {
  it('leaves a plain absolute path alone', () => {
    expect(quoteExecPath('/opt/Turingram/turingram-workspace'))
      .toBe('/opt/Turingram/turingram-workspace');
  });

  it('quotes a path containing spaces', () => {
    expect(quoteExecPath('/home/j/My Apps/Turingram.AppImage'))
      .toBe('"/home/j/My Apps/Turingram.AppImage"');
  });

  it('escapes the characters the spec reserves inside quotes', () => {
    expect(quoteExecPath('/tmp/a"b$c`d\\e'))
      .toBe('"/tmp/a\\"b\\$c\\`d\\\\e"');
  });
});

describe('setAutostart on macOS and Windows', () => {
  const realPlatform = process.platform;
  const on = (platform: string) => Object.defineProperty(process, 'platform', { value: platform });
  afterEach(() => { on(realPlatform); app.isPackaged = false; });

  it('registers a login item that starts hidden', () => {
    on('win32');
    app.isPackaged = true;
    const set = vi.fn();
    app.setLoginItemSettings = set;
    expect(setAutostart(true)).toBe(true);
    expect(set).toHaveBeenCalledWith({ openAtLogin: true, args: ['--hidden'] });
  });

  it('never registers an unpackaged run', () => {
    on('darwin');
    const set = vi.fn();
    app.setLoginItemSettings = set;
    expect(setAutostart(true)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
