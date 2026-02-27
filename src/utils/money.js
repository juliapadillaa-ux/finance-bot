export function parseCopAmount(raw) {
  if (!raw) return null;
  let s = String(raw).toLowerCase().trim();

  // Ej: "150k", "150.5k"
  const kMatch = s.match(/(\d+(?:[.,]\d+)?)\s*k\b/);
  if (kMatch) {
    const n = Number(kMatch[1].replace(',', '.'));
    if (Number.isFinite(n)) return Math.round(n * 1000);
  }

  // Quitar símbolos y espacios
  s = s.replace(/[^\d.,-]/g, '');
  // Si tiene ambos separadores, asumimos "." miles y "," decimales (común ES) → para COP ignoramos decimales
  // Normalizamos quitando separadores de miles
  // Casos: "45.000" "45,000" "45000"
  // Estrategia: quedarnos solo con dígitos y signo.
  const digits = s.replace(/[.,]/g, '');
  const val = Number(digits);
  if (!Number.isFinite(val)) return null;
  return Math.abs(Math.trunc(val));
}

export function formatCop(n) {
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n} COP`;
  }
}
