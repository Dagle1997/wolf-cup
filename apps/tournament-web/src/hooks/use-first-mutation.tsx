/**
 * T7-6 first-mutation flag — session-scoped React Context that flips to
 * `true` the first time any mutation site calls `markMutation()`. The
 * `<InstallPrompt>` component reads this flag as the "first-commit
 * dopamine hit" trigger.
 *
 * State is held in memory only (resets on hard reload). The persistent
 * suppression invariant lives on the server via
 * `device_bindings.install_prompt_shown_at`.
 *
 * Pattern: provider wraps the route tree at __root.tsx. Mutation sites
 * (score-entry, gallery upload) call `useMarkMutation()` and invoke it in
 * their mutation `onSuccess` callbacks.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

type FirstMutationContextValue = {
  flag: boolean;
  markMutation: () => void;
};

// Default context value — `flag: false` and a no-op `markMutation`. This
// matches the "no provider" case so components used outside the provider
// behave as if no mutation has happened (safe fallback).
const FirstMutationContext = createContext<FirstMutationContextValue>({
  flag: false,
  markMutation: () => {},
});

export function FirstMutationProvider({ children }: { children: ReactNode }) {
  const [flag, setFlag] = useState(false);
  const markMutation = useCallback(() => {
    // Cheap idempotency: only re-render once. Subsequent calls are no-ops
    // because `setFlag(true)` on a state already === true skips the
    // re-render in React.
    setFlag(true);
  }, []);
  return (
    <FirstMutationContext.Provider value={{ flag, markMutation }}>
      {children}
    </FirstMutationContext.Provider>
  );
}

export function useFirstMutationFlag(): boolean {
  return useContext(FirstMutationContext).flag;
}

export function useMarkMutation(): () => void {
  return useContext(FirstMutationContext).markMutation;
}
