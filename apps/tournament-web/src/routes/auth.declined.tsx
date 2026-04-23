import { createFileRoute, Link } from '@tanstack/react-router';

function AuthDeclinedPage() {
  return (
    <div>
      <h1>Sign-in cancelled</h1>
      <p>You declined the Google sign-in. Try again whenever you’re ready.</p>
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </div>
  );
}

export const Route = createFileRoute('/auth/declined')({
  component: AuthDeclinedPage,
});
