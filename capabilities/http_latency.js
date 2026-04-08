const http = require("http");
const https = require("https");

const HTTP_LATENCY_TIMEOUT = 8000;

// =============================
// MEDICIÓN DE LATENCIA
// =============================
function measureLatency(url, timeout = HTTP_LATENCY_TIMEOUT) {
  return new Promise((resolve, reject) => {
    let parsedUrl;

    // =============================
    // VALIDACIÓN DE URL
    // =============================
    try {
      parsedUrl = new URL(url);

      if (!parsedUrl.hostname) {
        return reject(new Error("URL inválida: hostname vacío"));
      }
    } catch (_) {
      return reject(new Error("URL inválida"));
    }

    const transport =
      parsedUrl.protocol === "https:"
        ? https
        : parsedUrl.protocol === "http:"
        ? http
        : null;

    if (!transport) {
      return reject(
        new Error("Protocolo no soportado (usar http:// o https://)")
      );
    }

    const start = Date.now();

    const req = transport.request(
      parsedUrl,
      {
        method: "GET",
        headers: {
          "User-Agent": "worker-latency-check"
        }
      },
      (res) => {
        const ms = Date.now() - start;

        // Validar respuesta HTTP
        if (res.statusCode >= 400) {
          return reject(
            new Error(`HTTP error ${res.statusCode} midiendo latencia`)
          );
        }

        // Consumir datos (evitar leaks)
        res.on("data", () => {});
        res.on("end", () => {
          resolve({ ms });
        });
      }
    );

    // =============================
    // TIMEOUT
    // =============================
    req.setTimeout(timeout, () => {
      req.destroy(new Error("Timeout midiendo latencia"));
    });

    // =============================
    // ERROR
    // =============================
    req.on("error", (err) => {
      reject(
        new Error(
          `Error de red midiendo latencia: ${err.message || "desconocido"}`
        )
      );
    });

    req.end();
  });
}

// =============================
// CAPABILITY
// =============================
async function http_latency(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload inválido: debe ser un objeto");
  }

  if (typeof payload.url !== "string" || !payload.url.trim()) {
    throw new Error("Payload inválido: 'url' es requerida");
  }

  const url = payload.url.trim();

  return await measureLatency(url, HTTP_LATENCY_TIMEOUT);
}

module.exports = http_latency;