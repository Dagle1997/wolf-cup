/**
 * T13-4 scorer-policy admin page — organizer chooses who may be a foursome's
 * designated scorer for this event.
 *
 * Route: /admin/events/:eventId/scorer-policy
 *
 * Foursome members (default) / Designated only (+ a roster picker for the
 * allowed pool, incl. a walking caddie) / Open. Saves via
 * PUT /api/admin/events/:eventId/scorer-policy. Single-writer is unchanged —
 * this only gates who may BECOME a scorer.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

type Policy = 'foursome' | 'designated' | 'open';
type ScorerPolicyResponse = {
  policy: Policy;
  designatedPlayerIds: string[];
  roster: Array<{ playerId: string; name: string | null }>;
};

async function fetchPolicy(eventId: string): Promise<ScorerPolicyResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/scorer-policy`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as ScorerPolicyResponse;
}

const POLICY_LABELS: Record<Policy, { title: string; desc: string }> = {
  foursome: { title: 'Foursome members', desc: 'Anyone in the foursome (plus you) can score. They decide who enters.' },
  designated: { title: 'Designated scorers', desc: 'Only the people you pick below (plus you) — e.g. a walking caddie.' },
  open: { title: 'Open', desc: 'Any event participant (plus you) can score any foursome.' },
};

export function ScorerPolicyPage({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const query = useQuery<ScorerPolicyResponse, Error>({
    queryKey: ['scorer-policy', eventId],
    queryFn: () => fetchPolicy(eventId),
    retry: false,
  });

  const [policy, setPolicy] = useState<Policy>('foursome');
  const [designated, setDesignated] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (query.data) {
      setPolicy(query.data.policy);
      setDesignated(new Set(query.data.designatedPlayerIds));
    }
  }, [query.data]);

  const save = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/scorer-policy`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          policy,
          designatedPlayerIds: policy === 'designated' ? [...designated] : [],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(body.code ?? `http_${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scorer-policy', eventId] }),
  });

  if (query.isPending) {
    return (
      <PageShell title="Who can score?">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Who can score?">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <ErrorCard error="Couldn't load the scorer policy." onRetry={query.refetch} />
      </PageShell>
    );
  }
  const roster = query.data!.roster;

  return (
    <PageShell title="Who can score?">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
      <p style={{ color: 'var(--color-text-muted, var(--color-text-muted))', fontSize: 'var(--font-sm)' }}>
        Choose who is eligible to score each foursome. One person scores at a time;
        eligible players can take over with a tap. This doesn’t change how scores are
        entered — only who’s allowed.
      </p>

      {(['foursome', 'designated', 'open'] as const).map((p) => (
        <label key={p} style={{ display: 'block', margin: '10px 0' }} data-testid={`policy-${p}`}>
          <input
            type="radio"
            name="scorer-policy"
            checked={policy === p}
            onChange={() => setPolicy(p)}
          />{' '}
          <strong>{POLICY_LABELS[p].title}</strong>
          <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted, var(--color-text-muted))', marginLeft: 24 }}>
            {POLICY_LABELS[p].desc}
          </div>
        </label>
      ))}

      {policy === 'designated' ? (
        <fieldset data-testid="designee-picker" style={{ margin: '12px 0', border: '1px solid var(--color-border)', borderRadius: 8 }}>
          <legend>Allowed scorers</legend>
          {roster.length === 0 ? (
            <p style={{ padding: 8 }}>No roster yet — add players first.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 8, margin: 0 }}>
              {roster.map((r) => (
                <li key={r.playerId}>
                  <label>
                    <input
                      type="checkbox"
                      data-testid={`designee-${r.playerId}`}
                      checked={designated.has(r.playerId)}
                      onChange={() =>
                        setDesignated((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.playerId)) next.delete(r.playerId);
                          else next.add(r.playerId);
                          return next;
                        })
                      }
                    />{' '}
                    {r.name ?? '—'}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      ) : null}

      {save.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger, #dc2626)' }}>
          {save.error.message === 'designee_not_in_event'
            ? 'A selected scorer isn’t on the event roster.'
            : `Couldn’t save (${save.error.message}).`}
        </p>
      ) : null}
      {save.isSuccess ? <p role="status" style={{ color: 'var(--color-success, var(--color-brand-primary))' }}>Saved.</p> : null}

      <button
        type="button"
        data-testid="save-scorer-policy"
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/scorer-policy')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <ScorerPolicyPage eventId={eventId} />;
}
