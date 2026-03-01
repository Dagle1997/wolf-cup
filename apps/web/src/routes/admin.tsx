import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/admin')({
  component: () => (
    <div>
      <div className="bg-amber-50 border-b px-4 py-2 text-sm text-amber-800">
        Admin Panel
      </div>
      <Outlet />
    </div>
  ),
});
