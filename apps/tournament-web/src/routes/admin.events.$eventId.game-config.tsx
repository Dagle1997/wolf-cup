/**
 * F1 "Rules & Games" setup page (Story 1.3) — preset-first event default.
 *
 * Route: /admin/events/:eventId/game-config
 *
 * The organizer starts from the Standard Guyan preset (never a blank slate),
 * picks a point value (single $X or a front/back $X/$Y split) and a lock state,
 * and Saves via PUT /api/admin/events/:eventId/game-config. The first save
 * SEEDS the event default; later saves UPDATE it. Built from the shared
 * Button / Card / FormField primitives with dark-mode tokens + ≥44px taps.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { Card } from '../components/card';
import { Button } from '../components/button';
import { FormField } from '../components/form-field';

type PointValueSchedule =
  | { kind: 'flat'; cents: number }
  | { kind: 'front-back'; frontCents: number; backCents: number };

type GameConfigJson = {
  game: string;
  pointValueSchedule: PointValueSchedule;
  lockState?: 'locked' | 'unlocked';
};

type GameConfigRow = {
  id: string;
  lockState: 'locked' | 'unlocked' | null;
  configVersion: number;
  configJson: string;
};

type GameConfigResponse = { config: GameConfigRow | null };

async function fetchGameConfig(eventId: string): Promise<GameConfigResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/game-config`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as GameConfigResponse;
}

/** Dollars (whole) → even cents. The engine rejects odd/negative cents. */
function dollarsToCents(dollars: number): number {
  return Math.round(dollars) * 100;
}

export function GameConfigPage({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const query = useQuery<GameConfigResponse, Error>({
    queryKey: ['game-config', eventId],
    queryFn: () => fetchGameConfig(eventId),
    retry: false,
  });

  const [mode, setMode] = useState<'flat' | 'front-back'>('flat');
  const [flatDollars, setFlatDollars] = useState(5);
  const [frontDollars, setFrontDollars] = useState(5);
  const [backDollars, setBackDollars] = useState(10);
  const [lockState, setLockState] = useState<'locked' | 'unlocked'>('locked');

  // Hydrate the controls from the saved config once loaded.
  useEffect(() => {
    const row = query.data?.config;
    if (!row) return;
    setLockState(row.lockState ?? 'locked');
    try {
      const cfg = JSON.parse(row.configJson) as GameConfigJson;
      const sched = cfg.pointValueSchedule;
      if (sched.kind === 'flat') {
        setMode('flat');
        setFlatDollars(Math.round(sched.cents / 100));
      } else {
        setMode('front-back');
        setFrontDollars(Math.round(sched.frontCents / 100));
        setBackDollars(Math.round(sched.backCents / 100));
      }
    } catch {
      /* keep defaults on a malformed config */
    }
  }, [query.data]);

  const save = useMutation<GameConfigResponse, Error, void>({
    mutationFn: async () => {
      const pointValueSchedule: PointValueSchedule =
        mode === 'flat'
          ? { kind: 'flat', cents: dollarsToCents(flatDollars) }
          : { kind: 'front-back', frontCents: dollarsToCents(frontDollars), backCents: dollarsToCents(backDollars) };
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/game-config`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pointValueSchedule, lockState }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; reason?: string };
        throw new Error(body.reason ?? body.code ?? `http_${res.status}`);
      }
      return (await res.json()) as GameConfigResponse;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['game-config', eventId] }),
  });

  if (query.isPending) {
    return (
      <PageShell title="Rules & Games">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Rules & Games">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <ErrorCard error="Couldn't load the game config." onRetry={query.refetch} />
      </PageShell>
    );
  }

  const isSeeded = query.data!.config !== null;

  return (
    <PageShell title="Rules & Games">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />

      <Card data-testid="preset-card" style={{ marginBottom: 16 }}>
        <strong>Standard Guyan</strong>
        <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', marginTop: 4 }}>
          The classic 2v2: low ball, skin, team total, plus net-skins. Every foursome
          inherits this with zero extra taps. Pick the stake below.
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>Point value</legend>
          <label style={{ display: 'block', minHeight: 44, marginBottom: 4 }} data-testid="pv-mode-flat">
            <input type="radio" name="pv-mode" checked={mode === 'flat'} onChange={() => setMode('flat')} />{' '}
            Single value (all 18 holes)
          </label>
          {mode === 'flat' ? (
            <FormField label="Dollars per point">
              <input
                type="number"
                min={1}
                step={1}
                data-testid="pv-flat-dollars"
                value={flatDollars}
                onChange={(e) => setFlatDollars(Number(e.target.value))}
                style={{ minHeight: 44 }}
              />
            </FormField>
          ) : null}

          <label style={{ display: 'block', minHeight: 44, margin: '8px 0 4px' }} data-testid="pv-mode-front-back">
            <input type="radio" name="pv-mode" checked={mode === 'front-back'} onChange={() => setMode('front-back')} />{' '}
            Front / back split
          </label>
          {mode === 'front-back' ? (
            <div style={{ display: 'flex', gap: 12 }}>
              <FormField label="Front $/pt">
                <input
                  type="number"
                  min={1}
                  step={1}
                  data-testid="pv-front-dollars"
                  value={frontDollars}
                  onChange={(e) => setFrontDollars(Number(e.target.value))}
                  style={{ minHeight: 44 }}
                />
              </FormField>
              <FormField label="Back $/pt">
                <input
                  type="number"
                  min={1}
                  step={1}
                  data-testid="pv-back-dollars"
                  value={backDollars}
                  onChange={(e) => setBackDollars(Number(e.target.value))}
                  style={{ minHeight: 44 }}
                />
              </FormField>
            </div>
          ) : null}
        </fieldset>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }} data-testid="lock-toggle">
          <input
            type="checkbox"
            checked={lockState === 'unlocked'}
            onChange={(e) => setLockState(e.target.checked ? 'unlocked' : 'locked')}
          />
          <span>
            <strong>Let foursomes change their game</strong>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>
              {lockState === 'locked'
                ? 'Locked — every foursome plays the event default.'
                : 'Unlocked — foursomes may diverge (self-serve edits arrive later).'}
            </div>
          </span>
        </label>
      </Card>

      {save.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          Couldn&apos;t save ({save.error.message}).
        </p>
      ) : null}
      {save.isSuccess ? (
        <p role="status" style={{ color: 'var(--color-success, var(--color-brand-primary))' }}>
          Saved.
        </p>
      ) : null}

      <Button data-testid="save-game-config" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : isSeeded ? 'Save changes' : 'Set up Standard Guyan'}
      </Button>
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/game-config')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <GameConfigPage eventId={eventId} />;
}
