// tests/cache.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  utimesSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKey, AudioCache } from '../src/tts/cache';
import type { SynthRequest } from '../src/tts/engine';

// Guarda a implementacao REAL de unlinkSync para a poder repor no afterEach (mockReset
// limpa tambem a impl default). `vi.hoisted` corre antes do factory de vi.mock, por
// isso a ref esta disponivel dentro dele.
const realFs = vi.hoisted(() => {
  const actual = require('node:fs') as typeof import('node:fs');
  return { unlinkSync: actual.unlinkSync };
});

// Mock de node:fs que MANTEM as implementacoes reais (spread `...actual`) e apenas
// envolve `readdirSync`/`unlinkSync` em spies. `readdirSync` e espiado para CONTAR
// chamadas (prova de que o evict() em memoria ja nao faz directory scan no hot path —
// plano 020); `unlinkSync` e forcado a lancar num teste especifico (ficheiro ja
// removido fora do processo). Os restantes testes com fs REAL continuam verdes.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: vi.fn(actual.readdirSync),
    unlinkSync: vi.fn(actual.unlinkSync),
  };
});

describe('cacheKey', () => {
  const base: SynthRequest = { text: 'ola mundo', model: 'pt_PT', speed: 1 };

  it('e estavel: mesma request -> mesma chave', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base }));
  });

  it('e um hash sha1 hex (40 chars)', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('muda quando o texto muda', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, text: 'outro texto' }));
  });

  it('muda quando o model muda', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, model: 'en_US' }));
  });

  it('muda quando a speed muda', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, speed: 1.5 }));
  });

  it('nao confunde fronteiras de campos (text vs model)', () => {
    // 'ab' + 'c' nao deve colidir com 'a' + 'bc'
    const a: SynthRequest = { text: 'ab', model: 'c', speed: 1 };
    const b: SynthRequest = { text: 'a', model: 'bc', speed: 1 };
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it('does not collide on field boundaries', () => {
    const a = cacheKey({ text: 'a b', model: 'c', speed: 1 });
    const b = cacheKey({ text: 'a', model: 'b c', speed: 1 });
    expect(a).not.toBe(b);
  });

  // ── leadSilenceMs: PREPEND de silencio afeta o audio -> tem de afetar a chave ──
  it('muda quando leadSilenceMs muda', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, leadSilenceMs: 2000 }));
  });

  it('back-compat: leadSilenceMs undefined vs 0 -> MESMA chave (e igual a sem silencio)', () => {
    const noField = cacheKey(base); // leadSilenceMs undefined
    const zero = cacheKey({ ...base, leadSilenceMs: 0 });
    expect(zero).toBe(noField);
  });

  it('valores distintos de leadSilenceMs -> chaves distintas', () => {
    expect(cacheKey({ ...base, leadSilenceMs: 1000 })).not.toBe(
      cacheKey({ ...base, leadSilenceMs: 2000 }),
    );
  });
});

