// @vitest-environment jsdom
//
// The web/native seam. On the web every function must be inert (the link is
// followed, nothing throws); inside the wrapper sign-in has to leave the web
// view, and the code that comes back has to be traded in the web view itself.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isNativeApp, signInPath, startNativeSignIn, listenForNativeSignIn, haptic } from './native';
import { legalDocForPath } from './legal';

type Win = Window & { Capacitor?: unknown };

function installBridge() {
  const listeners: Record<string, (data: { url?: string }) => void> = {};
  const plugins = {
    Browser: { open: vi.fn(async () => {}), close: vi.fn(async () => {}) },
    App: { addListener: vi.fn(async (event: string, cb: (data: { url?: string }) => void) => { listeners[event] = cb; }) },
    Haptics: { impact: vi.fn(async () => {}), notification: vi.fn(async () => {}) },
  };
  (window as Win).Capacitor = { isNativePlatform: () => true, Plugins: plugins };
  return { plugins, listeners };
}

beforeEach(() => { delete (window as Win).Capacitor; });

describe('on the web', () => {
  it('is not native, and sign-in is a plain link the browser follows', () => {
    expect(isNativeApp()).toBe(false);
    expect(signInPath('google')).toBe('/api/auth/google');
    expect(signInPath('apple')).toBe('/api/auth/apple');
    expect(startNativeSignIn('google')).toBe(false);
  });

  it('haptics and the URL listener do nothing rather than throw', () => {
    expect(() => { haptic('light'); haptic('success'); listenForNativeSignIn(); }).not.toThrow();
  });

  it('a Capacitor global that is not a native platform (the web build of a plugin) is still the web', () => {
    (window as Win).Capacitor = { isNativePlatform: () => false, Plugins: {} };
    expect(isNativeApp()).toBe(false);
    expect(signInPath('google')).toBe('/api/auth/google');
  });
});

describe('inside the native wrapper', () => {
  it('opens the provider in the system browser, flagged for the handoff', () => {
    const { plugins } = installBridge();
    expect(startNativeSignIn('apple')).toBe(true);
    const { url } = plugins.Browser.open.mock.calls[0][0 as never] as { url: string };
    expect(url).toBe(`${window.location.origin}/api/auth/apple?native=1`);
  });

  it('subscribes to the app being re-opened by URL', () => {
    const { plugins, listeners } = installBridge();
    listenForNativeSignIn();
    expect(plugins.App.addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));
    // URLs that are not the sign-in return are ignored (no throw, no close).
    listeners.appUrlOpen({ url: 'liftlog://something-else' });
    listeners.appUrlOpen({ url: 'not a url' });
    listeners.appUrlOpen({});
    expect(plugins.Browser.close).not.toHaveBeenCalled();
  });

  it('uses the Taptic Engine instead of the vibrate API iOS does not have', () => {
    const { plugins } = installBridge();
    haptic('light');
    haptic('success');
    expect(plugins.Haptics.impact).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(plugins.Haptics.notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
  });
});

describe('public pages', () => {
  it('resolves the three paths the worker serves the shell for, and nothing else', () => {
    expect(legalDocForPath('/privacy')).toBe('privacy');
    expect(legalDocForPath('/terms/')).toBe('terms');
    expect(legalDocForPath('/support')).toBe('support');
    expect(legalDocForPath('/')).toBeNull();
    expect(legalDocForPath('/privacy/extra')).toBeNull();
  });
});
