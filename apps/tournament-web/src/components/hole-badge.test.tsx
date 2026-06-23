import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoleBadge } from './hole-badge';

describe('HoleBadge', () => {
  describe('notation branches (keyed on d = gross - par)', () => {
    test('eagle+ (d <= -2): renders gross number with data-variant=eagle', () => {
      render(<HoleBadge gross={3} par={5} />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).toHaveAttribute('data-variant', 'eagle');
      expect(badge).toHaveTextContent('3');
    });

    test('eagle+ also covers a 2-under-on-a-par-4 (d === -2)', () => {
      render(<HoleBadge gross={2} par={4} />);
      expect(screen.getByTestId('hole-badge')).toHaveAttribute('data-variant', 'eagle');
    });

    test('birdie (d === -1): renders gross number with data-variant=birdie', () => {
      render(<HoleBadge gross={3} par={4} />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).toHaveAttribute('data-variant', 'birdie');
      expect(badge).toHaveTextContent('3');
    });

    test('par (d === 0): renders gross number with data-variant=par', () => {
      render(<HoleBadge gross={4} par={4} />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).toHaveAttribute('data-variant', 'par');
      expect(badge).toHaveTextContent('4');
    });

    test('bogey (d === 1): renders gross number with data-variant=bogey', () => {
      render(<HoleBadge gross={5} par={4} />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).toHaveAttribute('data-variant', 'bogey');
      expect(badge).toHaveTextContent('5');
    });

    test('double+ (d >= 2): renders gross number with data-variant=double', () => {
      render(<HoleBadge gross={6} par={4} />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).toHaveAttribute('data-variant', 'double');
      expect(badge).toHaveTextContent('6');
    });

    test('double+ also covers a triple (d === 3)', () => {
      render(<HoleBadge gross={7} par={4} />);
      expect(screen.getByTestId('hole-badge')).toHaveAttribute('data-variant', 'double');
    });
  });

  describe('bonus dots (greenie / polie / sandie)', () => {
    test('greenie sets data-greenie when flag is set', () => {
      render(<HoleBadge gross={3} par={3} hasGreenie />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).toHaveAttribute('data-greenie', 'true');
      expect(badge).not.toHaveAttribute('data-polie');
      expect(badge).not.toHaveAttribute('data-sandie');
    });

    test('polie sets data-polie when flag is set', () => {
      render(<HoleBadge gross={4} par={4} hasPolie />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).toHaveAttribute('data-polie', 'true');
      expect(badge).not.toHaveAttribute('data-greenie');
      expect(badge).not.toHaveAttribute('data-sandie');
    });

    test('sandie sets data-sandie when flag is set', () => {
      render(<HoleBadge gross={4} par={4} hasSandie />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).toHaveAttribute('data-sandie', 'true');
      expect(badge).not.toHaveAttribute('data-greenie');
      expect(badge).not.toHaveAttribute('data-polie');
    });

    test('multiple bonus flags co-occur', () => {
      render(<HoleBadge gross={4} par={4} hasGreenie hasPolie hasSandie />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).toHaveAttribute('data-greenie', 'true');
      expect(badge).toHaveAttribute('data-polie', 'true');
      expect(badge).toHaveAttribute('data-sandie', 'true');
    });

    test('no bonus dots when no flags set', () => {
      render(<HoleBadge gross={4} par={4} />);
      const badge = screen.getByTestId('hole-badge');
      expect(badge).not.toHaveAttribute('data-greenie');
      expect(badge).not.toHaveAttribute('data-polie');
      expect(badge).not.toHaveAttribute('data-sandie');
    });
  });

  describe('stroke dots (top-right, driven by relativeStrokes)', () => {
    test('relativeStrokes === 1 → one stroke (data-strokes=1)', () => {
      render(<HoleBadge gross={4} par={4} relativeStrokes={1} />);
      expect(screen.getByTestId('hole-badge')).toHaveAttribute('data-strokes', '1');
    });

    test('relativeStrokes === 2 → two strokes (data-strokes=2)', () => {
      render(<HoleBadge gross={4} par={4} relativeStrokes={2} />);
      expect(screen.getByTestId('hole-badge')).toHaveAttribute('data-strokes', '2');
    });

    test('relativeStrokes === 0 → no strokes (data-strokes=0)', () => {
      render(<HoleBadge gross={4} par={4} relativeStrokes={0} />);
      expect(screen.getByTestId('hole-badge')).toHaveAttribute('data-strokes', '0');
    });

    test('relativeStrokes undefined → data-strokes defaults to 0', () => {
      render(<HoleBadge gross={4} par={4} />);
      expect(screen.getByTestId('hole-badge')).toHaveAttribute('data-strokes', '0');
    });
  });

  // These assert the ACTUAL rendered dot <span> elements (not just the derived
  // data-* attrs), so a regression in the dot-rendering JSX — wrong count, or
  // dropped dots — is caught. (AC #3 1-vs-2 stroke distinction; AC #8 bonus dots.)
  describe('rendered dots in the DOM', () => {
    test('relativeStrokes === 1 renders exactly one stroke-dot element', () => {
      render(<HoleBadge gross={4} par={4} relativeStrokes={1} />);
      expect(screen.queryAllByTestId('stroke-dot')).toHaveLength(1);
    });

    test('relativeStrokes === 2 renders exactly two stroke-dot elements', () => {
      render(<HoleBadge gross={4} par={4} relativeStrokes={2} />);
      expect(screen.queryAllByTestId('stroke-dot')).toHaveLength(2);
    });

    test('relativeStrokes >= 2 never renders more than two (3 → still 2)', () => {
      render(<HoleBadge gross={4} par={4} relativeStrokes={3} />);
      expect(screen.queryAllByTestId('stroke-dot')).toHaveLength(2);
    });

    test('no stroke-dot elements when relativeStrokes is 0 / undefined', () => {
      render(<HoleBadge gross={4} par={4} />);
      expect(screen.queryAllByTestId('stroke-dot')).toHaveLength(0);
    });

    test('each bonus flag renders its own dot element', () => {
      render(<HoleBadge gross={3} par={3} hasGreenie />);
      expect(screen.getByTestId('bonus-dot-greenie')).toBeInTheDocument();
      expect(screen.queryByTestId('bonus-dot-polie')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bonus-dot-sandie')).not.toBeInTheDocument();
    });

    test('all three bonus dots render as distinct elements when co-occurring', () => {
      render(<HoleBadge gross={4} par={4} hasGreenie hasPolie hasSandie />);
      expect(screen.getByTestId('bonus-dot-greenie')).toBeInTheDocument();
      expect(screen.getByTestId('bonus-dot-polie')).toBeInTheDocument();
      expect(screen.getByTestId('bonus-dot-sandie')).toBeInTheDocument();
    });

    test('no bonus-dot elements when no flags set', () => {
      render(<HoleBadge gross={4} par={4} />);
      expect(screen.queryByTestId('bonus-dot-greenie')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bonus-dot-polie')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bonus-dot-sandie')).not.toBeInTheDocument();
    });
  });
});