describe('AudioCache', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it('get devolve null para chave inexistente', () => {
    const cache = new AudioCache(dir);
    expect(cache.get('naoexiste')).toBeNull();
  });

  it('put SOBREVIVE à pasta ser apagada em runtime (regressão: purge do /voice clone delete)', () => {
    // O purge de privacidade apaga audio-cache/clone/ INTEIRA em runtime; o constructor
    // só faz mkdir uma vez. Sem o mkdir no put(), toda a síntese desse namespace caía
    // em ENOENT (fallback à voz normal) até ao próximo restart — o bug real de produção.
    const cache = new AudioCache(dir).withNamespace('clone');
    const src = join(srcDir, 'clonado.wav');
    writeFileSync(src, Buffer.from('RIFFclone'));
    rmSync(join(dir, 'clone'), { recursive: true, force: true }); // simula o purge
    const stored = cache.put('chave-pos-purge', src);
    expect(existsSync(stored)).toBe(true);
    expect(readFileSync(stored).toString()).toBe('RIFFclone');
  });

  it('put copia o ficheiro para o dir e devolve o caminho; get devolve-o depois', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'gerado.wav');
    writeFileSync(src, Buffer.from('RIFFfakewav'));

    const stored = cache.put('chave1', src);

    expect(existsSync(stored)).toBe(true);
    expect(stored).toBe(join(dir, 'chave1.wav'));
    expect(readFileSync(stored).toString()).toBe('RIFFfakewav');
    expect(cache.get('chave1')).toBe(stored);
  });

  it('put nao apaga o ficheiro de origem (copia, nao move)', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'gerado.wav');
    writeFileSync(src, Buffer.from('dados'));

    cache.put('chave2', src);

    expect(existsSync(src)).toBe(true);
  });

  it('cria o dir se nao existir', () => {
    const nested = join(dir, 'sub', 'cache');
    const cache = new AudioCache(nested);
    const src = join(srcDir, 'g.wav');
    writeFileSync(src, Buffer.from('x'));
    const stored = cache.put('k', src);
    expect(existsSync(stored)).toBe(true);
  });

  // Bug-hunt 2026-07: put() escrevia com copyFileSync direto para o path final, por
  // isso um get() concorrente podia servir um .wav truncado a meio da cópia. Agora
  // escreve via tmp + renameSync (atómico). Verifica que não fica lixo .tmp e que
  // put sobre uma chave existente é idempotente (não corrompe).
  it('put é atómico: não deixa ficheiros .tmp no dir', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'a.wav');
    writeFileSync(src, Buffer.from('RIFFdados'));
    cache.put('chaveA', src);
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
    expect(existsSync(join(dir, 'chaveA.wav'))).toBe(true);
  });

  it('put sobre uma chave já existente é idempotente (devolve o path, conteúdo intacto)', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'b.wav');
    writeFileSync(src, Buffer.from('RIFFprimeiro'));
    const first = cache.put('chaveB', src);
    // segundo put da mesma chave (conteúdo determinístico) — devolve o mesmo path.
    const second = cache.put('chaveB', src);
    expect(second).toBe(first);
    expect(readFileSync(first).toString()).toBe('RIFFprimeiro');
    expect(readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});

describe('AudioCache.withNamespace', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-ns-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-ns-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it('namespaces diferentes resolvem para subdiretorios distintos', () => {
    const base = new AudioCache(dir);
    const piper = base.withNamespace('piper');
    const neural = base.withNamespace('neural');

    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('audio'));

    const piperPath = piper.put('chave', src);
    const neuralPath = neural.put('chave', src);

    expect(piperPath).toContain('piper');
    expect(neuralPath).toContain('neural');
    expect(piperPath).not.toBe(neuralPath);
  });

  it('hit num namespace nao e visivel no outro (sem cross-contamination)', () => {
    const base = new AudioCache(dir);
    const piper = base.withNamespace('piper');
    const neural = base.withNamespace('neural');

    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('audio'));

    piper.put('chave', src);

    // 'neural' nao tem a chave — nao deve encontrar o ficheiro do 'piper'
    expect(neural.get('chave')).toBeNull();
  });

  it('mesma chave em namespaces diferentes nao colide — cada um le o seu proprio ficheiro', () => {
    // cacheKey seria identico para a mesma SynthRequest, mas o dir e diferente
    const base = new AudioCache(dir);
    const piper = base.withNamespace('piper');
    const neural = base.withNamespace('neural');

    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('audio-piper'));

    const src2 = join(srcDir, 'out2.wav');
    writeFileSync(src2, Buffer.from('audio-neural'));

    piper.put('abc123', src);
    neural.put('abc123', src2);

    // Cada namespace le o seu proprio ficheiro
    expect(piper.get('abc123')).toBeTruthy();
    expect(neural.get('abc123')).toBeTruthy();
    expect(piper.get('abc123')).not.toBe(neural.get('abc123'));
  });

  it('withNamespace cria o subdiretorio automaticamente', () => {
    const base = new AudioCache(dir);
    const ns = base.withNamespace('someengine');
    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('x'));
    const stored = ns.put('k', src);
    expect(existsSync(stored)).toBe(true);
  });

  it('withNamespace herda o maxFiles do pai', () => {
    const base = new AudioCache(dir, 2);
    const ns = base.withNamespace('eng');
    // Escreve 3 ficheiros; o mais antigo deve ser removido
    const t0 = new Date(Date.now() - 3000);
    const t1 = new Date(Date.now() - 2000);
    const t2 = new Date(Date.now() - 1000);

    const makeWav = (name: string) => {
      const p = join(srcDir, name);
      writeFileSync(p, Buffer.from('x'));
      return p;
    };

    const s0 = makeWav('a.wav');
    const s1 = makeWav('b.wav');
    const s2 = makeWav('c.wav');

    const p0 = ns.put('key0', s0);
    utimesSync(p0, t0, t0);
    const p1 = ns.put('key1', s1);
    utimesSync(p1, t1, t1);
    // Terceiro put deve desencadear eviction de key0
    ns.put('key2', s2);
    utimesSync(join(ns['dir'], 'key2.wav'), t2, t2);

    const remaining = readdirSync(ns['dir']).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(2);
    // key0 (mais antigo) foi removido
    expect(existsSync(p0)).toBe(false);
  });
});

