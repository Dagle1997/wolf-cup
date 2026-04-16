import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/guide')({
  component: GuideRedirect,
});

function GuideRedirect() {
  useEffect(() => {
    window.location.replace('/guide.pdf');
  }, []);
  return (
    <div className="max-w-md mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
      Opening the Player Guide…
    </div>
  );
}
