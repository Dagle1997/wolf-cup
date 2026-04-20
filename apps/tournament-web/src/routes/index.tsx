import { createFileRoute } from '@tanstack/react-router';

function IndexPage() {
  return <h1>Tournament</h1>;
}

export const Route = createFileRoute('/')({
  component: IndexPage,
});
