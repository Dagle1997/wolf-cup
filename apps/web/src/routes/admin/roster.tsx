import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/roster')({
  component: () => (
    <div className="p-4">
      <h2 className="text-xl font-semibold">Roster</h2>
      <p className="text-muted-foreground mt-1">Coming soon.</p>
    </div>
  ),
});
