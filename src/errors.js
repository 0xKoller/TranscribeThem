(function (g) {
  // Display strings, resolved when read so the service worker can init first.
  const COPY = {
    get NO_WEBGPU() { return g.waT("errNoWebgpu"); },
    get WEBGPU_FALLBACK() { return g.waT("errWebgpuFallback"); },
    get DOWNLOAD() { return g.waT("errDownload"); },
    get NO_AUDIO() { return g.waT("errNoAudio"); },
    get MEDIA_403() { return g.waT("errMedia403"); },
    get RELOAD() { return g.waT("errReload"); },
    get DECODE() { return g.waT("errDecode"); },
    get OOM() { return g.waT("errOom"); },
    get OFFSCREEN() { return g.waT("errOffscreen"); },
    get GENERIC() { return g.waT("errGeneric"); },
  };

  function mapError(err, code) {
    if (code && COPY[code]) return COPY[code];
    const msg = String(err && err.message ? err.message : err || "");
    if (/no gpu|navigator\.gpu|webgpu is not supported|no available adapters/i.test(msg)) {
      return COPY.NO_WEBGPU;
    }
    if (/webgpuInit|no available backend/i.test(msg)) {
      return COPY.WEBGPU_FALLBACK;
    }
    if (/MEDIA_403|content blocker|cdn\.whatsapp/i.test(msg)) {
      return COPY.MEDIA_403;
    }
    if (/Failed to fetch|NetworkError|ERR_INTERNET|Load failed|failed to download|404|401|403|Unauthorized/i.test(msg)) {
      return COPY.DOWNLOAD;
    }
    if (/decode|EncodingError|NotSupportedError|opus|ogg/i.test(msg)) {
      return COPY.DECODE;
    }
    if (/out of memory|OOM|ENOMEM|gpu memory|Failed to allocate|buffer/i.test(msg)) {
      return COPY.OOM;
    }
    // Display text in either language. "no pude bajar" also matches the model
    // line, and "couldn't download" matches its English twin.
    if (/NO_AUDIO|no pude bajar|couldn'?t download/i.test(msg)) {
      return COPY.NO_AUDIO;
    }
    if (/RELOAD|recargá la pestaña|reload the (whatsapp web|x messages) tab/i.test(msg)) {
      return COPY.RELOAD;
    }
    if (/offscreen/i.test(msg)) {
      return COPY.OFFSCREEN;
    }
    return COPY.GENERIC;
  }

  function waJobErrorCode(err) {
    const name = err && err.name;
    const msg = String(err && err.message ? err.message : err || "");
    if (name === "AbortError" || name === "TimeoutError" || /timeout|timed out|aborted|tardó demasiado|took too long/i.test(msg)) return "timeout";
    if (/NO_AUDIO|no pude bajar este audio|couldn'?t download this audio/i.test(msg)) return "no_audio";
    if (/503|still loading|model still loading|cargando el modelo|loading the model|se está cargando/i.test(msg)) return "model_loading";
    if (/decod|opus|EncodingError/i.test(msg)) return "decode";
    if (/Companion HTTP|Failed to fetch|NetworkError/i.test(msg)) return "http";
    return "generic";
  }

  g.WA_ERROR_COPY = COPY;
  g.mapError = mapError;
  g.waJobErrorCode = waJobErrorCode;
})(typeof globalThis !== "undefined" ? globalThis : this);
