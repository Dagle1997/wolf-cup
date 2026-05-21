/**
 * T3-5 Rule-Set Editor at /admin/rule-sets/$id/edit.
 *
 * Editor for the latest revision of a rule_set. Every Save creates a new
 * rule_set_revisions row (FD-8 immutable history); existing revisions
 * stay queryable for events that pin a specific revision_id.
 *
 * Backend endpoints consumed:
 *   - GET /api/admin/rule-sets/:id  — fetch rule_set + latest revision
 *   - POST /api/admin/rule-sets/:id/revisions  — append new revision
 *
 * Auth guard: same 5-step auth-status loader as T2-3b/T2-5/T3-2/T3-3.
 *
 * Dual-export: Route + EditRuleSetPage.
 *
 * Greenies refine semantics: when carryover toggled ON, validation
 * auto-switches to '2-putt'; OFF → 'none'. The matching Zod refine on
 * RuleSetConfigSchema (copy of the server's schema) is the safety net.
 */

import { createFileRoute, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

// ---- Loader ---------------------------------------------------------------


// ---- RuleSetConfigSchema (COPY of server's; no-SHARED posture) ------------

const RuleSetConfigSchema = z
  .object({
    sandies: z.boolean(),
    autoPress: z.object({
      enabled: z.boolean(),
      downN: z.number().int().min(1).max(4),
      multiplier: z.number().positive().finite(),
    }),
    greenies: z.object({
      carryover: z.boolean(),
      validation: z.enum(['none', '2-putt']),
    }),
    individualBet: z.object({
      matchPlayPerHoleCents: z.number().int().nonnegative(),
      autoPressDownN: z.number().int().min(1).max(4).optional(),
    }),
    subGames: z.object({
      defaultBuyInPerParticipantCents: z.number().int().nonnegative(),
    }),
  })
  .refine(
    (data) =>
      (data.greenies.carryover === true && data.greenies.validation === '2-putt') ||
      (data.greenies.carryover === false && data.greenies.validation === 'none'),
    {
      path: ['greenies', 'validation'],
      message: 'greenie_validation must be "2-putt" when carryover=true, else "none"',
    },
  );

type RuleSetConfig = z.infer<typeof RuleSetConfigSchema>;

// ---- Types ----------------------------------------------------------------

type LatestRevision = {
  id: string;
  revisionNumber: number;
  configJson: RuleSetConfig;
  effectiveFromRoundId: string | null;
  effectiveFromHole: number;
  createdByPlayerId: string | null;
  createdAt: number;
};

type RuleSetResponse = {
  id: string;
  name: string;
  createdAt: number;
  latestRevision: LatestRevision | null;
};

// Form state mirrors RuleSetConfig but stores number-typed inputs as
// strings (HTML controlled inputs work best with string values).
type FormState = {
  sandies: boolean;
  autoPressEnabled: boolean;
  autoPressDownN: string;
  autoPressMultiplier: string;
  greeniesCarryover: boolean;
  greeniesValidation: 'none' | '2-putt';
  matchPlayPerHoleDollars: string; // dollars; converted to cents at submit
  individualAutoPressDownNEnabled: boolean;
  individualAutoPressDownN: string;
  defaultBuyInDollars: string;
};

function configToForm(cfg: RuleSetConfig): FormState {
  return {
    sandies: cfg.sandies,
    autoPressEnabled: cfg.autoPress.enabled,
    autoPressDownN: String(cfg.autoPress.downN),
    autoPressMultiplier: String(cfg.autoPress.multiplier),
    greeniesCarryover: cfg.greenies.carryover,
    greeniesValidation: cfg.greenies.validation,
    matchPlayPerHoleDollars: (cfg.individualBet.matchPlayPerHoleCents / 100).toFixed(2),
    individualAutoPressDownNEnabled: cfg.individualBet.autoPressDownN !== undefined,
    individualAutoPressDownN: String(cfg.individualBet.autoPressDownN ?? 2),
    defaultBuyInDollars: (cfg.subGames.defaultBuyInPerParticipantCents / 100).toFixed(2),
  };
}

function defaultFormState(): FormState {
  return configToForm({
    sandies: true,
    autoPress: { enabled: true, downN: 2, multiplier: 2 },
    greenies: { carryover: false, validation: 'none' },
    individualBet: { matchPlayPerHoleCents: 100 },
    subGames: { defaultBuyInPerParticipantCents: 0 },
  });
}

function formToConfig(form: FormState): { ok: true; config: RuleSetConfig } | { ok: false; reason: string } {
  const downN = Number(form.autoPressDownN);
  const multiplier = Number(form.autoPressMultiplier);
  const matchPlayDollars = Number(form.matchPlayPerHoleDollars);
  const indAutoPress = Number(form.individualAutoPressDownN);
  const buyInDollars = Number(form.defaultBuyInDollars);

  const candidate: RuleSetConfig = {
    sandies: form.sandies,
    autoPress: {
      enabled: form.autoPressEnabled,
      downN: Number.isFinite(downN) ? downN : 0,
      multiplier: Number.isFinite(multiplier) ? multiplier : 0,
    },
    greenies: {
      carryover: form.greeniesCarryover,
      validation: form.greeniesValidation,
    },
    individualBet: {
      matchPlayPerHoleCents: Number.isFinite(matchPlayDollars)
        ? Math.round(matchPlayDollars * 100)
        : 0,
      ...(form.individualAutoPressDownNEnabled && Number.isFinite(indAutoPress)
        ? { autoPressDownN: indAutoPress }
        : {}),
    },
    subGames: {
      defaultBuyInPerParticipantCents: Number.isFinite(buyInDollars)
        ? Math.round(buyInDollars * 100)
        : 0,
    },
  };
  const result = RuleSetConfigSchema.safeParse(candidate);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      reason: first ? `${first.path.join('.')}: ${first.message}` : 'invalid form data',
    };
  }
  return { ok: true, config: result.data };
}

