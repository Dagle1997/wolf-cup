/**
 * T7-6 ambient typing for the PWA install-prompt event + the
 * `window.__deferredInstallPrompt` capture slot. Browsers without the
 * `beforeinstallprompt` event leave the slot permanently undefined.
 *
 * The event is non-standard (Chromium-only, but standardized in some specs);
 * Firefox / Safari do not implement it.
 */

export {};

declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
      outcome: 'accepted' | 'dismissed';
      platform: string;
    }>;
    prompt(): Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }

  interface Window {
    __deferredInstallPrompt?: BeforeInstallPromptEvent | undefined;
  }
}
