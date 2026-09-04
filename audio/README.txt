Optional voice files.

audio/home/    -> Portuguese, e.g. audio/home/bola.mp3
audio/target/  -> English,    e.g. audio/target/bola.mp3

The filename must be the word id from js/words.js (bola, cachorro, gato, ...),
NOT the word itself. After adding files, list the ids in manifest.json:

  { "ext": ".mp3", "home": ["bola", "gato"], "target": ["bola"] }

Recording straight into the app (parent mode) is easier and needs none of this.
