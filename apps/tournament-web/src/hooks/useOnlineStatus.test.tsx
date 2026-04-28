import { renderHook, act } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { useOnlineStatus } from './useOnlineStatus.js';

describe('useOnlineStatus', () => {
  test('initial true → flips to false on offline event → flips back on online event', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });
});
