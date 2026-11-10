# Changelog

## 0.4.0 — 2026-11-10

- Transcripts are remembered per message in the browser (last 300), with a setting and a clear button.
- Optional auto-transcribe for voice notes visible in the open chat, with the Mac app as the engine. Off by default.
- Summarize and Translate actions on a transcript, done on the Mac with Apple's on-device model (macOS 26 or later).
- Extension interface in Spanish and English.
- Automatic language detection per note with in-browser Whisper.
- The browser loads Whisper only when it is the engine that will run; a note waits for the Mac app while its model loads.
- The Mac app listens on 127.0.0.1 only, caps request size, and decodes audio once.
- Local history in the Mac app: search, export to text, 500 entries.
- New extension permission: `alarms`, for one periodic check of the Mac app instead of one per tab.

## 0.3.0 — 2026-11-05

- Redesigned native Mac app with light/dark appearance and a shared waveform identity.
- Dedicated engine/model controls, native model downloads, and compatible local model selection.
- English/Spanish app language controls and richer activity statistics.
- Optional local full-transcript history and deletion controls.
- Illustrated drag-to-Applications installer.


## 0.2.0 — 2026-11-05

- Transcripción local de notas de voz en X DMs, incluyendo su interfaz con Shadow DOM.
- Acción de transcribir dentro de la barra nativa de X; se convierte en Copiar al terminar.
- Transcripciones alineadas con los mensajes, resaltado de palabras y navegación por audio.
- Recuperación de controles cuando X reemplaza elementos y manejo del contexto invalidado al actualizar la extensión.
- Tutorial actualizado para X y actualizaciones; dos nuevas suites de regresión.

## 0.1.0 — 2026-11-05

Primera publicación open source de TranscribeThem, con historial nuevo y licencia MIT.

- Extensión Chrome Manifest V3 para transcribir notas de voz dentro de WhatsApp Web.
- Whisper local con WebGPU y respaldo WASM, selección de idioma y modelo.
- App opcional de macOS Apple Silicon con Parakeet v3 mediante FluidAudio/CoreML.
- Ajustes compartidos, estado de conexión y estadísticas locales.
- ZIP de la extensión y DMG de la app para instalación manual.

Los modelos se descargan por separado en la primera ejecución. La app usa firma ad hoc y no está notarizada.
