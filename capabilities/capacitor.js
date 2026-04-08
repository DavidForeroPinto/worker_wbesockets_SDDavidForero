const stats_compute = require("./stats_compute");
const http_latency = require("./http_latency");
const search_text = require("./search_text");

// Capacidades exactas del worker para este parcial:
// - stats_compute
// - http_latency
// - search_text
const capabilityHandlers = {
  stats_compute,
  http_latency,
  search_text
};

const capabilities = Object.keys(capabilityHandlers);

async function executeCapability(type, payload) {
  if (typeof type !== "string" || !type.trim()) {
    throw new Error("Capacidad inválida");
  }

  const normalizedType = type.trim();

  if (!Object.prototype.hasOwnProperty.call(capabilityHandlers, normalizedType)) {
    throw new Error(`Capacidad no soportada: ${normalizedType}`);
  }

  const handler = capabilityHandlers[normalizedType];

  if (typeof handler !== "function") {
    throw new Error(`Handler inválido para la capacidad: ${normalizedType}`);
  }

  return await handler(payload || {});
}

module.exports = {
  capabilities,
  executeCapability
};