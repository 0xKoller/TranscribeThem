# Install TranscribeThem 0.5.0

Download TranscribeThem, install it, and transcribe a WhatsApp or X DM voice note. You do not need developer tools, an API key, or a paid transcription account. The Mac app's interface is available in English and Spanish. Pick the language in Settings. This guide uses the Spanish labels where the app shows them.

## 1. Choose your setup and download

You need the Chrome extension. The Mac app is the recommended setup. It runs Parakeet on Apple Silicon and is how TranscribeThem works best. Without the app, the extension still runs Whisper in Chrome.

Requirements:

- Google Chrome 113 or later. WebGPU depends on your hardware. If it is not available, the extension falls back to the CPU, which is slower.
- WhatsApp Web or X signed in with the same Chrome profile where you install the extension.
- For the Mac app: macOS 14 or later and an Apple Silicon chip (M1 or newer). Check Apple menu, About This Mac. The DMG does not run on Intel Macs, Windows, or Linux. On those systems, use the extension alone.
- Internet access the first time a model downloads. Leave enough free disk space for the model caches. Larger models use more disk and memory.

Download from the [v0.5.0 release](https://github.com/0xKoller/TranscribeThem/releases/tag/v0.5.0):

- [Mac app DMG](https://github.com/0xKoller/TranscribeThem/releases/download/v0.5.0/TranscribeThem-0.5.0.dmg)
- [Chrome extension ZIP](https://github.com/0xKoller/TranscribeThem/releases/download/v0.5.0/TranscribeThem-extension-0.5.0.zip)
- [SHA-256 checksums](https://github.com/0xKoller/TranscribeThem/releases/download/v0.5.0/SHA256SUMS.txt) (optional)

Download the named extension ZIP, not GitHub's "Source code (zip)". The source archive needs a build step and will not load in Chrome as-is.

## 2. Install the Chrome extension

1. Unzip `TranscribeThem-extension-0.5.0.zip`. On macOS, double-click it in Finder. On Windows, use Extract All.
2. Move the extracted folder somewhere permanent, such as a `Chrome Extensions` folder inside Documents. Chrome reads the extension from this folder, so keep it after installation.
3. Open the extracted folder and check that it contains `manifest.json`, `src`, `icons`, and `vendor`. If there is another folder inside, use the inner folder that directly contains `manifest.json`.
4. Open Chrome. Paste `chrome://extensions` into the address bar and press Enter.
5. Turn on Developer mode in the top-right corner. Keep it enabled while using this unpacked extension.
6. Click Load unpacked (Spanish Chrome: Cargar descomprimida).
7. Select the folder that directly contains `manifest.json`, then confirm the selection.
8. Check that a TranscribeThem card appears, its switch is enabled, and its version is 0.5.0.
9. Click Chrome's puzzle-piece Extensions button, then pin TranscribeThem so its icon is easy to find.
10. Open [WhatsApp Web](https://web.whatsapp.com), sign in if needed, and reload the tab if it was already open.

This follows Chrome's [unpacked-extension installation flow](https://support.google.com/chrome/a/answer/2714278?hl=EN). A work or school administrator may disable Developer mode or extension installation.

## 3. Install the Mac app (recommended)

Skip to section 4 if you are using only the extension.

1. Open `TranscribeThem-0.5.0.dmg` in Finder.
2. Drag TranscribeThem.app onto the Applications shortcut in the disk image.
3. Wait for the copy to finish, then eject the TranscribeThem disk image from Finder's sidebar.
4. Open Finder, Applications, TranscribeThem. Run the installed copy, not the copy inside the DMG.
5. If macOS blocks the app because its developer cannot be verified, dismiss the warning. Open System Settings, Privacy & Security, find the message about TranscribeThem, and click Open Anyway. Confirm Open, and authenticate if macOS asks. Only do this for the app you downloaded from this repository. See [Apple's instructions](https://support.apple.com/en-gb/102445).
6. Leave the app running while it downloads and loads the Parakeet model. This needs internet access on first launch and can take time.
7. In the app window, check the Modelo (model) and Servidor (server) indicators. The server should show En línea (online). Wait until the model is ready before testing.

The app has an ad hoc signature and is not notarized by Apple. You do not need to disable Gatekeeper globally. If your Mac reports malware or a damaged application, do not bypass that warning. Download again from the release page and report the exact message if it persists.

TranscribeThem is a menu-bar app and may not appear in the Dock. Use the waveform icon in the menu bar and Abrir (Open) to bring its window back. Closing the window is different from quitting the app.

## 4. Select an engine and language

1. Click the pinned TranscribeThem extension icon in Chrome.
2. Set Idioma (language) to Español or English for the voice notes you want to transcribe. Automático lets Parakeet detect the language. The browser fallback uses Spanish in that mode.
3. Click Ajustes (Settings), then select Motor (engine):
   - Automático: use the Mac app when available, otherwise use Whisper in Chrome. Start here when using both pieces.
   - Solo el navegador: always use Whisper in Chrome. Choose this for extension-only use.
   - Solo esta app: require the Mac app. There is no browser fallback if it is unavailable.
4. If using the browser, choose Small under Modelo del navegador to start. Allow the model download or loading to finish. Medium and Turbo require more memory.
5. If using the Mac app, open the extension popup again. Look for App local: Conectada (Parakeet). A loading message means the app is reachable but its model is not ready yet.

Start the app from Applications the first time. The popup's Abrir app button brings an already-running app's window forward. It cannot launch a stopped app through its local server.

## 5. Transcribe your first voice note

1. Reload WhatsApp Web after installing or updating the extension.
2. Open a chat containing a voice note. Start with a short note in your selected language.
3. Click Transcribir on the voice-note bubble. You do not need to play the note first.
4. Wait for the transcript to appear inside that bubble. The first transcription can be slower because the model needs to load.
5. Review the result. Transcription can make mistakes. It does not automatically send a message or put text into the message composer.

The extension processes one transcription at a time. With the Mac app, its activity view records local timing and counts. Audio inference happens locally. The browser and app may still need network access for model downloads, and WhatsApp Web uses its normal connections.

### Transcribe an X DM voice note

1. Open [X Messages](https://x.com/i/chat) (`/i/chat` and `/messages` are supported) and reload the tab after installing or updating the extension.
2. Open a conversation with a voice note and hover over the audio bubble.
3. Click the transcription icon beside X's native reply, reaction, and download actions.
4. Wait for the text below the audio. The transcription action becomes Copiar (Copy).
5. Play the note to follow the highlighted words, or click a word to seek to that part of the audio.

No message is sent automatically. The same local engines and language settings apply to WhatsApp and X.

## Troubleshooting

### "Extension context invalidated", "Recargar", or a stale loading action after an update

Reload the WhatsApp or X tab after reloading the extension at `chrome://extensions`. Reloading only the extension leaves old content scripts in existing tabs. Then retry transcription.

### No transcription action in X

Open a DM containing a voice note and hover over the audio to reveal its native action rail. Check that the extension is enabled, has access to X, and reload the tab. X layout changes may require an extension update.

### "Manifest file is missing or unreadable"

Extract the ZIP first. Select the folder that directly contains `manifest.json`, not the ZIP, its parent folder, or GitHub's source archive. If you downloaded the source archive, download the named extension ZIP instead.

### No Transcribir button in WhatsApp Web

Check that TranscribeThem is enabled at `chrome://extensions`, that Developer mode remains on, and that you installed it in the Chrome profile you are using. Reload WhatsApp Web. If you disabled WhatsApp Web in the app's settings, enable it again. The button applies to voice notes, not ordinary text messages. If it still fails, WhatsApp may have changed its page layout: report the issue with your Chrome and extension versions.

### "App local: No detectada"

Open TranscribeThem from Applications and leave it running. Check Servidor, En línea in its window, then reopen the extension popup. Quit an older WA Local Transcribe companion if one is running: both use local port `8765`. Use Automático or Solo el navegador if you want to continue without the app.

### The model keeps loading or fails to download

Keep Chrome or the app open and check your internet connection. Corporate networks, proxies, or filters may block Hugging Face downloads. Retry when connectivity is restored. Browser and app models are separate downloads. If memory is limited, use Small and close other GPU-heavy applications. Clearing Chrome's site or extension storage can remove cached models and require another download.

### Audio decoding fails or the app says FFmpeg is missing

The app first tries Apple's audio decoder. Some formats need a separate FFmpeg installation. FFmpeg is not included in the DMG. If you already use Homebrew, install it with `brew install ffmpeg`, then retry. The app checks `/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, and `/usr/bin/ffmpeg`. Alternatively, select Solo el navegador to use the browser engine. This is an optional dependency, not a requirement for installing the extension.

### The Mac app will not open

Verify Apple Silicon and macOS 14 or later in About This Mac. Try opening the installed app once before looking for Open Anyway in Privacy & Security. On a managed computer, your administrator may prevent exceptions. Use the extension alone if the app cannot run.

## Updating

There is no automatic updater for this manually loaded extension.

1. Download the named extension ZIP from the new release and extract it.
2. Replace the contents of your existing permanent extension folder with the new package contents. Keep `manifest.json` at the folder root.
3. Go to `chrome://extensions`, click Reload on the TranscribeThem card, and check the version. Reload all open WhatsApp Web and X tabs too.
4. For the Mac app, quit TranscribeThem from its menu-bar menu, open the new DMG, and drag the new app into Applications, confirming replacement. Eject the DMG and reopen the installed app.

Keeping the same extension folder avoids unnecessarily removing and reinstalling the extension, which can discard its settings and model cache.

**Updating from 0.4.0 or earlier to 0.5.0:** this one time, remove the old extension and load it again. Version 0.5.0 gives the extension a fixed ID, and Chrome treats it as a new extension. In `chrome://extensions`, click Remove on the old TranscribeThem card, then Load unpacked on the new folder. Its settings, remembered transcripts, and downloaded Whisper model start fresh; pick your language and engine again. Update the Mac app at the same time: the 0.5.0 app only talks to the 0.5.0 extension.

## Uninstalling

In `chrome://extensions`, click Remove on TranscribeThem. You can then delete its extracted folder. Quit the Mac app and move it from Applications to Trash. Removing the app does not delete downloaded model caches or local settings. For compatibility with earlier versions, its settings and statistics live in `~/Library/Application Support/WA Local Transcribe/`.

## Optional: verify the downloads

Place the DMG, the extension ZIP, and `SHA256SUMS.txt` in the same folder. On macOS, open Terminal in that folder and run:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Both files should report OK. If you only downloaded one artifact, the other will be reported as missing. Check the result for the file you downloaded. Matching checksums confirm the files match the published release. They do not replace Apple's notarization.

## Need help?

[Open an issue](https://github.com/0xKoller/TranscribeThem/issues) with your operating system, Chrome version, extension version, selected engine, and the exact error. Do not attach private voice notes or conversations.

## New in 0.5.0

- Click a note's button while it is queued or transcribing to cancel it.
- On a WhatsApp Web or X tab, the toolbar popup has Transcribe the notes on screen. Alt+Shift+T transcribes the newest note on screen. Change the shortcut at `chrome://extensions/shortcuts`.
- The extension has a fixed ID, and the Mac app only accepts that extension. Other extensions and websites cannot use the app. See the update note above.
- Audio goes from the extension to the Mac app as raw bytes, a third smaller than before.
- The Mac app can check GitHub for a newer release: Settings, Actualizaciones (Updates). It only checks when you click Buscar ahora (Check now) or turn on the launch check. Both are off by default.
- No code is loaded from a CDN. The extension no longer asks for access to cdn.jsdelivr.net.

## New in 0.4.0

- The extension remembers the last 300 transcripts per message, so reloading the tab does not lose them. Turn this off, or clear them, in the extension's Options.
- Optional, off by default: transcribe each voice note as it comes into view. It only runs with the Mac app as the engine.
- With the Mac app on macOS 26 or later, a transcript gets Summarize and Translate actions, done on the Mac with Apple's on-device model.
- The extension's interface is in Spanish or English, following the browser's language.
- The Automatic language setting now detects the language per note with the browser engine too.
- While the Mac app is open, the browser no longer downloads or loads Whisper.
- The Mac app's Activity can search saved transcripts and export them to a text file. It keeps 500 entries.

## New in 0.3.0


- The Mac app follows the system appearance and supports light and dark mode.
- In Settings you can pick the app language (System, English, or Spanish). This is separate from the transcription language.
- In Engine & Models you can pick browser Whisper (Small, Medium, Turbo) or native Parakeet (v3, v2, or Ultra). Download a native model, or choose a compatible local CoreML model folder. Other model formats are not supported.
- Activity shows site, timing, engine, and result details. Full transcript history is optional, stored on the Mac, and off by default. Turn it on in Settings to save future transcripts, and clear saved text there when you want.
- The DMG uses a white illustrated background. Drag the app onto Applications to install.
