# TranscribeThem privacy policy

Last updated: 2026-11-10

TranscribeThem transcribes voice notes on your own computer. It has no server, no account, no analytics, and no advertising.

## What the extension handles

- **Voice note audio.** When you click Transcribe (or turn on auto-transcribe), the extension reads that note's audio from the WhatsApp Web or X page. The audio is decoded and transcribed in the browser with Whisper, or sent to the TranscribeThem Mac app on the same computer (`http://127.0.0.1`). It never goes to a remote server.
- **Transcripts.** The text appears under the note. If "Remember transcripts" is on (the default), the last 300 transcripts are saved in Chrome's local extension storage on your computer so a reload does not lose them. You can turn this off and clear them in the extension settings.
- **Settings.** Your choices (language, engine, model, sites) are stored in Chrome's local extension storage and shared with the Mac app on the same computer.

## What leaves your computer

- **Model weights.** The first time the browser engine runs, it downloads the Whisper model files from Hugging Face (`huggingface.co`). This request contains no audio and no text. The files are cached and reused.
- **Update check (Mac app, optional).** If you click Check now or turn on the launch check in the Mac app, it asks GitHub for the latest public release. It sends nothing about you or your messages.

Nothing else is sent anywhere. The extension does not read your messages, contacts, or chats beyond the voice notes you transcribe.

## Mac app

The optional Mac app listens only on `127.0.0.1` and accepts requests only from the TranscribeThem extension. It can keep a local history of transcript text, off by default, which you can delete in its settings. Summary and translation, when available, run with Apple's on-device model.

## Contact

Questions or reports: https://github.com/0xKoller/TranscribeThem/issues
