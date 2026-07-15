import { describe, it, expect } from 'vitest';
import { emphasisGain } from '../src/tts/emphasis';

describe('emphasisGain — "louder when ! or UPPERCASE"', () => {
  it('normal text -> no gain (1.0)', () => {
    expect(emphasisGain('ola tudo bem contigo')).toBe(1);
    expect(emphasisGain('')).toBe(1);
  });

  it('one "!" -> soft gain (>1, <strong)', () => {
    const g = emphasisGain('cuidado!');
    expect(g).toBeGreaterThan(1);
    expect(g).toBeLessThan(emphasisGain('cuidado!!'));
  });

  it('one UPPERCASE word -> soft gain', () => {
    expect(emphasisGain('PARA quieto')).toBeGreaterThan(1);
  });

  it('UPPERCASE alone counts as one "!" (same soft gain)', () => {
    // Diogo's request: also shout ALL-UPPERCASE words, at the level of a `!`.
    expect(emphasisGain('PARA quieto')).toBe(emphasisGain('para quieto!'));
  });

  it('"!!" or more -> strong gain', () => {
    expect(emphasisGain('vamos!!')).toBe(emphasisGain('boaaa!!!'));
    expect(emphasisGain('vamos!!')).toBeGreaterThan(emphasisGain('vamos!'));
  });

  it('UPPERCASE + "!" -> strong gain (combines both signals)', () => {
    expect(emphasisGain('PARA!')).toBe(emphasisGain('vamos!!'));
  });

  it('gain has a ceiling (never goes above strong, avoids clipping)', () => {
    expect(emphasisGain('SOCORRO!!!!!')).toBe(emphasisGain('vamos!!'));
  });

  it('is STABLE across calls (shout regex is not global/stateful)', () => {
    // Two consecutive calls with the SAME input must give the SAME result
    // (guard against shared lastIndex if the regex were /g).
    expect(emphasisGain('GRITA')).toBe(emphasisGain('GRITA'));
    expect(emphasisGain('calmo')).toBe(1);
    expect(emphasisGain('GRITA')).toBeGreaterThan(1);
  });

  it('a single capital letter (sentence start) does NOT count as a shout', () => {
    expect(emphasisGain('Ola pessoal')).toBe(1);
  });
});
