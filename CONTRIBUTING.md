# Contribuir a TranscribeThem

Abrí un issue con pasos de reproducción, versión de Chrome/macOS, motor y resultado esperado. No adjuntes conversaciones, audios privados ni credenciales. Para cambios, enviá un pull request con una descripción breve y las pruebas realizadas.

## Validación

```bash
npm ci
npm run build
npm test
cd companion
swift test
```

Los tests de JavaScript y CompanionCore no requieren audios privados ni descargar modelos. Las pruebas de interfaz real en WhatsApp Web y de inferencia necesitan verificación manual.

La prueba opcional `tests/test_companion.py` requiere el binario release, un modelo ya descargado y un audio propio autorizado. Cerrá primero cualquier app que use el puerto 8765:

```bash
TEST_AUDIO=/ruta/a/audio.wav EXPECTED_TEXT='texto esperado' python3 tests/test_companion.py
```

No agregues esos archivos al repositorio. `eval/` está ignorado. `EXPECTED_TEXT` es opcional: si se omite, se verifica que haya una transcripción no vacía.

## Releases

Mantené la versión alineada en `package.json`, `package-lock.json`, `manifest.json`, `companion/Info.plist` y la respuesta `/health` de `HTTPServer.swift`. Actualizá `CHANGELOG.md`, ejecutá las pruebas y `npm run package:release` en un Mac Apple Silicon. Verificá el ZIP, el DMG y la firma ad hoc antes de publicar el tag y los artefactos.

No se necesita un certificado Apple para compilar; la firma ad hoc no equivale a notarización.
