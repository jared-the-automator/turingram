import { describe, it, expect, vi } from 'vitest';
import { alertMeeting, clearAttention, type AlertWindow, type AlertDeps } from '../meetingAlert';

const CANDIDATE = { app: 'Zoom', title: 'Zoom Workplace' };

// A stand-in for the BrowserWindow, recording every call the alert path makes.
function fakeWindow(state: Partial<{ visible: boolean; focused: boolean; minimized: boolean; destroyed: boolean }> = {}) {
  const s = { visible: false, focused: false, minimized: false, destroyed: false, ...state };
  const calls: string[] = [];
  const win: AlertWindow = {
    isDestroyed: () => s.destroyed,
    isVisible: () => s.visible,
    isFocused: () => s.focused,
    isMinimized: () => s.minimized,
    restore: () => { calls.push('restore'); s.minimized = false; },
    show: () => { calls.push('show'); s.visible = true; },
    showInactive: () => { calls.push('showInactive'); s.visible = true; },
    setAlwaysOnTop: (f: boolean) => { calls.push(`alwaysOnTop:${f}`); },
    flashFrame: (f: boolean) => { calls.push(`flash:${f}`); },
    webContents: { send: (ch: string) => { calls.push(`send:${ch}`); } },
  };
  return { win, calls, state: s };
}

function deps(win: AlertWindow | null, over: Partial<AlertDeps> = {}): AlertDeps {
  return {
    getWindow: () => win,
    notify: vi.fn(),
    openWindow: vi.fn(),
    isWayland: false,
    ...over,
  };
}

describe('alertMeeting', () => {
  it('always hands the toast to the renderer, even while hidden', () => {
    const { win, calls } = fakeWindow({ visible: false });
    alertMeeting(deps(win), CANDIDATE);
    expect(calls).toContain('send:meeting:detected');
  });

  // The bug: a hidden window meant the toast rendered where nobody could see it,
  // and the only other channel was a desktop notification the notification daemon
  // is free to swallow. The window itself has to come up.
  it('surfaces the window when it is hidden in the tray', () => {
    const { win, calls } = fakeWindow({ visible: false });
    alertMeeting(deps(win), CANDIDATE);
    expect(calls).toContain('showInactive');
  });

  it('surfaces without stealing focus from the call in progress', () => {
    const { win, calls } = fakeWindow({ visible: false });
    alertMeeting(deps(win), CANDIDATE);
    expect(calls).toContain('showInactive');
    expect(calls).not.toContain('show');
  });

  it('raises above the call window and flashes for attention', () => {
    const { win, calls } = fakeWindow({ visible: false });
    alertMeeting(deps(win), CANDIDATE);
    expect(calls).toContain('alwaysOnTop:true');
    expect(calls).toContain('flash:true');
  });

  // A visible-but-buried window is the same failure as a hidden one: during a
  // fullscreen call the toast is behind the call.
  it('raises a window that is open but buried under the call', () => {
    const { win, calls } = fakeWindow({ visible: true, focused: false });
    alertMeeting(deps(win), CANDIDATE);
    expect(calls).toContain('alwaysOnTop:true');
    expect(calls).toContain('flash:true');
  });

  it('leaves an already-focused window alone — the toast is on screen', () => {
    const { win, calls } = fakeWindow({ visible: true, focused: true });
    const d = deps(win);
    alertMeeting(d, CANDIDATE);
    expect(calls).toEqual(['send:meeting:detected']);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('restores a minimized window before raising it', () => {
    const { win, calls } = fakeWindow({ visible: true, focused: false, minimized: true });
    alertMeeting(deps(win), CANDIDATE);
    expect(calls).toContain('restore');
  });

  it('falls back to show() on Wayland, where showInactive is unsupported', () => {
    const { win, calls } = fakeWindow({ visible: false });
    alertMeeting(deps(win, { isWayland: true }), CANDIDATE);
    expect(calls).toContain('show');
    expect(calls).not.toContain('showInactive');
  });

  it('still raises a desktop notification as a second channel', () => {
    const { win } = fakeWindow({ visible: false });
    const d = deps(win);
    alertMeeting(d, CANDIDATE);
    expect(d.notify).toHaveBeenCalledOnce();
    expect(vi.mocked(d.notify).mock.calls[0][0]).toMatchObject({
      title: "You're in a Zoom call",
    });
  });

  it('survives having no window at all', () => {
    const d = deps(null);
    expect(() => alertMeeting(d, CANDIDATE)).not.toThrow();
    expect(d.notify).toHaveBeenCalledOnce();
  });

  it('survives a destroyed window', () => {
    const { win } = fakeWindow({ destroyed: true });
    const d = deps(win);
    expect(() => alertMeeting(d, CANDIDATE)).not.toThrow();
    expect(d.notify).toHaveBeenCalledOnce();
  });
});

describe('clearAttention', () => {
  it('drops always-on-top and the flash once the user has seen it', () => {
    const { win, calls } = fakeWindow({ visible: true, focused: true });
    clearAttention(win);
    expect(calls).toEqual(['alwaysOnTop:false', 'flash:false']);
  });

  it('is a no-op on a destroyed window', () => {
    const { win, calls } = fakeWindow({ destroyed: true });
    clearAttention(win);
    expect(calls).toEqual([]);
  });
});
