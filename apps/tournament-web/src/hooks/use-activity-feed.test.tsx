import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useActivityFeed, useActivityStream } from './use-activity-feed';

afterEach(() => cleanup());

describe('useActivityFeed', () => {
  it('throws when called outside ActivityFeedProvider', () => {
    expect(() => {
      renderHook(() => useActivityFeed());
    }).toThrow(/must be within ActivityFeedProvider/);
  });
});

describe('useActivityStream', () => {
  it('throws when called outside ActivityFeedProvider', () => {
    expect(() => {
      renderHook(() => useActivityStream(() => undefined));
    }).toThrow(/must be within ActivityFeedProvider/);
  });
});
