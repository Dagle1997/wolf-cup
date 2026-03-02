import { createFileRoute, useNavigate, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  return (
    <div>
      <div className="bg-amber-50 border-b px-4 py-2 text-sm text-amber-800">
        <button
          className="hover:underline underline-offset-2 cursor-pointer"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={() => void navigate({ to: '/admin/' as any })}
        >
          Admin Panel
        </button>
      </div>
      <Outlet />
    </div>
  );
}
