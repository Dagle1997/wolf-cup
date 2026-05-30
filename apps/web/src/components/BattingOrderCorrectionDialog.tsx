import { useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Player = { id: number; name: string };

const POSITIONS = ['1st', '2nd', '3rd', '4th'] as const;

/**
 * In-round batting-order correction dialog (scorer-accessible). Reuses the
 * ball-draw position dropdowns, but routes to the safety-checked correction
 * endpoint: a clean reorder applies immediately; a reorder that changes the
 * wolf on an already-played hole surfaces those holes and asks to confirm
 * (their wolf call must be re-entered). Money is recomputed server-side.
 *
 * Uses raw fetch (not apiFetch) so the 409 conflict body (`conflicts`) is
 * readable instead of being collapsed to an error code.
 */
export function BattingOrderCorrectionDialog({
  roundId,
  groupId,
  entryCode,
  currentOrder,
  players,
  onClose,
  onApplied,
}: {
  roundId: number;
  groupId: number;
  entryCode: string | null;
  currentOrder: number[];
  players: Player[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [order, setOrder] = useState<(number | null)[]>(() => [...currentOrder]);
  const [conflicts, setConflicts] = useState<number[] | null>(null); // non-null = awaiting confirm
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: number | null) => players.find((p) => p.id === id)?.name ?? '';
  const used = new Set(order.filter((id): id is number => id !== null));
  const allChosen = order.every((id) => id !== null) && used.size === 4;
  const changed = JSON.stringify(order) !== JSON.stringify(currentOrder);

  async function call(confirm: boolean): Promise<{ status: number; body: { conflicts?: number[]; code?: string; error?: string } }> {
    const res = await fetch(`/api/rounds/${roundId}/groups/${groupId}/batting-order/correct`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(entryCode ? { 'x-entry-code': entryCode } : {}) },
      body: JSON.stringify({ order, fromOrder: currentOrder, confirm }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  async function submit(confirm: boolean) {
    if (!allChosen) return;
    setPending(true);
    setError(null);
    try {
      const { status, body } = await call(confirm);
      if (status === 200) {
        onApplied();
        onClose();
        return;
      }
      if (status === 409 && body.code === 'WOLF_CONFLICT') {
        setConflicts(body.conflicts ?? []);
        return;
      }
      if (status === 409 && body.code === 'STALE_ORDER') {
        setError('The batting order changed since you opened this — close and reopen to try again.');
        return;
      }
      setError(body.error ?? 'Could not save — try again.');
    } catch {
      setError('Network error — try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl bg-background p-4 shadow-lg">
        <h2 className="text-lg font-semibold mb-1">Change batting order</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Fixes a mis-entered draw mid-round. Money and the wolf rotation recalculate when you save.
        </p>

        {conflicts === null ? (
          <>
            <div className="flex flex-col gap-2">
              {POSITIONS.map((pos, idx) => (
                <div key={pos} className="flex items-center gap-3">
                  <span className="w-8 text-sm font-semibold text-muted-foreground">{pos}</span>
                  <select
                    className="flex-1 border rounded-lg p-3 min-h-12 bg-background"
                    value={order[idx] ?? ''}
                    disabled={pending}
                    onChange={(e) => {
                      const next = [...order];
                      next[idx] = e.target.value ? Number(e.target.value) : null;
                      setOrder(next);
                    }}
                  >
                    <option value="">— select player —</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id} disabled={used.has(p.id) && order[idx] !== p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <div className="mt-4 flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button onClick={() => void submit(false)} disabled={pending || !allChosen || !changed}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                {conflicts.length > 0 ? (
                  <>
                    <span className="font-medium">Hole{conflicts.length > 1 ? 's' : ''} {conflicts.join(', ')}</span>{' '}
                    already had a wolf call that changes with this order. Saving will clear{' '}
                    {conflicts.length > 1 ? 'those calls' : 'that call'} (greenies/polies kept) so the new wolf can re-enter{' '}
                    {conflicts.length > 1 ? 'them' : 'it'}.
                  </>
                ) : (
                  <>This changes the wolf on already-played holes.</>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              New order: {order.map((id) => nameOf(id)).join(' → ')}
            </p>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <div className="mt-4 flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setConflicts(null)} disabled={pending}>Back</Button>
              <Button onClick={() => void submit(true)} disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply & recalculate'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
