import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
const content = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const source = content.slice(content.indexOf('async function startTranscribe('), content.indexOf('function wrapForRequest('));
for (const failure of ['sync', 'callback', 'before', 'none']) {
  let extracted = 0;
  let sent = 0;
  const wrap = { dataset: { phase: 'idle' } };
  const runtime = {
    id: failure === 'before' ? undefined : 'extension',
    sendMessage(_message, callback) {
      sent++;
      if (failure === 'sync') throw new Error('Extension context invalidated.');
      if (failure === 'callback') this.lastError = { message: 'Extension context invalidated.' };
      callback();
      delete this.lastError;
    },
  };
  const ctx = createContext({
    chrome: { runtime }, WA_MSG: { TRANSCRIBE: 'transcribe' },
    setUi(w, state) { w.dataset.phase = state.phase; w.message = state.message; },
    shownError: (_err, code) => code, log() {},
    extractViaHook: async () => { extracted++; return { base64: 'audio', mimeType: 'audio/ogg', byteLength: 5 }; },
  });
  runInContext(source, ctx);
  await assert.doesNotReject(() => ctx.startTranscribe(wrap, wrap), failure);
  if (failure !== 'none') {
    assert.equal(wrap.dataset.phase, 'error', failure);
    assert.equal(wrap.message, 'RELOAD', failure);
  } else assert.equal(sent, 1);
  if (failure === 'before') assert.equal(extracted, 0);
}
console.log('transcribe-start.test.mjs ok');