describe('AudioCache eviction (maxFiles)', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-evict-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-evict-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  function makeSrc(name: string, content = 'wav'): string {
    const p = join(srcDir, name);
    writeFileSync(p, Buffer.from(content));
    return p;
  }

  it('abaixo do cap: nenhum ficheiro e removido', () => {
    const cache = new AudioCache(dir, 5);
    for (let i = 0; i < 5; i++) {
      cache.put(`k${i}`, makeSrc(`f${i}.wav`));
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(files.length).toBe(5);
  });

  it('ao exceder o cap, os mais antigos sao removidos', () => {
    const cache = new AudioCache(dir, 3);
    const now = Date.now();

    // Escreve 3 ficheiros com mtimes determinísticos (antigos)
    const paths: string[] = [];
    for (let i = 0; i < 3; i++) {
      const dest = cache.put(`old${i}`, makeSrc(`old${i}.wav`));
      const t = new Date(now - (3 - i) * 1000); // old0 mais antigo
      utimesSync(dest, t, t);
      paths.push(dest);
    }

    // 4.º put excede o cap (cap=3): deve remover o mais antigo (old0)
    const newest = cache.put('new0', makeSrc('new0.wav'));

    const remaining = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(3);
    expect(existsSync(paths[0])).toBe(false); // old0 removido
    expect(existsSync(newest)).toBe(true); // recém-escrito nunca e removido
  });

  it('ao exceder por mais de 1, remove todos os excedentes mais antigos', () => {
    const cache = new AudioCache(dir, 2);
    const now = Date.now();

    // Escreve 4 ficheiros com mtimes espaçados
    const p: string[] = [];
    for (let i = 0; i < 4; i++) {
      const dest = cache.put(`k${i}`, makeSrc(`f${i}.wav`));
      utimesSync(dest, new Date(now - (4 - i) * 2000), new Date(now - (4 - i) * 2000));
      p.push(dest);
    }
    // Após 4 puts com cap=2, o diretório deve ter no máximo 2 ficheiros
    const remaining = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(2);
    // O mais recente (k3) deve sobreviver
    expect(existsSync(p[3])).toBe(true);
  });

  it('o ficheiro recem-escrito nunca e evicted mesmo com cap=1', () => {
    const cache = new AudioCache(dir, 1);
    const now = Date.now();

    // Escreve ficheiro antigo
    const old = cache.put('old', makeSrc('old.wav'));
    utimesSync(old, new Date(now - 5000), new Date(now - 5000));

    // 2.º put excede cap: old deve ir, new deve ficar
    const newest = cache.put('new', makeSrc('new.wav'));
    expect(existsSync(newest)).toBe(true);
    expect(existsSync(old)).toBe(false);
  });

  it('maxFiles=0 desativa eviction (sem remocoes)', () => {
    const cache = new AudioCache(dir, 0);
    for (let i = 0; i < 10; i++) {
      cache.put(`k${i}`, makeSrc(`f${i}.wav`));
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(files.length).toBe(10);
  });

  // Plano 020: a ordem de evicção passa a vir de um índice LRU em memória (ordem de
  // inserção/acesso), não do mtime em disco — get() já não faz utimesSync.
  it('get() refresca a chave acedida: a evicção passa a apanhar a SEGUNDA mais antiga', () => {
    // maxFiles=3: a, b, c cabem sem evict. get('a') refresca 'a' para o fim do
    // índice (mais recente). O 4.º put ('d') excede o cap -> despeja o mais antigo
    // do índice, que passa a ser 'b' (não 'a') — prova que a ordem vem do acesso via
    // índice, não de um mtime em disco que já não é tocado.
    const cache = new AudioCache(dir, 3);
    const a = cache.put('a', makeSrc('a.wav'));
    const b = cache.put('b', makeSrc('b.wav'));
    const c = cache.put('c', makeSrc('c.wav'));

    expect(cache.get('a')).toBe(a); // hit -> refresca 'a' para o fim do índice

    const d = cache.put('d', makeSrc('d.wav'));

    expect(existsSync(a)).toBe(true); // 'a' sobrevive (foi refrescada pelo get)
    expect(existsSync(b)).toBe(false); // 'b' é agora a mais antiga -> evicted
    expect(existsSync(c)).toBe(true);
    expect(existsSync(d)).toBe(true); // recém-escrito nunca é evicted
  });
});

// ── ramos defensivos do evict ─────────────────────────────────────────────────
// Plano 020: o evict() deixou de fazer directory scan (readdirSync/statSync) — a
// ordem vive num índice LRU em memória. Os ramos defensivos que SOBRAM são: o
// unlinkSync a falhar (ficheiro já removido fora do processo) e o guard contra
// drift entre `count`/`lru` (não deveria acontecer em uso normal — ver notas de
// manutenção do plano — mas o loop tem de TERMINAR em vez de correr para sempre).
describe('AudioCache.evict — ramos defensivos', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-def-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-def-'));
  });

  afterEach(() => {
    // Repoe a implementacao REAL (limpa qualquer mockImplementationOnce pendente)
    // para nao contaminar testes seguintes.
    vi.mocked(unlinkSync).mockReset();
    vi.mocked(unlinkSync).mockImplementation(realFs.unlinkSync as never);
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  function makeSrc(name: string, content = 'wav'): string {
    const p = join(srcDir, name);
    writeFileSync(p, Buffer.from(content));
    return p;
  }

  it('unlinkSync a falhar (ficheiro já removido fora do processo): evict não crasha', () => {
    // cap=1 força eviccao no 2.º put. O unlinkSync do ficheiro antigo lanca (ex.:
    // outro processo já o apagou) — o catch e best-effort e tem de engolir o erro.
    const cache = new AudioCache(dir, 1);

    const old = cache.put('old', makeSrc('old.wav'));

    vi.mocked(unlinkSync).mockImplementationOnce(() => {
      throw new Error('ENOENT: unlinkSync falhou');
    });

    expect(() => cache.put('new', makeSrc('new.wav'))).not.toThrow();

    // O recém-escrito sobrevive sempre. `old` continua fisicamente em disco (o
    // unlinkSync mockado nunca chegou a apagá-lo de facto) — o catch engoliu o erro
    // e o índice segue em frente na mesma (best-effort).
    expect(existsSync(join(dir, 'new.wav'))).toBe(true);
    expect(existsSync(old)).toBe(true);
  });

  it('drift entre count e lru: evict para quando só sobra o recém-escrito (sem loop infinito)', () => {
    // Em uso normal `count` e `lru.size` andam sempre em lockstep (ver notas de
    // manutenção do plano 020). Este teste simula uma corrupção artificial desse
    // invariante — acesso a campos privados via bracket notation, o mesmo padrão já
    // usado nesta suite (ex. `ns['dir']`) — para provar que o loop do evict()
    // TERMINA em vez de correr para sempre quando não há candidato para além do
    // próprio justWritten.
    const cache = new AudioCache(dir, 1);
    const dest = cache.put('unico', makeSrc('unico.wav'));

    // Força count > maxFiles sem que o índice tenha mais nenhuma chave além de `dest`.
    (cache as unknown as { count: number }).count = 5;

    expect(() =>
      (cache as unknown as { evict: (justWritten: string) => void }).evict(dest),
    ).not.toThrow();
    // Sem candidato para remover, o `count` fica tal como estava — não desce sozinho.
    expect((cache as unknown as { count: number }).count).toBe(5);
  });
});

