// The 30 objects the app teaches, on rotation.
// Each word has a "home" language (recorded in the parent's own voice where possible)
// and a "target" language (English). Swap the lang codes/text below to retarget
// the app at a different home language.
//
// emoji doubles as the "picture" the child taps — no photos needed, nothing to read.

const HOME_LANG = 'pt-BR';
const TARGET_LANG = 'en-US';

const WORDS = [
  { id: 'bola',      emoji: '⚽', home: 'bola',       target: 'ball' },
  { id: 'cachorro',  emoji: '🐶', home: 'cachorro',   target: 'dog' },
  { id: 'gato',      emoji: '🐱', home: 'gato',       target: 'cat' },
  { id: 'copo',      emoji: '🥤', home: 'copo',       target: 'cup' },
  { id: 'sapato',    emoji: '👟', home: 'sapato',     target: 'shoe' },
  { id: 'bone',      emoji: '🧢', home: 'boné',       target: 'hat' },
  { id: 'livro',     emoji: '📖', home: 'livro',      target: 'book' },
  { id: 'carro',     emoji: '🚗', home: 'carro',      target: 'car' },
  { id: 'banana',    emoji: '🍌', home: 'banana',     target: 'banana' },
  { id: 'maca',      emoji: '🍎', home: 'maçã',       target: 'apple' },
  { id: 'pato',      emoji: '🦆', home: 'pato',       target: 'duck' },
  { id: 'peixe',     emoji: '🐟', home: 'peixe',      target: 'fish' },
  { id: 'passaro',   emoji: '🐦', home: 'passarinho', target: 'bird' },
  { id: 'lua',       emoji: '🌙', home: 'lua',        target: 'moon' },
  { id: 'sol',       emoji: '☀️', home: 'sol',        target: 'sun' },
  { id: 'estrela',   emoji: '⭐', home: 'estrela',    target: 'star' },
  { id: 'flor',      emoji: '🌸', home: 'flor',       target: 'flower' },
  { id: 'arvore',    emoji: '🌳', home: 'árvore',     target: 'tree' },
  { id: 'ursinho',   emoji: '🧸', home: 'ursinho',    target: 'bear' },
  { id: 'cama',      emoji: '🛏️', home: 'cama',       target: 'bed' },
  { id: 'colher',    emoji: '🥄', home: 'colher',     target: 'spoon' },
  { id: 'mamadeira', emoji: '🍼', home: 'mamadeira',  target: 'bottle' },
  { id: 'porta',     emoji: '🚪', home: 'porta',      target: 'door' },
  { id: 'agua',      emoji: '💧', home: 'água',       target: 'water' },
  { id: 'leite',     emoji: '🥛', home: 'leite',      target: 'milk' },
  { id: 'biscoito',  emoji: '🍪', home: 'biscoito',   target: 'cookie' },
  { id: 'ovo',       emoji: '🥚', home: 'ovo',        target: 'egg' },
  { id: 'banho',     emoji: '🛁', home: 'banho',      target: 'bath' },
  { id: 'meia',      emoji: '🧦', home: 'meia',       target: 'sock' },
  { id: 'balao',     emoji: '🎈', home: 'balão',      target: 'balloon' },
];

// A cheerful color per card so the picture always sits on a friendly background.
const CARD_COLORS = [
  '#ff6b6b', '#f7b731', '#20bf6b', '#0fb9b1', '#2d98da',
  '#8854d0', '#eb3b5a', '#fa8231', '#e056fd', '#4b7bec',
  '#26de81', '#fed330', '#fc5c65', '#45aaf2', '#00b894',
];
