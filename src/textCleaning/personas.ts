// Personas de fala: transformam o TEXTO antes da síntese para o Voxi ler as mensagens
// de uma pessoa com um "sotaque"/estilo divertido (pirata, uwu, Yoda, cowboy, medieval).
// É uma escolha POR-(guild,user), como o /voice nickname: aplica-se às mensagens dessa
// pessoa quando o Voxi as lê (auto-read + /tts). NÃO toca em /joke, /laugh, saudações
// nem jogos (esses constroem o áudio à parte). São transformações de PALAVRAS/estrutura
// — o TTS ignora maiúsculas, por isso "gritar"/aLtErNaDo não fariam diferença sonora e
// ficaram de fora. Só entram personas que MUDAM MESMO o que se ouve. Tudo PURO.

export type Persona = 'none' | 'pirate' | 'uwu' | 'yoda' | 'cowboy' | 'medieval';

/** Todas as personas (a ordem é a das choices do /voice persona). */
export const PERSONAS: readonly Persona[] = ['none', 'pirate', 'uwu', 'yoda', 'cowboy', 'medieval'];

export function isPersona(s: string): s is Persona {
  return (PERSONAS as readonly string[]).includes(s);
}

/** Choices (label legível + valor) do /voice persona. */
export const PERSONA_CHOICES: { name: string; value: Persona }[] = [
  { name: 'None (normal)', value: 'none' },
  { name: '🏴‍☠️ Pirate', value: 'pirate' },
  { name: '🥺 UwU', value: 'uwu' },
  { name: '🧙 Yoda', value: 'yoda' },
  { name: '🤠 Cowboy', value: 'cowboy' },
  { name: '⚔️ Medieval', value: 'medieval' },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Substitui palavras COMPLETAS (fronteiras unicode, case-insensitive) segundo um
 * dicionário. Mantém a ordem do texto; palavras fora do dicionário ficam intactas. Não
 * preserva a capitalização original da palavra substituída (o TTS ignora maiúsculas, por
 * isso é irrelevante para o som). PURA.
 */
function replaceWords(text: string, dict: Record<string, string>): string {
  let out = text;
  for (const [from, to] of Object.entries(dict)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(from)}(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(pattern, to);
  }
  return out;
}

// Dicionários English-centric: numa frase inglesa acertam em palavras comuns
// (you/my/is/are/yes/no...) por isso quase toda a frase muda audivelmente. Em texto
// noutra língua a maioria não acerta -> quase no-op (seguro, não parte nada).
const PIRATE: Record<string, string> = {
  hi: 'ahoy', hello: 'ahoy', hey: 'ahoy',
  my: 'me', you: 'ye', your: 'yer', "you're": 'ye be',
  is: 'be', are: 'be', am: 'be',
  yes: 'aye', yeah: 'aye', no: 'nay',
  friend: 'matey', friends: 'mateys',
  money: 'booty', stop: 'avast', drink: 'grog', wow: 'arr', dog: 'sea dog',
};

const COWBOY: Record<string, string> = {
  hi: 'howdy', hello: 'howdy', hey: 'howdy',
  you: 'ya', your: 'yer', my: 'mah',
  friend: 'partner', friends: 'partners',
  yes: 'yep', yeah: 'yep', no: 'nope',
  "isn't": "ain't", "aren't": "ain't", "not": 'not',
  going: "goin'", buddy: 'partner', guys: 'folks',
};

const MEDIEVAL: Record<string, string> = {
  hi: 'hail', hello: 'hail', hey: 'hail',
  you: 'thou', your: 'thy', yours: 'thine',
  are: 'art', my: 'mine', yes: 'aye', no: 'nay',
  here: 'hither', there: 'thither', why: 'wherefore', before: 'ere', over: "o'er",
  friend: 'friend', sir: 'my liege',
};

/** uwu: r/l -> w e "n"+vogal -> "ny" (fala de bebé). Preserva a capitalização das letras. */
function uwuify(text: string): string {
  return text
    .replace(/r/g, 'w')
    .replace(/l/g, 'w')
    .replace(/R/g, 'W')
    .replace(/L/g, 'W')
    .replace(/n([aeiou])/g, 'ny$1')
    .replace(/N([aeiouAEIOU])/g, 'Ny$1');
}

/**
 * Yoda: inverte a ordem — a 2.ª metade das palavras vem primeiro ("the force is strong"
 * -> "is strong the force"). Com < 4 palavras não há inversão que se note, devolve igual.
 */
function yodaify(text: string): string {
  const words = text.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length < 4) return text;
  const mid = Math.ceil(words.length / 2);
  return [...words.slice(mid), ...words.slice(0, mid)].join(' ');
}

/**
 * Aplica a persona a um texto a sintetizar. 'none' (ou desconhecida) devolve o texto tal
 * e qual. Só transforma o QUE se ouve; corre DEPOIS da deteção de língua (o chamador
 * aplica no fim), por isso não afeta a escolha de voz. PURA.
 */
export function applyPersona(text: string, persona: Persona): string {
  switch (persona) {
    case 'pirate':
      return replaceWords(text, PIRATE);
    case 'cowboy':
      return replaceWords(text, COWBOY);
    case 'medieval':
      return replaceWords(text, MEDIEVAL);
    case 'uwu':
      return uwuify(text);
    case 'yoda':
      return yodaify(text);
    default:
      return text;
  }
}
