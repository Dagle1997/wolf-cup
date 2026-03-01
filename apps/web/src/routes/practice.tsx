import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { setSession } from '@/lib/session-store';

export const Route = createFileRoute('/practice')({
  component: PracticeSetupPage,
});

type PlayerInput = { name: string; handicapIndex: string };

type PracticeResponse = {
  roundId: number;
  groupId: number;
  players: { id: number; name: string; handicapIndex: number }[];
};

function PracticeSetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'count' | 'names'>('count');
  const [playerInputs, setPlayerInputs] = useState<PlayerInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleCountSelect(count: number) {
    setPlayerInputs(Array.from({ length: count }, () => ({ name: '', handicapIndex: '' })));
    setStep('names');
  }

  function updatePlayer(idx: number, field: keyof PlayerInput, value: string) {
    setPlayerInputs((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, [field]: value };
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const valid = playerInputs.every(
      (p) => p.name.trim().length > 0 && p.handicapIndex !== '' && !isNaN(Number(p.handicapIndex)),
    );
    if (!valid) {
      setError('Please fill in name and handicap index for all players.');
      return;
    }

    setLoading(true);
    try {
      const result = await apiFetch<PracticeResponse>('/rounds/practice', {
        method: 'POST',
        body: JSON.stringify({
          players: playerInputs.map((p) => ({
            name: p.name.trim(),
            handicapIndex: Number(p.handicapIndex),
          })),
        }),
      });
      setSession({ roundId: result.roundId, groupId: result.groupId, entryCode: null });
      await navigate({ to: '/ball-draw' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'UNKNOWN';
      if (msg === 'NO_SEASON') {
        setError('No season configured. Ask Jason or Josh to set up the season first.');
      } else {
        setError('Could not create practice round — please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  // Step 1: player count
  if (step === 'count') {
    return (
      <div className="p-4 max-w-sm mx-auto flex flex-col gap-6 pt-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Practice Round</h1>
          <p className="text-muted-foreground text-sm">How many players in your group?</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => handleCountSelect(n)}
              className="border rounded-xl py-6 text-2xl font-bold hover:bg-muted transition-colors"
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2: player name + HI entry
  return (
    <div className="p-4 max-w-sm mx-auto flex flex-col gap-4">
      <div>
        <button
          onClick={() => setStep('count')}
          className="text-sm text-muted-foreground mb-3 hover:underline"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold mb-1">Practice Round</h1>
        <p className="text-muted-foreground text-sm">Enter player details</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {playerInputs.map((player, idx) => (
          <div key={idx} className="border rounded-xl p-4 flex flex-col gap-3">
            <p className="font-medium text-sm">Player {idx + 1}</p>
            <input
              type="text"
              placeholder="Name"
              value={player.name}
              onChange={(e) => updatePlayer(idx, 'name', e.target.value)}
              className="border rounded-lg px-3 py-2 min-h-12 bg-background text-sm"
              required
            />
            <input
              type="number"
              placeholder="Handicap index (e.g. 12.4)"
              min={0}
              max={54}
              step={0.1}
              value={player.handicapIndex}
              onChange={(e) => updatePlayer(idx, 'handicapIndex', e.target.value)}
              className="border rounded-lg px-3 py-2 min-h-12 bg-background text-sm"
              required
            />
          </div>
        ))}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        <Button type="submit" disabled={loading} className="min-h-12 w-full">
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating round…
            </>
          ) : (
            'Continue to Ball Draw →'
          )}
        </Button>
      </form>
    </div>
  );
}
