(function (g) {
  const COPY = {
    NO_WEBGPU: "Este Chrome no tiene WebGPU. Actualizá Chrome (113+).",
    WEBGPU_FALLBACK: "WebGPU no disponible, usando CPU (más lento).",
    DOWNLOAD: "No pude bajar el modelo. Revisá internet o volvé a Small.",
    NO_AUDIO: "No pude bajar este audio. Reintentá.",
    MEDIA_403:
      "WhatsApp no dejó bajar el audio (bloqueo o 403). Probá en Chrome o desactivá el content blocker de Dia.",
    RELOAD: "Recargá la pestaña de WhatsApp Web.",
    DECODE: "No pude decodificar el audio (Opus).",
    OOM: "Memoria insuficiente. Probá Small en el popup.",
    OFFSCREEN: "No pude iniciar el motor local. Recargá la extensión.",
    GENERIC: "Falló la transcripción. Tocá Reintentar.",
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
    if (/NO_AUDIO|no pude bajar/i.test(msg)) {
      return COPY.NO_AUDIO;
    }
    if (/RELOAD|recargá la pestaña/i.test(msg)) {
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
    if (name === "AbortError" || /timeout|aborted|tardó demasiado/i.test(msg)) return "timeout";
    if (/NO_AUDIO|no pude bajar este audio/i.test(msg)) return "no_audio";
    if (/503|still loading|model still loading|cargando el modelo/i.test(msg)) return "model_loading";
    if (/decod|opus|EncodingError/i.test(msg)) return "decode";
    if (/Companion HTTP|Failed to fetch|NetworkError/i.test(msg)) return "http";
    return "generic";
  }

  g.WA_ERROR_COPY = COPY;
  g.mapError = mapError;
  g.waJobErrorCode = waJobErrorCode;
})(typeof globalThis !== "undefined" ? globalThis : this);
