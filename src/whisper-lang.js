// Whisper language detection. Transformers.js does not implement it (it falls
// back to English when no language is given), so ask the model directly: after
// <|startoftranscript|> the next token Whisper predicts is the language tag.

const DETECT_SECONDS = 30;

/**
 * @param asr      Transformers.js automatic-speech-recognition pipeline (Whisper).
 * @param pcm      Float32Array, mono.
 * @param langToId Map of "<|xx|>" token text to token id; only these can be returned.
 * @returns the language code ("es", "en", …) or null when detection is not possible.
 */
export async function detectWhisperLanguage(asr, pcm, langToId, sampleRate = 16000) {
  const gen = asr && asr.model && asr.model.generation_config;
  const start = gen && gen.decoder_start_token_id;
  if (start == null || !pcm || !pcm.length) return null;
  const limit = sampleRate * DETECT_SECONDS;
  const head = pcm.length > limit ? pcm.subarray(0, limit) : pcm;
  const inputs = await asr.processor(head);
  const output = await asr.model.generate({
    inputs: inputs.input_features,
    decoder_input_ids: [start],
    max_new_tokens: 1,
  });
  const ids = output && output.sequences ? output.sequences : output;
  const flat = ids && typeof ids.tolist === "function" ? ids.tolist().flat(Infinity) : [];
  const picked = Number(flat[flat.length - 1]);
  for (const [token, id] of Object.entries(langToId || {})) {
    if (Number(id) === picked) return token.replace(/[<|>]/g, "");
  }
  return null;
}