// ---- Component ------------------------------------------------------------

export function EditRuleSetPage({ ruleSetId }: { ruleSetId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [formInitialized, setFormInitialized] = useState(false);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const inFlightControllers = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const set = inFlightControllers.current;
    return () => {
      for (const ac of set) ac.abort();
      set.clear();
    };
  }, []);
  function trackController(): AbortController {
    const ac = new AbortController();
    inFlightControllers.current.add(ac);
    return ac;
  }
  function releaseController(ac: AbortController): void {
    inFlightControllers.current.delete(ac);
  }

  // ---- Fetch ------------------------------------------------------------

  const ruleSetQuery = useQuery<RuleSetResponse>({
    queryKey: ['rule-set', ruleSetId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/admin/rule-sets/${ruleSetId}`, { signal });
      if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
      return (await res.json()) as RuleSetResponse;
    },
    staleTime: 0,
  });

  // Sync form from query data on first load. Subsequent syncs ONLY happen
  // post-save (when invalidate triggers refetch + the user expects the
  // form to reflect the just-saved state).
  useEffect(() => {
    if (!formInitialized && ruleSetQuery.data) {
      const rev = ruleSetQuery.data.latestRevision;
      if (rev) {
        setForm(configToForm(rev.configJson));
      }
      setFormInitialized(true);
    }
  }, [ruleSetQuery.data, formInitialized]);

  // ---- Save mutation ----------------------------------------------------

  const saveMutation = useMutation({
    mutationFn: async (config: RuleSetConfig) => {
      const ac = trackController();
      try {
        const res = await fetch(`/api/admin/rule-sets/${ruleSetId}/revisions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(config),
          signal: ac.signal,
        });
        const body = (await res.json().catch(() => null)) as
          | { revisionId?: string; revisionNumber?: number; code?: string }
          | null;
        if (!res.ok) throw new Error(body?.code ?? `http_${res.status}`);
        return body as { revisionId: string; revisionNumber: number };
      } finally {
        releaseController(ac);
      }
    },
    onSuccess: (data) => {
      setTopLevelError(null);
      setSuccessMsg(`Saved revision ${data.revisionNumber}`);
      void qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] });
    },
    onError: (err) => {
      const code = err instanceof Error ? err.message : 'unknown';
      setSuccessMsg(null);
      if (code === 'revision_number_conflict') {
        setTopLevelError(
          'Another save just landed. Reload to see the latest revision before saving again.',
        );
      } else if (code === 'invalid_body') {
        setTopLevelError('Invalid form data — please check every field.');
      } else if (code === 'rule_set_not_found') {
        setTopLevelError('This rule set no longer exists.');
      } else {
        setTopLevelError('Save failed. Please try again.');
      }
    },
  });

  // ---- Form mutators ----------------------------------------------------

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleCarryover(next: boolean): void {
    // Auto-switch validation per the Zod refine.
    setForm((prev) => ({
      ...prev,
      greeniesCarryover: next,
      greeniesValidation: next ? '2-putt' : 'none',
    }));
  }

  // ---- Submit -----------------------------------------------------------

  function onSave(): void {
    const result = formToConfig(form);
    if (!result.ok) {
      setSuccessMsg(null);
      setTopLevelError(`Form validation: ${result.reason}`);
      return;
    }
    saveMutation.mutate(result.config);
  }

  // ---- Render -----------------------------------------------------------

  if (ruleSetQuery.isLoading) {
    return (
      <PageShell title="Edit Rule Set">
        <LoadingCard message="Loading rule set…" />
      </PageShell>
    );
  }

  if (ruleSetQuery.isError || !ruleSetQuery.data) {
    return (
      <PageShell title="Edit Rule Set">
        <ErrorCard
          title="Failed to load rule set"
          error="Try again or contact support."
        />
      </PageShell>
    );
  }

  const ruleSet = ruleSetQuery.data;
  const revisionNumber = ruleSet.latestRevision?.revisionNumber ?? 0;

  return (
    <PageShell title={`Edit Rule Set: ${ruleSet.name}`}>
      <p>Revision {revisionNumber === 0 ? '— (no revisions yet)' : revisionNumber}</p>

      {ruleSet.latestRevision === null ? (
        <p role="status">
          No revisions yet. Saving the form below will create revision 1 with the values
          you choose.
        </p>
      ) : null}

      {topLevelError ? <p role="alert">{topLevelError}</p> : null}
      {successMsg && !topLevelError ? <p role="status">{successMsg}</p> : null}

      <section>
        <h2>2v2 Best Ball</h2>
        <label>
          <input
            type="checkbox"
            checked={form.sandies}
            onChange={(e) => setField('sandies', e.target.checked)}
          />
          Sandies enabled
        </label>

        <fieldset>
          <legend>Auto-press</legend>
          <label>
            <input
              type="checkbox"
              checked={form.autoPressEnabled}
              onChange={(e) => setField('autoPressEnabled', e.target.checked)}
            />
            Enabled
          </label>
          <label htmlFor="auto-press-down-n">N-down trigger</label>
          <input
            id="auto-press-down-n"
            type="number"
            min={1}
            max={4}
            step={1}
            value={form.autoPressDownN}
            onChange={(e) => setField('autoPressDownN', e.target.value)}
            disabled={!form.autoPressEnabled}
          />
          <label htmlFor="auto-press-multiplier">Multiplier</label>
          <input
            id="auto-press-multiplier"
            type="number"
            step="0.1"
            value={form.autoPressMultiplier}
            onChange={(e) => setField('autoPressMultiplier', e.target.value)}
            disabled={!form.autoPressEnabled}
          />
        </fieldset>
      </section>

      <section>
        <h2>Greenies</h2>
        <label>
          <input
            type="checkbox"
            checked={form.greeniesCarryover}
            onChange={(e) => toggleCarryover(e.target.checked)}
          />
          Carryover
        </label>
        <fieldset>
          <legend>Validation</legend>
          <label>
            <input
              type="radio"
              name="greenies-validation"
              value="none"
              checked={form.greeniesValidation === 'none'}
              disabled={form.greeniesCarryover}
              onChange={() => setField('greeniesValidation', 'none')}
            />
            None
          </label>
          <label>
            <input
              type="radio"
              name="greenies-validation"
              value="2-putt"
              checked={form.greeniesValidation === '2-putt'}
              disabled={!form.greeniesCarryover}
              onChange={() => setField('greeniesValidation', '2-putt')}
            />
            2-putt
          </label>
        </fieldset>
      </section>

      <section>
        <h2>Individual Bets</h2>
        <label htmlFor="match-play-per-hole">Match play $/hole</label>
        <input
          id="match-play-per-hole"
          type="number"
          step="0.01"
          min={0}
          value={form.matchPlayPerHoleDollars}
          onChange={(e) => setField('matchPlayPerHoleDollars', e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={form.individualAutoPressDownNEnabled}
            onChange={(e) => setField('individualAutoPressDownNEnabled', e.target.checked)}
          />
          Auto-press individual bets
        </label>
        <label htmlFor="individual-auto-press-down-n">Individual auto-press N-down</label>
        <input
          id="individual-auto-press-down-n"
          type="number"
          min={1}
          max={4}
          step={1}
          value={form.individualAutoPressDownN}
          onChange={(e) => setField('individualAutoPressDownN', e.target.value)}
          disabled={!form.individualAutoPressDownNEnabled}
        />
      </section>

      <section>
        <h2>Sub-games</h2>
        <label htmlFor="default-buy-in">Default buy-in per participant ($)</label>
        <input
          id="default-buy-in"
          type="number"
          step="0.01"
          min={0}
          value={form.defaultBuyInDollars}
          onChange={(e) => setField('defaultBuyInDollars', e.target.value)}
        />
      </section>

      <button type="button" onClick={onSave} disabled={saveMutation.isPending}>
        {saveMutation.isPending ? 'Saving…' : 'Save'}
      </button>
    </PageShell>
  );
}

// ---- Inline forbidden message ---------------------------------------------

function ForbiddenMessage() {
  return (
    <div>
      <h1>Not an organizer</h1>
      <p>
        You're signed in but don't have organizer permissions. Contact Josh to grant
        organizer access, or <a href="/api/auth/google">sign in as a different account</a>.
      </p>
    </div>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/admin/rule-sets/$id/edit')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  const { id } = useParams({ from: '/admin/rule-sets/$id/edit' });
  if (!player.isOrganizer) return <ForbiddenMessage />;
  return <EditRuleSetPage ruleSetId={id} />;
}
