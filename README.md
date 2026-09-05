# Palavras

A voice-only word app for a 1-year-old who can't read yet.

One big picture on the screen. She taps it, hears the word **in English**, and
the app listens while she says it back. No text, no menus, no scores, no stars,
no timers. Nothing to read and nothing to win.

Built for **iPhone/iPad** — it installs to the home screen and runs offline.

It runs entirely on the phone with no connection, and makes zero network
requests of any kind — nothing about her ever leaves the device.

---

## How it works for her

- **Tap the picture** → hears the word (`ball`).
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

Her voice is what the app reaches for first, for every word. There are two ways
to put it there.

**The whole set in one sitting** — the red button at the top of parent mode,
*Gravar todas as palavras com a sua voz*. It shows one word at a time with its
picture: tap the big button, say the word, tap to stop, and it saves and moves
to the next one by itself. *Pular* skips a word, *Ouvir* plays back what's there
now, *Sair* leaves — everything recorded so far is kept. Words you've already
done are marked "✓ já gravada", so you can start, stop, and come back later.

**One word at a time** — each word in the list below has ● record, ▶ play,
✕ delete. Good for redoing a single word that didn't come out well.

Either way: tap ●, say the word, tap ■ to stop. It's saved straight onto the
phone. Recording stops on its own after 5 seconds if you forget.

Each word shows one row — 🇬🇧 English, the language she hears. The Portuguese word
is shown alongside so you can find the object quickly; it is never played to her.

**Anything you don't record is spoken by the phone's built-in synthetic voice
automatically.** So record the words you're happy saying in English and leave the
rest to the synthesiser, in any order you like. It always prefers, in this order:

1. your recording, then
2. a voice file bundled with the app (see `audio/README.txt` — useful if you'd
   rather record the 30 words at a computer than on the phone), then
3. speech synthesis.

## Installing it on the iPhone

There's no build step and no App Store. It's a web app that installs to the home
screen and then runs offline like any other app.

1. Put these files anywhere that serves them over `https` — GitHub Pages is the
   easiest: repo **Settings → Pages → Deploy from branch**, pick this branch,
   and you get a URL a minute later.
2. On the iPhone, open that URL **in Safari**. It has to be Safari — Chrome on
   iOS can't install to the home screen.
3. **Share button (□↑) → Add to Home Screen → Add.**
4. Open it from the home-screen icon from then on. Launched that way it runs as
   its own app with no Safari bars, and its storage is exempt from the 7-day
   clear-out Safari applies to ordinary websites — which matters, because your
   recordings live in it.
5. Tap the picture once and say yes to the microphone prompt.
6. **Then turn on Airplane Mode and open it again** to confirm it works offline.
   It should behave identically.

The `https` bit is not optional — the microphone and offline caching are both
blocked on plain `http`. Anything on `localhost` or a real `https` host is fine.

### How much screen the app takes

`manifest.json` → `display`, plus the `apple-mobile-web-app-capable` meta in
`index.html`. Three options on iOS, from most locked-down to least:

| What you want | `display` | `apple-mobile-web-app-capable` |
|---|---|---|
| Truly fullscreen, no status bar | `fullscreen` | `yes` |
| **App, status bar visible (current)** | `standalone` | `yes` |
| A normal Safari tab, with the address bar | `browser` | `no` |

The last one is the one to pick if you want to be able to reload it, see the
URL, or get out easily while testing — but she can then reach Safari's buttons.
Change it, bump `CACHE` in `sw.js`, and **delete and re-add the home-screen
icon**: iOS reads these only when the icon is created, so an existing icon keeps
whatever mode it was added with.

### Two iPhone settings worth knowing

- **The ring/silent switch.** The app asks iOS to play anyway (iOS 16.4+), so it
  should be audible even on silent. On an older iPad or iPhone, flip the switch
  off silent if you hear nothing.
- **Guided Access** keeps her inside the app — she can't swipe out to the rest of
  the phone. Settings → Accessibility → Guided Access, turn it on and set a
  passcode; then triple-click the side button once the app is open. Triple-click
  again to leave. This is much more reliable than anything a web app can do
  itself, and it also disables the hardware buttons.

