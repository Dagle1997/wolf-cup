import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4000,   // 4 seconds — leaderboard stays fresh
      gcTime: 300000,    // 5 minutes — cache cleanup
      retry: 1,
    },
  },
});
