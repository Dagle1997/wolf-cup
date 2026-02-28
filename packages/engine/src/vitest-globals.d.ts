// Augments ImportMeta with Vitest/Vite's import.meta.glob for test files.
// This avoids a @types/node or vite/client dependency while keeping tsc happy.
interface ImportMeta {
  url: string;
  glob<M>(pattern: string, options: { eager: true }): Record<string, M>;
  glob<M>(pattern: string, options?: { eager?: false }): Record<string, () => Promise<M>>;
}
