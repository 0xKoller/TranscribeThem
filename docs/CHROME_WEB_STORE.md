# Publishing on the Chrome Web Store

Everything the Store asks for, ready to paste. Uploading needs the developer account (one-time USD 5 fee) and is done by hand in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Package

```bash
npm run package:webstore
```

This writes `dist/TranscribeThem-webstore-<version>.zip`. It is the release ZIP without the manifest `key`: the Store rejects that field and assigns its own ID.

## After the first upload

The Store ID differs from the ID of the unpacked extension (`bnmnjapomgkgljobkcalefbbnfcfjlmd`). The Mac app accepts only known IDs, so add the Store ID:

1. Copy the item ID from the dashboard.
2. Add it to `knownExtensionIds` in `companion/Sources/CompanionCore/OriginPolicy.swift` and ship a new app. To test before that, run the app with `WA_COMPANION_EXTENSION_IDS=<store id>`.

## Listing

**Name:** TranscribeThem

**Summary (132 characters max):** Transcribe WhatsApp Web and X voice notes on your device. No account, no API keys, no audio leaves your computer.

**Description:**

> TranscribeThem adds a Transcribe button to voice notes in WhatsApp Web and in X messages. The text appears under the note, and each word lights up as the audio plays.
>
> Everything runs on your computer. The browser engine is Whisper (WebGPU, with a CPU fallback). On a Mac with Apple Silicon, the optional TranscribeThem app transcribes faster and more accurately with Parakeet v3.
>
> - One click per note, or transcribe every note on screen from the toolbar button. Alt+Shift+T transcribes the newest one.
> - Spanish and English, or automatic detection.
> - Transcripts survive a reload. Turn this off and clear them in the settings.
> - Copy the text. With the Mac app on macOS 26, summarize or translate it on the device.
>
> No account, no API keys, no analytics. The first run downloads the model from Hugging Face; after that it works offline.

**Category:** Productivity. **Language:** Spanish and English.

## Privacy tab

**Single purpose:** Transcribe voice notes in WhatsApp Web and X messages on the user's own device.

**Permission justifications:**

| Permission | Why |
|---|---|
| `storage` | Saves the user's settings and, if enabled, recent transcripts on the device. |
| `unlimitedStorage` | The Whisper model is hundreds of MB and is cached locally so it downloads once. |
| `offscreen` | Runs Whisper with WebGPU/WASM in an offscreen document; the service worker cannot. |
| `alarms` | One check per minute for the local Mac app, instead of one per open tab. |
| `downloads` | The Save audio action saves the voice note and its transcript as files the user asked for. |
| Host `web.whatsapp.com`, `x.com`, `twitter.com` | Adds the Transcribe button to voice notes and reads the audio of the note the user transcribes. |
| Host `huggingface.co`, `hf.co` | Downloads the Whisper model weights on first use. |
| Host `127.0.0.1`, `localhost` | Talks to the optional TranscribeThem Mac app on the same computer. |

**Updates:** The Web Store copy does not look for updates or reload itself: both are off when the manifest has `update_url`, which Chrome adds to store installs. No permission was added for updates.

**Remote code:** No. All JavaScript and WASM ship in the package (`src/`, `vendor/ort/`). Model weights are data, not code.

**Data usage:** The extension handles "Website content" (voice note audio and its transcript) only to provide the transcription, on the device. It does not sell, transfer, or use data for anything else. Check all three certifications.

**Privacy policy URL:** https://github.com/0xKoller/TranscribeThem/blob/main/docs/PRIVACY.md

## Images

- Icon: `icons/icon128.png`.
- Screenshots (1280×800): a WhatsApp Web chat with a transcribed note, the popup, the settings page. Use a chat with your own test messages only.
