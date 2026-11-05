# Changelog

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
