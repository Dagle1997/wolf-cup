import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AlertCircle,
  ClipboardList,
  Loader2,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Round = {
  id: number;
  seasonId: number;
  type: 'official' | 'casual';
  status: 'scheduled' | 'active' | 'finalized' | 'cancelled';
  scheduledDate: string;
  createdAt: number;
};

type DiffGroup = { groupNumber: number; playerIds: number[]; names: string[] };

type PairingDiff = {
  tracked: boolean;
  generated: DiffGroup[] | null;
  final: DiffGroup[];
  changes: {
    moved: { playerId: number; fromGroup: number; toGroup: number }[];
    added: { playerId: number; toGroup: number }[];
    removed: { playerId: number; fromGroup: number }[];
  };
  names: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/admin/pairing-audit')({
  component: PairingAuditPage,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Build human-readable, ACTOR-NEUTRAL change lines. We capture *what* changed,
 * not *who* changed it (there is no per-edit audit log), so copy never names an
 * admin. Same-group remove+add pairs read as a "replaced" swap; the remainder
 * read as plain add/remove.
 */
function buildChangeLines(diff: PairingDiff): string[] {
  const nameOf = (id: number) => diff.names[String(id)] ?? `Player #${id}`;
  const lines: string[] = [];

  for (const m of diff.changes.moved) {
    lines.push(`${nameOf(m.playerId)} moved from Group ${m.fromGroup} → Group ${m.toGroup}`);
  }

  // Pair add+remove within the same group into "replaced" sentences.
  const addedByGroup = new Map<number, number[]>();
  for (const a of diff.changes.added) {
    const list = addedByGroup.get(a.toGroup) ?? [];
    list.push(a.playerId);
    addedByGroup.set(a.toGroup, list);
  }
  const removedByGroup = new Map<number, number[]>();
  for (const r of diff.changes.removed) {
    const list = removedByGroup.get(r.fromGroup) ?? [];
    list.push(r.playerId);
    removedByGroup.set(r.fromGroup, list);
  }

  const groupNums = new Set<number>([...addedByGroup.keys(), ...removedByGroup.keys()]);
  for (const g of [...groupNums].sort((a, b) => a - b)) {
    const added = [...(addedByGroup.get(g) ?? [])];
    const removed = [...(removedByGroup.get(g) ?? [])];
    while (added.length > 0 && removed.length > 0) {
      const inId = added.shift()!;
      const outId = removed.shift()!;
      lines.push(`${nameOf(inId)} replaced ${nameOf(outId)} in Group ${g}`);
    }
    for (const id of added) lines.push(`${nameOf(id)} added to Group ${g}`);
    for (const id of removed) lines.push(`${nameOf(id)} removed from Group ${g}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function PairingAuditPage() {
  const navigate = useNavigate();
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

  const roundsQuery = useQuery({
    queryKey: ['admin-rounds'],
    queryFn: () => apiFetch<{ items: Round[] }>('/admin/rounds'),
    retry: false,
  });

  if (roundsQuery.isError) {
    if ((roundsQuery.error as Error).message === 'UNAUTHORIZED') {
      void navigate({ to: '/admin/login' });
      return null;
    }
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4">Pairing Audit</h2>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load rounds — tap to retry</p>
          <Button variant="outline" size="sm" onClick={() => void roundsQuery.refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const rounds = (roundsQuery.data?.items ?? [])
    .slice()
    .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));

  function handleRoundChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = Number(e.target.value);
    setSelectedRoundId(val > 0 ? val : null);
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-1">Pairing Audit</h2>
      <p className="text-sm text-muted-foreground mb-4">
        What the pairing engine generated vs. the final groups after manual edits.
      </p>

      <div className="rounded-md border p-4 bg-muted/20 mb-6">
        <label className="text-sm font-medium mb-1 block">Select Round</label>
        {roundsQuery.isLoading ? (
          <div className="h-9 bg-muted rounded animate-pulse" />
        ) : (
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={selectedRoundId ?? ''}
            onChange={handleRoundChange}
          >
            <option value="">
              {rounds.length === 0 ? 'No rounds' : '— select a round —'}
            </option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {formatDate(r.scheduledDate)} ({r.status})
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedRoundId !== null && (
        <RoundDiffSection key={selectedRoundId} roundId={selectedRoundId} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round Diff Section
// ---------------------------------------------------------------------------

function RoundDiffSection({ roundId }: { roundId: number }) {
  const navigate = useNavigate();

  const diffQuery = useQuery({
    queryKey: ['admin-pairing-diff', roundId],
    queryFn: () => apiFetch<PairingDiff>(`/admin/rounds/${roundId}/pairing-diff`),
    retry: false,
  });

  if (diffQuery.isError) {
    if ((diffQuery.error as Error).message === 'UNAUTHORIZED') {
      void navigate({ to: '/admin/login' });
      return null;
    }
    return (
      <div className="rounded-md border p-4 bg-muted/20 flex flex-col items-center gap-3 py-8 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">Could not load pairing changes for this round.</p>
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px]"
          onClick={() => void diffQuery.refetch()}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (diffQuery.isLoading || !diffQuery.data) {
    return (
      <div className="rounded-md border p-6 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const diff = diffQuery.data;

  // Untracked — created before pairing tracking, or never generated from Attend.
  if (!diff.tracked) {
    return (
      <div className="rounded-md border p-4 bg-muted/20 text-sm text-muted-foreground">
        Not tracked — this round was created before pairing tracking, or its groups
        were never generated from the Attend page.
      </div>
    );
  }

  const lines = buildChangeLines(diff);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
          <ClipboardList className="h-4 w-4" />
          Pairing Changes
        </h3>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No changes from the generated pairing — the final groups match what the
            engine produced.
          </p>
        ) : (
          <ul className="rounded-md border divide-y">
            {lines.map((line, i) => (
              <li key={i} className="px-3 py-2.5 text-sm min-h-[44px] flex items-center">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Generated vs final foursomes for reference */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <GroupsCard title="Generated" groups={diff.generated ?? []} />
        <GroupsCard title="Final" groups={diff.final} />
      </div>
    </div>
  );
}

function GroupsCard({ title, groups }: { title: string; groups: DiffGroup[] }) {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 text-xs font-semibold text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="divide-y">
        {groups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No groups.</p>
        ) : (
          groups.map((g) => (
            <div key={g.groupNumber} className="px-3 py-2">
              <div className="text-xs font-medium text-muted-foreground mb-0.5">
                Group {g.groupNumber}
              </div>
              <p className="text-sm">{g.names.join(', ')}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
