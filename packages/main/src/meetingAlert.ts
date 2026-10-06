import type { MeetingCandidate } from './meetingDetector';

// Getting the record prompt in front of someone who is *already in a call* is the
// whole product promise, and it is harder than it looks. The window is normally
// hidden in the tray, so the in-app toast renders where nobody can see it. The
// obvious second channel — a desktop notification — turns out to be unreliable by
// design: on Cinnamon it is gated behind `display-notifications` (a global toggle
// the user can switch off), suppressed over fullscreen windows unless
// `fullscreen-notifications` is on, and lives for `notification-duration` seconds
// (4 by default). Every one of those defaults conspires against the exact moment
// we need to reach the user. So the window itself has to come up; the notification
// is now a bonus, not the mechanism.
//
// Coming up must not steal focus — grabbing the keyboard mid-call would be worse
// than the bug. `showInactive()` maps the window without focusing it, always-on-top
// gets it above the fullscreen call, and the frame flash marks it in the window
// list. `clearAttention` undoes the last two once the user has actually looked.

// The slice of BrowserWindow this module touches, named so it can be faked in tests.
export interface AlertWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  showInactive(): void
  setAlwaysOnTop(flag: boolean): void
  flashFrame(flag: boolean): void
  webContents: { send(channel: string, payload: unknown): void }
}

export interface AlertDeps {
  getWindow(): AlertWindow | null
  notify(opts: { title: string; body: string; onClick: () => void }): void
  /** Called when the user clicks the desktop notification. */
  openWindow(): void
  /** showInactive() is a no-op on Wayland, so fall back to show() there. */
  isWayland: boolean
}

function live(win: AlertWindow | null): win is AlertWindow {
  return win !== null && !win.isDestroyed();
}

/**
 * Bring a hidden or buried window to the user's attention without taking focus.
 *
 * Shared rather than inlined because the record prompt is no longer the only
 * thing that has to reach someone who is looking at a call and not at us: a
 * capture that dies has to say so at the moment it dies, and this machine's
 * notification channel is switched off (see the header above), so the window
 * coming up IS the message. Two copies of that would drift.
 */
export function raiseWindow(win: AlertWindow | null, isWayland: boolean): void {
  if (!live(win)) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) {
    if (isWayland) win.show(); else win.showInactive();
  }
  win.setAlwaysOnTop(true);
  win.flashFrame(true);
}

export function alertMeeting(deps: AlertDeps, c: MeetingCandidate): void {
  const win = deps.getWindow();

  // The toast is the actual prompt — send it regardless of what the window is
  // doing, so it is already waiting whenever the window does come up.
  if (live(win)) win.webContents.send('meeting:detected', c);

  // A focused window already has the toast on screen. Anything else — hidden in
  // the tray, or open but buried under a fullscreen call — is invisible to the
  // user and needs raising.
  if (live(win) && win.isVisible() && win.isFocused()) return;

  raiseWindow(win, deps.isWayland);

  deps.notify({
    title: `You're in a ${c.app} call`,
    body: `${c.title} — click to record it`,
    onClick: () => deps.openWindow(),
  });
}

/** Drop the attention-grabbing state once the user has seen the prompt. */
export function clearAttention(win: AlertWindow | null): void {
  if (!live(win)) return;
  win.setAlwaysOnTop(false);
  win.flashFrame(false);
}
