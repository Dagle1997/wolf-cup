import { describe, test, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryClient } from './query-client';

describe('queryClient', () => {
  test('is a QueryClient instance with configured defaults', () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
    const defaults = queryClient.getDefaultOptions().queries;
    expect(defaults?.staleTime).toBe(4000);
    expect(defaults?.gcTime).toBe(300000);
    expect(defaults?.retry).toBe(1);
  });
});
