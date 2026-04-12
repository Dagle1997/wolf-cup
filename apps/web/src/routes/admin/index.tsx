import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, CalendarDays, Trophy, FilePenLine, KeyRound, LogOut, Loader2, Check, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

type Season = { id: number; name: string; year: number; startDate: string; endDate: string };
type Week = { id: number; weekNumber: number; friday: string; isActive: number; tee: string | null };
type SideGame = { id: number; name: string; scheduledFridays: string[] };
type Round = { id: number; scheduledDate: string; status: string; entryCode: string | null; tee: string | null };

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatFriday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function ThisWeekCard() {
  const today = todayIso();

  const seasonsQ = useQuery({
    queryKey: ['admin-seasons'],
    queryFn: () => apiFetch<{ items: Season[] }>('/admin/seasons'),
    retry: false,
  });

  const season = (seasonsQ.data?.items ?? []).find(
    (s) => s.startDate <= today && today <= s.endDate,
  ) ?? (seasonsQ.data?.items ?? []).slice().sort((a, b) => b.year - a.year)[0];

  const weeksQ = useQuery({
    queryKey: ['admin-season-weeks', season?.id],
    queryFn: () =>
      apiFetch<{ items: Week[] }>(`/admin/seasons/${season!.id}/weeks`),
    enabled: !!season,
    retry: false,
  });

  const gamesQ = useQuery({
    queryKey: ['admin-side-games', season?.id],
    queryFn: () =>
      apiFetch<{ items: SideGame[] }>(`/admin/seasons/${season!.id}/side-games`),
    enabled: !!season,
    retry: false,
  });

  const roundsQ = useQuery({
    queryKey: ['admin-rounds'],
    queryFn: () => apiFetch<{ items: Round[] }>(`/admin/rounds`),
    enabled: !!season,
    retry: false,
  });

  if (!season) return null;

  const activeWeeks = (weeksQ.data?.items ?? []).filter((w) => w.isActive === 1);
  const upcoming =
    activeWeeks.find((w) => w.friday >= today) ?? activeWeeks[activeWeeks.length - 1];

  if (!upcoming) return null;

  const game = (gamesQ.data?.items ?? []).find((g) =>
    (g.scheduledFridays ?? []).includes(upcoming.friday),
  );
  const round = (roundsQ.data?.items ?? []).find((r) => r.scheduledDate === upcoming.friday);

  return (
    <Link to="/attendance">
      <div className="border-2 border-primary/40 rounded-xl p-4 flex items-center gap-4 hover:bg-muted/50 transition-colors bg-primary/5">
        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
          <CalendarClock className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium">This Week — {formatFriday(upcoming.friday)}</p>
            {upcoming.tee && (
              <span className="text-[10px] uppercase tracking-wide rounded bg-muted px-1.5 py-0.5">
                {upcoming.tee}
              </span>
            )}
            {game && (
              <span className="text-[10px] uppercase tracking-wide rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 px-1.5 py-0.5">
                {game.name}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {round
              ? `Round ${round.status}${round.entryCode ? ` — code ${round.entryCode}` : ''}`
              : 'No round yet — open attendance to set the field'}
          </p>
        </div>
      </div>
    </Link>
  );
}

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

function ChangePasswordSection() {
  const [open, setOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) { setErrorMsg('Passwords do not match'); setStatus('error'); return; }
    if (newPw.length < 4) { setErrorMsg('Password must be at least 4 characters'); setStatus('error'); return; }
    setStatus('loading');
    setErrorMsg('');
    try {
      await apiFetch('/admin/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      setStatus('success');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setTimeout(() => { setStatus('idle'); setOpen(false); }, 2000);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error && err.message === 'INVALID_CREDENTIALS' ? 'Current password is incorrect' : 'Failed to change password');
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="border rounded-xl p-4 flex items-center gap-4 hover:bg-muted/50 transition-colors w-full text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <KeyRound className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="font-medium">Change Password</p>
          <p className="text-sm text-muted-foreground">Update your admin login password</p>
        </div>
      </button>
    );
  }

  return (
    <div className="border rounded-xl p-4">
      <p className="font-medium mb-3">Change Password</p>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-2">
        <input type="password" placeholder="Current password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-background" required />
        <input type="password" placeholder="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-background" required />
        <input type="password" placeholder="Confirm new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-background" required />
        {status === 'error' && <p className="text-xs text-destructive">{errorMsg}</p>}
        {status === 'success' && <p className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Password changed</p>}
        <div className="flex gap-2 mt-1">
          <Button type="submit" size="sm" disabled={status === 'loading'}>
            {status === 'loading' ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Saving...</> : 'Save'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { setOpen(false); setStatus('idle'); }}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

function LogoutButton() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await apiFetch('/admin/auth/logout', { method: 'POST' });
    } catch {
      // Even if the server call fails, clear local session
    }
    void navigate({ to: '/admin/login' });
  }

  return (
    <button
      onClick={() => void handleLogout()}
      disabled={loading}
      className="border rounded-xl p-4 flex items-center gap-4 hover:bg-muted/50 transition-colors w-full text-left"
    >
      <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
        <LogOut className="w-5 h-5 text-destructive" />
      </div>
      <div>
        <p className="font-medium">Logout</p>
        <p className="text-sm text-muted-foreground">Sign out of the admin dashboard</p>
      </div>
    </button>
  );
}

function AdminDashboard() {
  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Admin Dashboard</h2>
      <ThisWeekCard />
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
        <ChangePasswordSection />
        <LogoutButton />
      </div>
    </div>
  );
}
