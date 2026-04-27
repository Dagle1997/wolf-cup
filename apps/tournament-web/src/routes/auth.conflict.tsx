/**
 * T3-7 /auth/conflict — public landing page for the device-binding rebind
 * conflict (Case C in `lookupOrBindOAuthIdentity`).
 *
 * **PUBLIC route — no `beforeLoad` auth check.** The user just FAILED
 * sign-in (the OAuth callback redirected here because the device-bound
 * player already has a Google identity bound to a DIFFERENT sub). This
 * page is informational only — v1 advises contacting the organizer to
 * merge identities; future work adds an admin merge endpoint and a
 * "try again with a fresh device" button.
 *
 * Dual-export: `Route` for TanStack file-route registration AND
 * `ConflictPage` for direct test rendering.
 */

import { createFileRoute, Link } from '@tanstack/react-router';

export function ConflictPage() {
  return (
    <div>
      <h1>That sign-in didn&apos;t match this device</h1>
      <p>
        This device was previously claimed by a different sign-in. Tap{' '}
        <strong>That&apos;s not me</strong> on the wrong account first, OR ask
        Josh to merge identities.
      </p>
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </div>
  );
}

export const Route = createFileRoute('/auth/conflict')({
  component: ConflictPage,
});
