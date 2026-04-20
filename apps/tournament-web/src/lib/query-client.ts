import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4000,
      gcTime: 300000,
      retry: 1,
    },
  },
});
