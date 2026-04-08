function search_text(payload) {
  // =============================
  // VALIDACIÓN
  // =============================
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload inválido: debe ser un objeto");
  }

  const {
    text,
    query,
    caseSensitive = false,
    allowOverlap = false
  } = payload;

  if (typeof text !== "string" || typeof query !== "string") {
    throw new Error("Payload inválido: 'text' y 'query' deben ser strings");
  }

  if (!query.length || !text.length) {
    return {
      count: 0,
      matches: []
    };
  }

  // =============================
  // NORMALIZACIÓN
  // =============================
  const sourceText = caseSensitive ? text : text.toLowerCase();
  const sourceQuery = caseSensitive ? query : query.toLowerCase();

  // =============================
  // BÚSQUEDA
  // =============================
  const matches = [];
  let index = 0;

  while (index < sourceText.length) {
    const found = sourceText.indexOf(sourceQuery, index);

    if (found === -1) break;

    matches.push({
      position: found,
      match: text.substring(found, found + query.length)
    });

    index = allowOverlap
      ? found + 1
      : found + sourceQuery.length;
  }

  // =============================
  // RESPUESTA
  // =============================
  return {
    count: matches.length,
    matches
  };
}

module.exports = search_text;