import { describe, it, expect, vi } from 'vitest';

// autostart imports electron's `app` for isPackaged; none of that runs here.
vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { quoteExecPath } from '../autostart';

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