The app also asks iOS to keep the screen awake while she's playing (iOS 16.4+).

---

## The one honest limitation

Telling *whether she said the right word* needs speech recognition, and this is
where the offline requirement bites:

- **Offline (the normal case):** the browser's speech recognizer isn't usable.
  Safari's implementation goes out to Apple's servers, and the on-device
  dictation iOS uses for keyboard voice input isn't exposed to web pages.
  (Safari also wants recognition to start from a tap, which ours can't, since it
  follows the word playing.) So offline the app listens with on-device
  voice-activity detection: it can hear **that** she said something, but not
  **which** word. In that mode every attempt gets warm, neutral encouragement
  and is logged as "practised" — **it never tells her she's wrong when it
  couldn't actually check.** That was a deliberate call: a 1-year-old shouldn't
  be corrected by a guess.
- **When there is wifi:** the app quietly tries real recognition instead, matches
  her attempt generously (`ball`, and approximations like "bal", both pass), and
  that's when the right/wrong tracking and the repetition weighting get real
  data. If the recognizer fails it falls back to the offline behaviour rather
  than scoring her wrong.

In practice: leave it offline for everyday play, and it'll pick up her real
progress on any day the wifi happens to be on. If you ever want true offline
word-level recognition, that needs an on-device model bundled into a real native
app — a much bigger build, and worth doing only if the wifi-day tracking turns
out not to be enough.

Also worth knowing: at 1, speech recognisers are unreliable on toddler speech no
matter who builds them. The matching here is deliberately generous for that
reason — the app is built to encourage imitation, not to grade pronunciation.

---

## Changing the words, or the language she hears

`js/words.js` — 30 entries, each with an id, the picture (an emoji, so there are
no image files to manage and nothing to download), and the word in both
languages.

One line at the top of that file controls what she hears:

```js
const SPOKEN_LANGS = ['target'];           // English only  (current setting)
const SPOKEN_LANGS = ['home', 'target'];   // Portuguese first, then English
```

It drives everything at once — what's played, what counts as saying it back
correctly, and which rows parent mode offers to record. `HOME_LANG` and
`TARGET_LANG` set the two speech-synthesis voices.

## Updating the app after it's installed

Nobody has to reinstall anything, and nothing of hers is lost — recordings and
progress live outside the app's cache and are untouched by an update.

1. Change whatever you want.
2. **Bump `CACHE` in `sw.js`** (`palavras-v3` → `palavras-v4`). This is the one
   step that's easy to forget and it's what tells the phones a new version
   exists.
3. Publish (push, if you're using GitHub Pages).
4. On the iPhone, open the app **once with internet**. It picks up the new
   version and reloads itself — unless she's mid-word, in which case it waits
   for her to finish. After that it's offline again as usual.

If you skip step 2 the phone keeps happily running the old version.

`npm test` includes an update test that installs the app, publishes a change,
and checks it actually arrives on the next launch with her recordings intact.
That test exists because this silently broke once: the service worker refetched
the files through the browser's own HTTP cache, so the "new" cache filled up
with the old app and the phone never changed.

## Running and testing it locally

```bash
npm test           # 34 app checks + 5 update checks, in a real browser
```

The suite covers the things that actually matter here: that the child-facing
screen has no text on it, that a tap plays the English word and then listens,
that misses resurface early in the rotation and correct answers sink, that
progress survives a restart, that a short press doesn't open parent mode but a
long one does, that recording your voice overrides synthesis, that the app fully
loads with the network cut, and that a failing recognizer never reads as a wrong
answer.

The iOS-specific ones cover the rules Safari enforces: that audio is unlocked
synchronously inside the tap (get this wrong and the app is silent on iPhone,
with no error anywhere), that one unlocked `<audio>` element is reused rather
than one per word, that the audio session flips to `play-and-record` only while
listening, that the microphone is handed back after every turn, and that the
home-screen icon and fullscreen meta tags are really in place.

**Not verified on real Safari.** This sandbox couldn't download WebKit, so the
suite runs in Chromium and checks the logic the Safari fixes depend on rather
than Safari itself. The first run on the actual iPhone is the real test — watch
for whether you hear the word on the very first tap, and whether it still speaks
with the ring switch on silent.
