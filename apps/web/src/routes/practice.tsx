import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { setSession } from '@/lib/session-store';

export const Route = createFileRoute('/practice')({
  component: PracticeSetupPage,
});

type Group = { id: number; groupNumber: number };

type PracticeResponse = {
  roundId: number;
  groups: Group[];
};

const TEE_OPTIONS = [
  { tee: 'black' as const, label: 'Black', sub: '6,523 yds — 71.3 / 126' },
  { tee: 'blue' as const, label: 'Blue', sub: '6,209 yds — 69.7 / 121' },
  { tee: 'white' as const, label: 'White', sub: '5,795 yds — 67.4 / 118' },
];

const GROUP_OPTIONS = [
  { count: 1, label: '1 group', sub: '4 players' },
  { count: 2, label: '2 groups', sub: '8 players' },
  { count: 3, label: '3 groups', sub: '12 players' },
  { count: 4, label: '4 groups', sub: '16 players' },
];

function PracticeSetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'tee' | 'count' | 'group-select'>('tee');
  const [selectedTee, setSelectedTee] = useState<'black' | 'blue' | 'white'>('blue');
  const [practiceData, setPracticeData] = useState<PracticeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGroupCountSelect(groupCount: number) {
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<PracticeResponse>('/rounds/practice', {
        method: 'POST',
        body: JSON.stringify({ groupCount, tee: selectedTee }),
      });
      if (result.groups.length === 1) {
        // Single group — go straight to ball-draw
        setSession({ roundId: result.roundId, groupId: result.groups[0]!.id, entryCode: null });
        await navigate({ to: '/ball-draw' });
      } else {
        // Multiple groups — ask which group this scorer is in
        setPracticeData(result);
        setStep('group-select');
      }
    } catch {
      setError('Could not create practice round — please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGroupSelect(group: Group) {
    if (!practiceData) return;
    setSession({ roundId: practiceData.roundId, groupId: group.id, entryCode: null });
    await navigate({ to: '/ball-draw' });
  }

  // Step 1: Which tees?
  if (step === 'tee') {
    return (
      <div className="p-4 max-w-sm mx-auto flex flex-col gap-6 pt-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Practice Round</h1>
          <p className="text-muted-foreground text-sm">Which tees are you playing?</p>
        </div>
        <div className="flex flex-col gap-3">
          {TEE_OPTIONS.map(({ tee, label, sub }) => (
            <button
              key={tee}
              onClick={() => { setSelectedTee(tee); setStep('count'); }}
              className="border rounded-xl p-4 text-left flex items-center justify-between hover:bg-muted transition-colors"
            >
              <div>
                <p className="font-semibold">{label}</p>
                <p className="text-sm text-muted-foreground">{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2: How many groups?
  if (step === 'count') {
    return (
      <div className="p-4 max-w-sm mx-auto flex flex-col gap-6 pt-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Practice Round</h1>
          <p className="text-muted-foreground text-sm">How many groups today?</p>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="flex flex-col gap-3">
          {GROUP_OPTIONS.map(({ count, label, sub }) => (
            <button
              key={count}
              disabled={loading}
              onClick={() => void handleGroupCountSelect(count)}
              className="border rounded-xl p-4 text-left flex items-center justify-between hover:bg-muted transition-colors disabled:opacity-50"
            >
              <div>
                <p className="font-semibold">{label}</p>
                <p className="text-sm text-muted-foreground">{sub}</p>
              </div>
              {loading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2: Which group are you scoring? (multi-group only)
  return (
    <div className="p-4 max-w-sm mx-auto flex flex-col gap-4 pt-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Practice Round</h1>
        <p className="text-muted-foreground text-sm">Which group are you scoring?</p>
      </div>
      <div className="flex flex-col gap-3">
        {practiceData?.groups.map((group) => (
          <button
            key={group.id}
            onClick={() => void handleGroupSelect(group)}
            className="border rounded-xl p-4 text-left hover:bg-muted transition-colors"
          >
            <p className="font-semibold">Group {group.groupNumber}</p>
          </button>
        ))}
      </div>
      <div className="rounded-xl border bg-muted/40 p-4 mt-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Other groups:</span> open the app and tap
          Score Entry — the practice round will appear there to join.
        </p>
      </div>
    </div>
  );
}
