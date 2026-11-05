# Third-party notices

TranscribeThem's own code is MIT-licensed. This does not relicense third-party software or model weights.

The extension uses Hugging Face Transformers.js 4.3.0 (Apache-2.0), Hugging Face tokenizers and Jinja, and ONNX Runtime Web (MIT), together with their JavaScript dependencies. The build retains bundled legal comments; license texts and ONNX Runtime's third-party notices are included in `third-party-licenses/`.

The macOS app uses FluidAudio 0.18.0 (Apache-2.0). Its license and bundled third-party notices, including fastcluster and NemoTextProcessing, are reproduced in `third-party-licenses/`. These notices also cover upstream components that may be unused by TranscribeThem. SwiftPM resource bundles are distributed with the app.

FFmpeg is not bundled. If installed separately, it may be invoked locally for audio decoding and remains subject to its own build's license.

Model weights are downloaded separately at runtime, not included in this repository or release archives. Consult the license and model card of the selected Hugging Face repository (Whisper models selected in `src/settings.js`, Parakeet v3 downloaded by FluidAudio). A license for this project's code does not grant additional rights to model weights.

Upstream projects:

- https://github.com/huggingface/transformers.js
- https://github.com/microsoft/onnxruntime
- https://github.com/FluidInference/FluidAudio
- https://github.com/FluidInference/text-processing-rs