describe('AudioCache contador em memória', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-count-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-count-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  function makeSrc(name: string, content = 'wav'): string {
    const p = join(srcDir, name);
    writeFileSync(p, Buffer.from(content));
    return p;
  }

  it('nunca faz readdir fora do arranque (índice LRU em memória) — nem abaixo nem acima do cap', () => {
    // Plano 020: evict() passou a despejar a partir do índice LRU em memória, sem
    // directory scan. Antes deste plano, cruzar o cap acionava ~1 readdir por put;
    // agora e SEMPRE zero (só o scan do construtor faz readdir, uma única vez).
    const cache = new AudioCache(dir, 5);
    vi.mocked(readdirSync).mockClear(); // o scan do constructor não conta para o teste
    for (let i = 0; i < 4; i++) cache.put(`k${i}`, makeSrc(`f${i}.wav`));
    // 4 puts <= cap 5 -> ZERO readdir.
    expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
    // 6.º e 7.º put cruzam o cap -> evicção via índice em memória, continua SEM readdir.
    cache.put('k4', makeSrc('f4.wav'));
    cache.put('k5', makeSrc('f5.wav'));
    expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav')).length).toBeLessThanOrEqual(5);
  });

  it('warm start: apanha os ficheiros pré-existentes e despeja no 1.º put', () => {
    // 3 ficheiros já no dir ANTES de construir a cache (cap 3).
    for (let i = 0; i < 3; i++) writeFileSync(join(dir, `pre${i}.wav`), Buffer.from('x'));
    const cache = new AudioCache(dir, 3);
    cache.put('novo', makeSrc('novo.wav')); // 3 pré + 1 = 4 > cap -> despeja 1
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav')).length).toBeLessThanOrEqual(3);
  });

  it('purge da pasta em runtime ZERA o contador (não despeja indevidamente a seguir)', () => {
    const cache = new AudioCache(dir, 3);
    for (let i = 0; i < 3; i++) cache.put(`a${i}`, makeSrc(`a${i}.wav`));
    rmSync(dir, { recursive: true, force: true }); // simula o purge de privacidade
    // 3 puts de chaves NOVAS: se o contador tivesse ficado em 3, o 1.º cruzava o cap
    // e despejava; com o reset a 0, os 3 sobrevivem.
    for (let i = 0; i < 3; i++) cache.put(`b${i}`, makeSrc(`b${i}.wav`));
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav')).length).toBe(3);
  });

  it('purge da pasta em runtime limpa também o índice LRU (evicção pós-purge só vê as chaves novas)', () => {
    // Plano 020: sem o `this.lru.clear()` no ramo de dir-recriado, as chaves
    // antigas (a0/a1, já inexistentes em disco) ficavam "presas" no índice à
    // frente das novas. Na próxima evicção, o evict() apanhava-as a ELAS primeiro
    // (unlink falha em silêncio, count-- na mesma) em vez das chaves b* reais —
    // o cap furava-se (o dir ficava com MAIS ficheiros do que maxFiles).
    const cache = new AudioCache(dir, 2);
    cache.put('a0', makeSrc('a0.wav'));
    cache.put('a1', makeSrc('a1.wav'));
    rmSync(dir, { recursive: true, force: true }); // simula o purge de privacidade

    cache.put('b0', makeSrc('b0.wav'));
    cache.put('b1', makeSrc('b1.wav'));
    const b2 = cache.put('b2', makeSrc('b2.wav')); // 3.º put pós-purge excede o cap=2

    const remaining = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(2);
    expect(existsSync(b2)).toBe(true); // o recém-escrito nunca é evicted
  });

  it('re-escrever a MESMA chave não conta a dobrar', () => {
    const cache = new AudioCache(dir, 2);
    cache.put('k1', makeSrc('k1.wav'));
    cache.put('k1', makeSrc('k1b.wav')); // mesma chave -> exists-first, não conta
    vi.mocked(readdirSync).mockClear();
    cache.put('k2', makeSrc('k2.wav')); // 2 ficheiros <= cap 2 -> sem readdir/evicção
    expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'k1.wav'))).toBe(true);
    expect(existsSync(join(dir, 'k2.wav'))).toBe(true);
  });
});
