import { describe, it, expect, vi } from 'vitest';
import { postTopggStats, startBotListUpdater } from '../src/botLists';

// Typed params (url, opts) for the typecheck: without them .mock.calls is an empty tuple.
// The mock is passed with the cast `as unknown as typeof fetch`, so opts can have the
// shape the test reads (method+headers+body).
function okFetch() {
  return vi.fn(
    async (
      _url: string,
      _opts: { method: string; headers: { Authorization: string }; body: string },
    ) => ({ ok: true, status: 200 }) as Response,
  );
}

describe('postTopggStats', () => {
  it('POST to the right endpoint with Authorization and server_count', async () => {
    const fetchImpl = okFetch();
    const ok = await postTopggStats('bot-123', 'tok-abc', 42, fetchImpl as unknown as typeof fetch);
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://top.gg/api/bots/bot-123/stats');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('tok-abc');
    expect(JSON.parse(opts.body)).toEqual({ server_count: 42 });
  });

  it('non-2xx HTTP -> false (does not throw)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }) as Response);
    const ok = await postTopggStats('b', 't', 1, fetchImpl as unknown as typeof fetch);
    expect(ok).toBe(false);
  });

  it('network error -> false (never throws)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const ok = await postTopggStats('b', 't', 1, fetchImpl as unknown as typeof fetch);
    expect(ok).toBe(false);
  });
});

describe('startBotListUpdater', () => {
  it('no token -> no-op (does not publish, stop() safe)', () => {
    const fetchImpl = okFetch();
    const stop = startBotListUpdater({
      botId: 'b',
      token: undefined,
      serverCount: () => 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setIntervalImpl: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: () => {},
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('with token -> publishes NOW and registers the interval; stop() cancels it', () => {
    const fetchImpl = okFetch();
    let intervalFn: (() => void) | null = null;
    const cleared: number[] = [];
    const stop = startBotListUpdater({
      botId: 'b',
      token: 'tok',
      serverCount: () => 7,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setIntervalImpl: (fn) => {
        intervalFn = fn;
        return 99 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalImpl: (h) => cleared.push(h as unknown as number),
    });
    // Immediate publish.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The interval tick publishes again with the CURRENT count.
    intervalFn!();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stop();
    expect(cleared).toEqual([99]);
  });
});
