import { describe, it, expect } from 'vitest';
import { detectLang } from '../src/language/detect';
import { pickVoice } from '../src/language/voiceMap';

describe('detectLang', () => {
  it('deteta portugues numa frase longa', () => {
    const lang = detectLang(
      'Ola a todos, hoje vamos falar sobre o tempo que esta a fazer aqui na nossa cidade durante esta semana.'
    );
    expect(lang).toBe('por');
  });

  it('deteta ingles numa frase longa', () => {
    const lang = detectLang(
      'Hello everyone, today we are going to talk about the weather we are having here in our city during this week.'
    );
    expect(lang).toBe('eng');
  });

  it('devolve "" para texto vazio', () => {
    expect(detectLang('')).toBe('');
  });

  it('devolve "" para texto so com espacos', () => {
    expect(detectLang('   ')).toBe('');
  });

  it('devolve "" ou um codigo para texto muito curto (nunca rebenta)', () => {
    const lang = detectLang('oi');
    expect(typeof lang).toBe('string');
  });
});

describe('pickVoice', () => {
  const available = ['pt_PT-tugao-medium', 'en_US-amy-medium', 'es_ES-davefx-medium'];
  const fallback = 'en_US-amy-medium';

  it('escolhe voz portuguesa para "por"', () => {
    expect(pickVoice('por', available, fallback)).toBe('pt_PT-tugao-medium');
  });

  it('escolhe voz inglesa para "eng"', () => {
    expect(pickVoice('eng', available, fallback)).toBe('en_US-amy-medium');
  });

  it('escolhe voz espanhola para "spa"', () => {
    expect(pickVoice('spa', available, fallback)).toBe('es_ES-davefx-medium');
  });

  it('cai no fallback quando a lingua nao tem modelo', () => {
    expect(pickVoice('deu', available, fallback)).toBe(fallback);
  });

  it('cai no fallback quando lang e ""', () => {
    expect(pickVoice('', available, fallback)).toBe(fallback);
  });

  it('cai no fallback quando lang e desconhecida no mapa', () => {
    expect(pickVoice('xyz', available, fallback)).toBe(fallback);
  });
});
