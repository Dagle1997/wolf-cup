/**
 * T7-6 InstallPrompt component tests. Covers AC-6 suppression + display
 * matrix and the single-invocation guard via useRef.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { InstallPrompt, isIosUserAgent } from './install-prompt';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function makeMockEvent(): BeforeInstallPromptEvent {
  return {
    platforms: ['web'],
    userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    prompt: vi.fn(async () => ({ outcome: 'accepted' as const, platform: 'web' })),
    preventDefault() {},
  } as unknown as BeforeInstallPromptEvent;
}

describe('isIosUserAgent', () => {
  it('matches iPhone / iPad / iPod', () => {
    expect(isIosUserAgent(IOS_UA)).toBe(true);
    expect(isIosUserAgent('iPad Safari')).toBe(true);
    expect(isIosUserAgent('iPod touch')).toBe(true);
  });

  it('does not match Android / desktop', () => {
    expect(isIosUserAgent(ANDROID_UA)).toBe(false);
    expect(isIosUserAgent('Mozilla/5.0 Chrome/120.0.0.0')).toBe(false);
  });
});

describe('InstallPrompt — suppression rules', () => {
  it('renders null when isStandalone === true', () => {
    const onShown = vi.fn();
    const { container } = render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={true}
        isStandalone={true}
        beforeInstallEvent={makeMockEvent()}
        userAgent={ANDROID_UA}
        onShown={onShown}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders null when installPromptShownAt is non-null', () => {
    const onShown = vi.fn();
    const { container } = render(
      <InstallPrompt
        installPromptShownAt={1234567890000}
        hasMutatedThisSession={true}
        isStandalone={false}
        beforeInstallEvent={makeMockEvent()}
        userAgent={ANDROID_UA}
        onShown={onShown}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders null when hasMutatedThisSession === false', () => {
    const onShown = vi.fn();
    const { container } = render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={false}
        isStandalone={false}
        beforeInstallEvent={makeMockEvent()}
        userAgent={ANDROID_UA}
        onShown={onShown}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('InstallPrompt — render shapes', () => {
  it('renders iOS instructions card on iOS UA without beforeInstallEvent', () => {
    const onShown = vi.fn();
    render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={true}
        isStandalone={false}
        beforeInstallEvent={null}
        userAgent={IOS_UA}
        onShown={onShown}
      />,
    );
    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('iOS dismiss button calls onShown exactly once', () => {
    const onShown = vi.fn();
    render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={true}
        isStandalone={false}
        beforeInstallEvent={null}
        userAgent={IOS_UA}
        onShown={onShown}
      />,
    );
    act(() => {
      screen.getByRole('button', { name: 'Got it' }).click();
      // Subsequent clicks (component still mounted) → no-op.
      screen.getByRole('button', { name: 'Got it' }).click();
    });
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('renders Android install button on Android UA with beforeInstallEvent', () => {
    const onShown = vi.fn();
    const ev = makeMockEvent();
    render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={true}
        isStandalone={false}
        beforeInstallEvent={ev}
        userAgent={ANDROID_UA}
        onShown={onShown}
      />,
    );
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
  });

  it('Android Install click calls beforeInstallEvent.prompt and onShown', async () => {
    const onShown = vi.fn();
    const ev = makeMockEvent();
    render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={true}
        isStandalone={false}
        beforeInstallEvent={ev}
        userAgent={ANDROID_UA}
        onShown={onShown}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: 'Install' }).click();
      // Let the async prompt settle.
      await Promise.resolve();
    });
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('renders null on unsupported platform (no event AND not iOS)', () => {
    const onShown = vi.fn();
    const { container } = render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={true}
        isStandalone={false}
        beforeInstallEvent={null}
        userAgent={ANDROID_UA}
        onShown={onShown}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('InstallPrompt — defense-in-depth onShown', () => {
  it('unmount before user interacts → onShown invoked exactly once', () => {
    const onShown = vi.fn();
    const { unmount } = render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={true}
        isStandalone={false}
        beforeInstallEvent={null}
        userAgent={IOS_UA}
        onShown={onShown}
      />,
    );
    expect(onShown).not.toHaveBeenCalled();
    unmount();
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('dismiss → unmount cleanup does NOT double-stamp', () => {
    const onShown = vi.fn();
    const { unmount } = render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={true}
        isStandalone={false}
        beforeInstallEvent={null}
        userAgent={IOS_UA}
        onShown={onShown}
      />,
    );
    act(() => {
      screen.getByRole('button', { name: 'Got it' }).click();
    });
    expect(onShown).toHaveBeenCalledTimes(1);
    unmount();
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('not rendered (suppressed) → unmount does NOT stamp', () => {
    const onShown = vi.fn();
    const { unmount } = render(
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={false}
        isStandalone={false}
        beforeInstallEvent={null}
        userAgent={IOS_UA}
        onShown={onShown}
      />,
    );
    unmount();
    expect(onShown).not.toHaveBeenCalled();
  });
});
