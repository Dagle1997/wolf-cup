import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/round/$roundId')({
  component: function RoundDetail() {
    const { roundId } = Route.useParams();
    return (
      <div className="p-4">
        <h2 className="text-xl font-semibold">Round {roundId}</h2>
        <p className="text-muted-foreground mt-1">Coming soon.</p>
      </div>
    );
  },
});
