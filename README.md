# TranscribeThem

[Full installation guide](docs/INSTALLATION.md). It covers the extension, the Mac app, the first transcription, troubleshooting, and updates.

Transcribe WhatsApp Web and X DM voice notes on your device. This is a Chrome extension with Whisper (Transformers.js) and a Mac app with Parakeet v3 (FluidAudio/CoreML). The extension works on its own, but it is meant to be used with the app: Parakeet transcribes faster and better. It does not ask for API keys and does not send audio to a transcription service.

## Download and install

Download the files from the [v0.4.0 release](https://github.com/0xKoller/TranscribeThem/releases/tag/v0.4.0):

- `TranscribeThem-0.4.0.dmg`: the recommended Mac app for Apple Silicon and macOS 14 or later. Open the DMG, drag TranscribeThem to Applications, and open it. With the app running, the extension uses Parakeet. The app has an ad hoc signature. It is not signed with Developer ID and is not notarized. If macOS blocks it, go to System Settings, Privacy & Security, and click Open Anyway.
- `TranscribeThem-extension-0.4.0.zip`: the Chrome extension, required on Chrome 113 or later. Unzip it, open `chrome://extensions`, turn on Developer mode, click Load unpacked, and choose the folder that contains `manifest.json`.

Open or reload [WhatsApp Web](https://web.whatsapp.com) after installing the extension and click Transcribe on a voice note. You do not need to play it first. No message is sent.

In [X DMs](https://x.com/i/chat), reload the tab and hover over a voice note. Transcribe appears next to the native actions. When it finishes, the button becomes Copy and the text sits under the audio, aligned with the messages. Words highlight during playback, and clicking one jumps to that moment.

The Mac app is the recommended way to use TranscribeThem. It transcribes with Parakeet, faster than Whisper in the browser. In Automatic mode it uses the app when it is open, and falls back to Whisper if the app is not available. If you pick App only or Browser only, it uses that engine and does not switch. The first run downloads the model from Hugging Face; later runs reuse the local cache. If AVFoundation cannot decode a format, the app needs `ffmpeg` installed on the machine. It is not bundled in the DMG.

## Settings

From the popup you can pick the language (Spanish, English, or Automatic, which detects it per note). The Whisper model and the engine are in Options. The interface is in Spanish or English, following the browser's language. Small is the default model. Larger models need more memory. The extension tries WebGPU and, if that is not available, uses WASM on the CPU. It processes one note at a time.

The app window shows the model, local server, and extension status, along with settings and local statistics.

Options also has:

- **Remember transcripts**, on by default. The extension keeps the last 300 transcripts per message in this browser, so a reload does not lose them. You can clear them there.
- **Transcribe on its own**, off by default. Each voice note that comes into view in the open chat is transcribed without a click. It only runs with the Mac app as the engine.

With the Mac app on macOS 26 or later, a transcript gets Summarize and Translate actions. Both run on the Mac with Apple's on-device model. On older systems the actions do not appear.

## Privacy and network

Audio is processed on your machine, in the browser or in the app through `127.0.0.1:8765`. Models download from Hugging Face. WASM assets may fall back to jsDelivr if needed. WhatsApp Web and X keep using their own network connections.

There is no analytics and no backend of our own. The app stores settings and statistics on the Mac. It uses temporary audio files while transcribing and deletes them when done. The last transcript may stay in memory while the app is open. From the extension you can save audio and text if you ask it to.

Transcript text is stored in two places, both local. The extension remembers the last 300 transcripts in the browser's extension storage, on by default; turn it off or clear it in Options. The Mac app can keep a searchable text history of the last 500 notes, off by default; manage and export it in Settings. Summaries and translations are produced on the Mac and never leave it.

## Development

Requirements: Node.js 18 or later and npm. To build the app: Apple Silicon, macOS 14 or later, and a Swift 6 toolchain compatible with the installed macOS SDK.

```bash
git clone https://github.com/0xKoller/TranscribeThem.git
cd TranscribeThem
npm ci
npm run build
npm test
```

Then load this folder from `chrome://extensions`. The bundle and WASM files are generated at build time; they are not checked in.

For the app and its tests:

```bash
npm run build:companion
cd companion
swift test
```

To build the ZIP and DMG on macOS:

```bash
npm run package:release
```

The files land in `dist/`. Models download at runtime and are not included in the installers. More detail is in [CONTRIBUTING.md](CONTRIBUTING.md) and [the app documentation](companion/README.md).

## Limitations

This is version 0.4.0. Transcripts can contain errors. If WhatsApp or X change their interface, the extension may stop working. It is not on the Chrome Web Store yet. The Mac installer is Apple Silicon only.

## License

Original code is [MIT](LICENSE). Dependencies and models have their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Independent project, not affiliated with WhatsApp, Meta, or X.

## Updating

Replace the extension files, click Reload on `chrome://extensions`, and reload the WhatsApp and X tabs as well. Tabs that were already open keep the previous version until you reload them.
