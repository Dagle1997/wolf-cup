import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Users, CalendarDays, Trophy, FilePenLine, KeyRound, LogOut, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

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
