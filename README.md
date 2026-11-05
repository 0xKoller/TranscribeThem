# TranscribeThem

**[Full installation tutorial (English)](docs/INSTALLATION.md)** — extension, Mac app, first transcription, troubleshooting, and updates.

Transcribí notas de voz de WhatsApp Web y X DMs en tu dispositivo. Extensión de Chrome con Whisper (Transformers.js) y una app opcional para Mac con Parakeet v3 (FluidAudio/CoreML). Sin API keys ni servicios de transcripción remotos.

## Descargar e instalar

Descargá los archivos del [release v0.3.0](https://github.com/0xKoller/TranscribeThem/releases/tag/v0.3.0):

- **TranscribeThem-extension-0.3.0.zip**: extensión para Chrome 113 o superior. Descomprimí el ZIP, abrí `chrome://extensions`, activá **Modo de desarrollador**, elegí **Cargar descomprimida** y seleccioná la carpeta que contiene `manifest.json`.
- **TranscribeThem-0.3.0.dmg**: app opcional para Mac con Apple Silicon y macOS 14 o superior. Abrí el DMG, arrastrá TranscribeThem a Aplicaciones y abrila. La app usa firma ad hoc; no está firmada con Developer ID ni notarizada. Si macOS la bloquea, revisá **Configuración del Sistema → Privacidad y seguridad → Abrir de todos modos**.

Abrí o recargá [WhatsApp Web](https://web.whatsapp.com) después de instalar la extensión y tocá **Transcribir** en una nota de voz. No hace falta reproducirla. No se envía ningún mensaje.

En [X DMs](https://x.com/i/chat), recargá la pestaña y pasá el cursor sobre una nota de voz: **Transcribir** aparece junto a las acciones nativas. Al terminar se convierte en **Copiar** y el texto aparece debajo del audio, alineado con los mensajes. Las palabras se resaltan durante la reproducción y permiten saltar a ese momento del audio.

La app de Mac acelera la transcripción con Parakeet. En modo Automático, si no está disponible, la extensión usa Whisper en el navegador. Solo esta app y Solo el navegador respetan el motor elegido. La primera ejecución descarga el modelo desde Hugging Face; después se reutiliza la caché local. Para formatos que AVFoundation no pueda decodificar, la app necesita una instalación local de `ffmpeg` (no se incluye).

## Ajustes

Desde el popup podés elegir idioma (español o inglés), modelo Whisper y uso de la app. Small es el modelo predeterminado; los modelos mayores requieren más memoria. La extensión intenta WebGPU y dispone de respaldo WASM en CPU. Procesa una nota a la vez.

La ventana de la app muestra el estado del modelo, del servidor local y de la extensión, junto con ajustes y estadísticas locales.

## Privacidad y red

El audio se procesa localmente, en el navegador o en la app mediante `127.0.0.1:8765`. Los modelos se descargan desde Hugging Face; puede usarse jsDelivr como respaldo para recursos WASM. WhatsApp Web y X mantienen sus propias conexiones de red.

No hay analytics ni backend propio. La app conserva ajustes y estadísticas locales; usa archivos de audio temporales durante la transcripción y los elimina al terminar. La última transcripción puede permanecer en memoria mientras la app está abierta. El usuario puede guardar audio y texto explícitamente desde la extensión.

## Desarrollo

Requisitos: Node.js 18 o superior y npm. Para compilar la app: Apple Silicon, macOS 14 o superior y toolchain Swift 6 compatible con el SDK de macOS instalado.

```bash
git clone https://github.com/0xKoller/TranscribeThem.git
cd TranscribeThem
npm ci
npm run build
npm test
```

Luego cargá esta carpeta desde `chrome://extensions`. El bundle y los WASM se generan durante la compilación; no están versionados.

Para la app y sus pruebas:

```bash
npm run build:companion
cd companion
swift test
```

Para producir el ZIP y el DMG desde macOS:

```bash
npm run package:release
```

Los archivos quedan en `dist/`. Los modelos se descargan en ejecución y no están incluidos en los instaladores. Consultá [CONTRIBUTING.md](CONTRIBUTING.md) y [la documentación de la app](companion/README.md).

## Limitaciones

Versión 0.3.0. Las transcripciones pueden contener errores. Cambios en la interfaz de WhatsApp o X pueden afectar la extensión. No se distribuye todavía en Chrome Web Store. El instalador de Mac se publica para Apple Silicon.

## Licencia

Código propio bajo [MIT](LICENSE). Las dependencias y los modelos tienen sus propias licencias; ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Proyecto independiente, sin afiliación con WhatsApp, Meta ni X.

## Actualizar

Reemplazá los archivos de la extensión, pulsá **Recargar** en `chrome://extensions` y recargá también las pestañas de WhatsApp y X. Las pestañas abiertas conservan el contexto anterior hasta recargarlas.
