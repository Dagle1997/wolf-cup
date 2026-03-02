import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/admin')({
  component: () => (
    <div>
      <div className="bg-amber-50 border-b px-4 py-2 text-sm text-amber-800">
        <Link to="/admin" className="hover:underline underline-offset-2">
          Admin Panel
        </Link>
      </div>
      <Outlet />
    </div>
  ),
});
