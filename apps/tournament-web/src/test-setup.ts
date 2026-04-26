// Vitest setup file (T2-3b). Loaded once per test process (pre-test) so
// every test gets the @testing-library/jest-dom matchers + auto-cleanup
// of rendered components without per-file imports.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Auto-unmount any components rendered with @testing-library/react after
// each test. Without this, mounted React trees leak across tests in the
// same file — `screen.getByRole('button', {...})` then matches buttons
// from prior renders, breaking selectors.
afterEach(() => {
  cleanup();
});
