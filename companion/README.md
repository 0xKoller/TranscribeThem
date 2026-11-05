# TranscribeThem — app para macOS

For installation without building from source, follow the [full installation tutorial](../docs/INSTALLATION.md).

App de barra de menú para Apple Silicon y macOS 14+, con Parakeet v3 mediante FluidAudio/CoreML. Transcribe notas de voz de WhatsApp Web y X DMs. La extensión puede usar Whisper sin esta app.

## Compilar

Desde la raíz del repositorio:

```bash
npm run build:companion
open "companion/build/TranscribeThem.app"
```

Para ejecutar desde Swift o correr las pruebas:

```bash
cd companion
swift run WACompanion
swift test
```

La primera ejecución descarga el modelo desde Hugging Face. AVFoundation decodifica el audio; para formatos no soportados se intenta `ffmpeg` instalado localmente en `/opt/homebrew/bin`, `/usr/local/bin` o `/usr/bin`. No se incluye FFmpeg en la app.

## API local

El servidor escucha en `127.0.0.1:8765`.

- `GET /health`: estado, versión `0.2.0`, modelo y estadísticas.
- `GET /v1/settings`, `POST /v1/settings`: ajustes compartidos.
- `POST /v1/hello`: presencia de la extensión.
- `POST /v1/jobs`: estadísticas de transcripción, sin el texto.
- `POST /v1/open`: abre la ventana.
- `POST /transcribe`: audio binario o JSON con `audioBase64`, `mimeType` y `language`; devuelve texto, duración, motor y tiempos de palabras.

Se conserva la ruta local `~/Library/Application Support/WA Local Transcribe/` para compatibilidad con instalaciones previas. No se persisten las transcripciones en las estadísticas; el último texto puede permanecer en memoria durante la ejecución. Los archivos temporales de audio se eliminan al finalizar la transcripción.
