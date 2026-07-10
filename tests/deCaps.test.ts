import { describe, it, expect } from 'vitest';
import { lowerAllCapsRuns } from '../src/tts/deCaps';

// A primitiva partilhada por gTTS (deCapsForGoogle) e aplicada no Kokoro/Clone/Neural,
// para um "grito" em MAIÚSCULAS não sair SOLETRADO. Os testes específicos do gTTS estão
// em gtts.test.ts (deCapsForGoogle delega aqui).
describe('lowerAllCapsRuns — baixa corridas de 2+ MAIÚSCULAS', () => {
  it('baixa corridas (2+), incluindo acentuadas', () => {
    expect(lowerAllCapsRuns('AJUDA')).toBe('ajuda');
    expect(lowerAllCapsRuns('olá AJUDA aqui')).toBe('olá ajuda aqui');
    expect(lowerAllCapsRuns('ÁGUA')).toBe('água');
  });

  it('deixa UMA maiúscula intacta (início de frase, "I", "A")', () => {
    expect(lowerAllCapsRuns('Ola pessoal')).toBe('Ola pessoal');
    expect(lowerAllCapsRuns('I am a Robot')).toBe('I am a Robot');
  });

  it('pontuação, dígitos e minúsculas ficam intactos', () => {
    expect(lowerAllCapsRuns('grita!!!')).toBe('grita!!!');
    expect(lowerAllCapsRuns('COVID19')).toBe('covid19');
    expect(lowerAllCapsRuns('')).toBe('');
  });
});
