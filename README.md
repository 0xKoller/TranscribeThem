# TranscribeThem

[Guía completa de instalación (inglés)](docs/INSTALLATION.md). Cubre la extensión, la app de Mac, la primera transcripción, problemas frecuentes y cómo actualizar.

Transcribí notas de voz de WhatsApp Web y de los DMs de X en tu dispositivo. Es una extensión de Chrome con Whisper (Transformers.js) y una app para Mac con Parakeet v3 (FluidAudio/CoreML). La extensión funciona sola, pero está pensada para usarse con la app: con Parakeet transcribe más rápido y mejor. No pide API keys y no manda el audio a un servicio de transcripción.

## Descargar e instalar

Descargá los archivos del [release v0.3.0](https://github.com/0xKoller/TranscribeThem/releases/tag/v0.3.0):

- `TranscribeThem-0.3.0.dmg`: la app recomendada para Mac con Apple Silicon y macOS 14 o superior. Abrí el DMG, arrastrá TranscribeThem a Aplicaciones y abrila. Con la app, la extensión usa Parakeet. La app tiene firma ad hoc. No está firmada con Developer ID ni notarizada. Si macOS la bloquea, andá a Configuración del Sistema, Privacidad y seguridad, y tocá Abrir de todos modos.
- `TranscribeThem-extension-0.3.0.zip`: la extensión, necesaria en Chrome 113 o superior. Descomprimí el ZIP, abrí `chrome://extensions`, activá Modo de desarrollador, tocá Cargar descomprimida y elegí la carpeta que tiene `manifest.json`.

Abrí o recargá [WhatsApp Web](https://web.whatsapp.com) después de instalar la extensión y tocá Transcribir en una nota de voz. No hace falta reproducirla. No se envía ningún mensaje.

En [los DMs de X](https://x.com/i/chat), recargá la pestaña y pasá el cursor sobre una nota de voz. Transcribir aparece junto a las acciones nativas. Cuando termina, el botón pasa a Copiar y el texto queda debajo del audio, alineado con los mensajes. Durante la reproducción se resaltan las palabras, y al tocar una saltás a ese momento.

La app de Mac es la forma recomendada de usar TranscribeThem. Transcribe con Parakeet, más rápido que Whisper en el navegador. En modo Automático usa la app cuando está abierta, y si no está disponible cae a Whisper. Si elegís Solo esta app o Solo el navegador, usa ese motor y no cambia al otro. La primera vez descarga el modelo desde Hugging Face; después reutiliza la caché local. Si AVFoundation no puede decodificar un formato, la app necesita `ffmpeg` instalado en la máquina. No viene en el DMG.

## Ajustes

Desde el popup podés elegir idioma (español o inglés), modelo Whisper y uso de la app. Small es el modelo predeterminado. Los modelos más grandes pedirán más memoria. La extensión intenta usar WebGPU y, si no puede, usa WASM en la CPU. Procesa una nota a la vez.

La ventana de la app muestra el estado del modelo, del servidor local y de la extensión, junto con ajustes y estadísticas locales.

## Privacidad y red

El audio se procesa en tu máquina, en el navegador o en la app a través de `127.0.0.1:8765`. Los modelos se bajan de Hugging Face. Si hace falta, los recursos WASM pueden bajar de jsDelivr. WhatsApp Web y X siguen usando sus propias conexiones.

No hay analytics ni un backend propio. La app guarda ajustes y estadísticas en el Mac. Usa archivos de audio temporales mientras transcribe y los borra al terminar. La última transcripción puede quedar en memoria mientras la app esté abierta. Desde la extensión podés guardar audio y texto si lo pedís vos.

## Desarrollo

Requisitos: Node.js 18 o superior y npm. Para compilar la app: Apple Silicon, macOS 14 o superior, y un toolchain de Swift 6 compatible con el SDK de macOS instalado.

```bash
git clone https://github.com/0xKoller/TranscribeThem.git
cd TranscribeThem
npm ci
npm run build
npm test
```

Después cargá esta carpeta desde `chrome://extensions`. El bundle y los WASM se generan al compilar; no están versionados.

Para la app y sus pruebas:

```bash
npm run build:companion
cd companion
swift test
```

Para armar el ZIP y el DMG desde macOS:

```bash
npm run package:release
```

Los archivos quedan en `dist/`. Los modelos se descargan en ejecución y no vienen en los instaladores. Más detalle en [CONTRIBUTING.md](CONTRIBUTING.md) y en [la documentación de la app](companion/README.md).

## Limitaciones

Esta es la versión 0.3.0. Las transcripciones pueden tener errores. Si WhatsApp o X cambian su interfaz, la extensión puede dejar de funcionar. Todavía no está en Chrome Web Store. El instalador de Mac es solo para Apple Silicon.

## Licencia

El código propio está bajo [MIT](LICENSE). Las dependencias y los modelos tienen sus propias licencias; ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Proyecto independiente, sin afiliación con WhatsApp, Meta ni X.

## Actualizar

Reemplazá los archivos de la extensión, tocá Recargar en `chrome://extensions` y recargá también las pestañas de WhatsApp y X. Las pestañas que ya estaban abiertas siguen con la versión anterior hasta que las recargues.
