import { createFileRoute, Link } from '@tanstack/react-router';
import { Users, CalendarDays, Trophy, FilePenLine } from 'lucide-react';

export const Route = createFileRoute('/admin/')({
  component: AdminDashboard,
});

const NAV_CARDS = [
  {
    to: '/admin/roster' as const,
    icon: Users,
    title: 'Roster',
    description: 'Manage league players and handicap indexes',
  },
  {
    to: '/admin/rounds' as const,
    icon: CalendarDays,
    title: 'Rounds',
    description: 'Schedule rounds, set groups, and finalize scores',
  },
  {
    to: '/admin/season' as const,
    icon: Trophy,
    title: 'Season',
    description: 'Configure season settings and playoff format',
  },
  {
    to: '/admin/score-corrections' as const,
    icon: FilePenLine,
    title: 'Score Corrections',
    description: 'Edit finalized round scores with full audit trail',
  },
];

function AdminDashboard() {
  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Admin Dashboard</h2>
      <div className="flex flex-col gap-3">
        {NAV_CARDS.map(({ to, icon: Icon, title, description }) => (
          <Link key={to} to={to}>
            <div className="border rounded-xl p-4 flex items-center gap-4 hover:bg-muted/50 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
