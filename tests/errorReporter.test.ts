import { describe, it, expect, vi } from 'vitest';
import { createErrorReporter, formatErrorMessage } from '../src/errorReporter';

function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 204 }) as Response);
}

describe('formatErrorMessage', () => {
  it('inclui o contexto e o stack num code block', () => {
    const msg = formatErrorMessage(new Error('boom'), 'gateway');
    expect(msg).toContain('gateway');
    expect(msg).toContain('boom');
    expect(msg).toContain('```');
  });

  it('trunca conteúdos gigantes para caber no limite do Discord', () => {
    const big = new Error('x'.repeat(5000));
    const msg = formatErrorMessage(big, 'ctx');
    expect(msg.length).toBeLessThanOrEqual(1900);
  });
});

describe('createErrorReporter', () => {
  it('sem url -> no-op (não faz fetch)', async () => {
    const fetchImpl = okFetch();
    const r = createErrorReporter(undefined, fetchImpl as unknown as typeof fetch);
    expect(await r.report(new Error('e'), 'ctx')).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('com url -> envia POST ao webhook com content', async () => {
    const fetchImpl = okFetch();
    const r = createErrorReporter('https://discord.com/api/webhooks/x', fetchImpl as unknown as typeof fetch);
    expect(await r.report(new Error('boom'), 'gateway')).toBe(true);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://discord.com/api/webhooks/x');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).content).toContain('boom');
  });

  it('DEDUP: o mesmo erro só é enviado UMA vez', async () => {
    const fetchImpl = okFetch();
    const r = createErrorReporter('https://wh', fetchImpl as unknown as typeof fetch);
    const err = new Error('repetido');
    await r.report(err, 'ctx');
    await r.report(err, 'ctx');
    await r.report(err, 'ctx');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 2ª e 3ª suprimidas
  });

  it('erros DIFERENTES são ambos enviados', async () => {
    const fetchImpl = okFetch();
    const r = createErrorReporter('https://wh', fetchImpl as unknown as typeof fetch);
    await r.report(new Error('um'), 'ctx');
    await r.report(new Error('dois'), 'ctx');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falha de rede -> false, nunca lança', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const r = createErrorReporter('https://wh', fetchImpl as unknown as typeof fetch);
    expect(await r.report(new Error('e'), 'ctx')).toBe(false);
  });
});
