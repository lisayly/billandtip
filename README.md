# Palavras

A voice-only word app for a 1-year-old who can't read yet.

One big picture on the screen. She taps it, hears the word in Portuguese and
then in English, and the app listens while she says it back. No text, no menus,
no scores, no stars, no timers. Nothing to read and nothing to win.

It runs entirely on the phone with no connection, and makes zero network
requests of any kind — nothing about her ever leaves the device.

---

## How it works for her

- **Tap the picture** → hears the word (`bola`, then `ball`).
- **A soft halo pulses** → that's the only "your turn" cue. She says it back.
- **She gets it** → a little rising chime.
- **She misses** → a gentle, non-punishing two-note sound, then the word is
  quietly said again so she can hear it properly. She's never told off.
- **She says nothing** → nothing happens. No nagging, no retry prompt.
- **Swipe, or tap the left/right edge** → next picture.

The 30 objects rotate forever. Words she gets right quietly sink down the
rotation; words she misses quietly come back sooner. She never sees any of
this — there's no progress bar and no score anywhere in the app.

## How it works for you

Everything for grown-ups is behind one hidden gesture:

> **Press and hold the very top-right corner of the screen for 2.5 seconds.**

That opens parent mode, the only screen in the app with words on it. There you
can record your own voice for any word, hear what it currently sounds like,
delete a recording, and reset her progress. A green dot next to a word means
she's saying it back reliably; amber means she's still working on it.

### Recording your own voice

In parent mode, each word has two rows — 🇧🇷 Portuguese and 🇬🇧 English — and each
row has ● record, ▶ play, ✕ delete.

Tap ● , say the word, tap ■ to stop. That's it; it's saved on the phone.
Recording stops on its own after 5 seconds if you forget.

**Anything you don't record is spoken by the phone's built-in synthetic voice
automatically.** So you can record the Portuguese words in your own voice and
leave English to the synthesiser, or record whichever words you like in either
language, in any order. It always prefers, in this order:

1. your recording, then
2. a voice file bundled with the app (see `audio/README.txt` — useful if you'd
   rather record 60 words at a computer than on the phone), then
3. speech synthesis.

## Installing it on the Samsung

There's no build step and no app store. It's a web app that installs to the
home screen and then runs offline like any other app.

1. Put these files anywhere that serves them over `https` — GitHub Pages is the
   easiest: repo **Settings → Pages → Deploy from branch**, pick this branch,
   and you get a URL a minute later.
2. On the Samsung, open that URL in **Chrome** (Samsung Internet works too).
3. Menu **⋮ → Add to Home screen**.
4. Open it from the home-screen icon from then on — it launches fullscreen with
   no address bar for her to poke at.
5. Say yes to the microphone prompt the first time.
6. **Then turn the wifi off and open it again** to confirm it works offline. It
   should behave identically.

The `https` bit is not optional — microphone access and offline caching are both
blocked on plain `http`. Anything on `localhost` or a real `https` host is fine.

### Keeping the screen on and her inside the app

The app requests a screen wake-lock so it doesn't sleep mid-play. To stop her
escaping into the rest of the phone, turn on Android's **Screen pinning**
(Settings → Security → Advanced → Screen pinning), then pin the app from the
recents view. That's a system feature and far more reliable than anything a web
app can do by itself.

---

## The one honest limitation

Telling *whether she said the right word* needs speech recognition, and this is
where the offline requirement bites:

- **Offline (the normal case):** the browser's speech recognizer is unavailable
  — Chrome's implementation always calls Google's servers, and Android's offline
  dictation packs don't back it. So offline the app listens with on-device
  voice-activity detection: it can hear **that** she said something, but not
  **which** word. In that mode every attempt gets warm, neutral encouragement
  and is logged as "practised" — **it never tells her she's wrong when it
  couldn't actually check.** That was a deliberate call: a 1-year-old shouldn't
  be corrected by a guess.
- **When there is wifi:** the app quietly uses real recognition instead, matches
  her attempt generously in *either* language (`bola` or `ball` both count, and
  approximations like "bo" pass), and that's when the right/wrong tracking and
  the repetition weighting get real data. If the recognizer fails mid-session it
  falls back to the offline behaviour rather than scoring her wrong.

In practice: leave it offline for everyday play, and it'll pick up her real
progress on any day the wifi happens to be on. If you ever want true offline
word-level recognition, that needs an on-device model (Vosk has a ~50 MB
Portuguese one) — a much bigger build, and worth doing only if the wifi-day
tracking turns out not to be enough.

Also worth knowing: at 1, speech recognisers are unreliable on toddler speech no
matter who builds them. The matching here is deliberately generous for that
reason — the app is built to encourage imitation, not to grade pronunciation.

---

## Changing the words

`js/words.js` — 30 entries, each with an id, the picture (an emoji, so there are
no image files to manage and nothing to download), and the word in both
languages. Change the words, the pictures, or the languages there; `HOME_LANG`
and `TARGET_LANG` at the top set the two speech-synthesis voices.

If you edit any file, bump `CACHE` in `sw.js` (`palavras-v1` → `-v2`) so the
phones pick up the new version instead of the cached old one.

## Running and testing it locally

```bash
npm start          # serves on http://localhost:8899
npm test           # 24 end-to-end checks in a real browser
```

The test suite covers the things that actually matter here: that the child-facing
screen has no text on it, that a tap plays both languages and then listens, that
misses resurface early in the rotation and correct answers sink, that progress
survives a restart, that a short press doesn't open parent mode but a long one
does, that recording your voice overrides synthesis, that the app fully loads
with the network cut, and that a failing recognizer never reads as a wrong answer.
