import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/moderation/rateLimiter';

describe('RateLimiter', () => {
  it('permite ate perMin pedidos no mesmo instante', () => {
    const rl = new RateLimiter(3);
    const now = 1_000_000;
    expect(rl.allow('u1', now)).toBe(true);
    expect(rl.allow('u1', now)).toBe(true);
    expect(rl.allow('u1', now)).toBe(true);
  });

  it('bloqueia o pedido seguinte quando excede perMin', () => {
    const rl = new RateLimiter(3);
    const now = 1_000_000;
    rl.allow('u1', now);
    rl.allow('u1', now);
    rl.allow('u1', now);
    expect(rl.allow('u1', now)).toBe(false);
  });

  it('recarrega um token apos passar 60s/perMin', () => {
    const rl = new RateLimiter(3);
    const now = 1_000_000;
    rl.allow('u1', now);
    rl.allow('u1', now);
    rl.allow('u1', now);
    expect(rl.allow('u1', now)).toBe(false);
    // 60000ms / 3 = 20000ms por token recarregado
    const later = now + 20_000;
    expect(rl.allow('u1', later)).toBe(true);
    // sem mais tokens disponiveis no mesmo instante
    expect(rl.allow('u1', later)).toBe(false);
  });

  it('recarrega ate ao maximo perMin apos um minuto completo', () => {
    const rl = new RateLimiter(3);
    const now = 1_000_000;
    rl.allow('u1', now);
    rl.allow('u1', now);
    rl.allow('u1', now);
    const fullMinute = now + 60_000;
    expect(rl.allow('u1', fullMinute)).toBe(true);
    expect(rl.allow('u1', fullMinute)).toBe(true);
    expect(rl.allow('u1', fullMinute)).toBe(true);
    expect(rl.allow('u1', fullMinute)).toBe(false);
  });

  it('nao acumula tokens acima do limite mesmo apos muito tempo', () => {
    const rl = new RateLimiter(2);
    const now = 1_000_000;
    // muito tempo parado nao da mais que perMin
    const farFuture = now + 10_000_000;
    expect(rl.allow('u1', farFuture)).toBe(true);
    expect(rl.allow('u1', farFuture)).toBe(true);
    expect(rl.allow('u1', farFuture)).toBe(false);
  });

  it('isola buckets por userId', () => {
    const rl = new RateLimiter(1);
    const now = 1_000_000;
    expect(rl.allow('u1', now)).toBe(true);
    expect(rl.allow('u1', now)).toBe(false);
    expect(rl.allow('u2', now)).toBe(true);
    expect(rl.allow('u2', now)).toBe(false);
  });
});
