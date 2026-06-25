/**
 * RulesSummary unit tests — the one-line enabled-rules summary reused on the
 * game-config page (and later on player-facing screens).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RulesSummary, ruleLabel } from './rules-summary';

describe('RulesSummary', () => {
  it('lists only ENABLED rules, in the given order, with the friendly labels', () => {
    render(
      <RulesSummary
        modifiers={[
          { type: 'net-skins', enabled: true },
          { type: 'greenie', enabled: false },
          { type: 'polie', enabled: true },
          { type: 'sandie', enabled: true },
        ]}
      />,
    );
    const el = screen.getByTestId('rules-summary');
    expect(el).toHaveTextContent('Net Skins · Polies · Sandies');
    expect(el).not.toHaveTextContent('Greenies');
  });

  it('renders a "no rules" fallback when everything is disabled', () => {
    render(
      <RulesSummary
        modifiers={[
          { type: 'net-skins', enabled: false },
          { type: 'polie', enabled: false },
        ]}
      />,
    );
    expect(screen.getByTestId('rules-summary')).toHaveTextContent(/no bonus rules/i);
  });

  it('ruleLabel maps known types and falls back to the raw type', () => {
    expect(ruleLabel('net-skins')).toBe('Net Skins');
    expect(ruleLabel('greenie')).toBe('Greenies');
    expect(ruleLabel('polie')).toBe('Polies');
    expect(ruleLabel('sandie')).toBe('Sandies');
    expect(ruleLabel('mystery')).toBe('mystery');
  });
});
