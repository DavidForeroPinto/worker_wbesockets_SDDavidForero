function stats_compute(payload) {
  // =============================
  // VALIDACIÓN
  // =============================
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload inválido: debe ser un objeto");
  }

  if (!Array.isArray(payload.numbers)) {
    throw new Error("Payload inválido: 'numbers' debe ser un arreglo");
  }

  if (payload.numbers.length === 0) {
    throw new Error("'numbers' no puede estar vacío");
  }

  // =============================
  // NORMALIZACIÓN ESTRICTA
  // =============================
  const numbers = payload.numbers.map((value) => {
    if (typeof value !== "number" && typeof value !== "string") {
      throw new Error("Todos los valores deben ser números o strings numéricos");
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      throw new Error("Todos los valores deben ser numéricos y finitos");
    }

    return parsed;
  });

  // =============================
  // CÁLCULOS
  // =============================
  const sum = numbers.reduce((acc, val) => acc + val, 0);
  const mean = Number((sum / numbers.length).toFixed(4)); // control de precisión
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);

  // =============================
  // RESPUESTA
  // =============================
  return {
    mean,
    min,
    max,
    count: numbers.length
  };
}

module.exports = stats_compute;