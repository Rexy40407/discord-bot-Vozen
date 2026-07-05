import { describe, it, expect } from 'vitest';
import { applyPersona, isPersona, PERSONAS, PERSONA_CHOICES } from '../src/textCleaning/personas';

describe('isPersona / PERSONAS', () => {
  it('aceita as personas conhecidas e rejeita lixo', () => {
    expect(isPersona('pirate')).toBe(true);
    expect(isPersona('none')).toBe(true);
    expect(isPersona('banana')).toBe(false);
    expect(isPersona('')).toBe(false);
  });

  it('cada choice tem um value que é uma persona válida', () => {
    for (const c of PERSONA_CHOICES) expect(PERSONAS).toContain(c.value);
  });
});

describe('applyPersona — none e desconhecida', () => {
  it("'none' devolve o texto tal e qual", () => {
    expect(applyPersona('hello there my friend', 'none')).toBe('hello there my friend');
  });
});

describe('applyPersona — pirate', () => {
  it('substitui palavras comuns por termos de pirata (palavra completa)', () => {
    expect(applyPersona('hello my friend, are you here', 'pirate')).toBe('ahoy me matey, be ye here');
  });
  it('não parte substrings (yes só como palavra)', () => {
    // "eyes" contém "yes" mas não deve mudar.
    expect(applyPersona('my eyes', 'pirate')).toBe('me eyes');
  });
});

describe('applyPersona — cowboy', () => {
  it('substitui saudações e pronomes', () => {
    expect(applyPersona('hello friend, my yes', 'cowboy')).toBe('howdy partner, mah yep');
  });
});

describe('applyPersona — medieval', () => {
  it('substitui por termos arcaicos', () => {
    expect(applyPersona('you are my friend', 'medieval')).toBe('thou art mine friend');
  });
});

describe('applyPersona — uwu', () => {
  it('troca r/l por w e n+vogal por ny', () => {
    expect(applyPersona('really lovely', 'uwu')).toBe('weawwy wovewy');
    expect(applyPersona('no problem', 'uwu')).toBe('nyo pwobwem');
  });
  it('preserva maiúsculas nas letras trocadas', () => {
    expect(applyPersona('Rawr Loud', 'uwu')).toBe('Waww Woud');
  });
});

describe('applyPersona — yoda', () => {
  it('inverte a ordem das metades quando há >= 4 palavras', () => {
    expect(applyPersona('the force is strong', 'yoda')).toBe('is strong the force');
  });
  it('com < 4 palavras devolve igual', () => {
    expect(applyPersona('hello there', 'yoda')).toBe('hello there');
  });
});
