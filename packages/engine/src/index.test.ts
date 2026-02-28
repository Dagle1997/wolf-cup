import { describe, it, expect } from 'vitest';
import * as engine from './index.js';

describe('engine', () => {
  it('module loads and exports an object', () => {
    expect(engine).toBeDefined();
    expect(typeof engine).toBe('object');
  });
});
