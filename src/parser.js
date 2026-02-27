import { config } from './config.js';
import { parseCopAmount } from './utils/money.js';
import { parseSpanishDate, toISODate, nowInTZ } from './utils/dates.js';

const CATEGORY_RULES = [
  { cat: 'Alimentación', re: /\b(almuerzo|desayuno|cena|comida|restaurante|corrientazo|mercado|super|d1|ara|exito|carulla)\b/i },
  { cat: 'Transporte', re: /\b(uber|didi|taxi|metro|bus|peaje|gasolina|parqueadero)\b/i },
  { cat: 'Hogar', re: /\b(arriendo|servicios|luz|energia|agua|gas|internet|aseo)\b/i },
  { cat: 'Salud', re: /\b(farmacia|medicamento|eps|consulta|examen|odont)\b/i },
  { cat: 'Suscripciones', re: /\b(netflix|spotify|prime|hbo|icloud|google one|subscription|suscripcion)\b/i },
  { cat: 'Entretenimiento', re: /\b(cine|bar|rumba|concierto|juego|steam)\b/i },
  { cat: 'Compras', re: /\b(ropa|zapatos|amazon|mercadolibre|shein)\b/i },
];

export function categorize(concept) {
  const c = (concept || '').trim();
  for (const r of CATEGORY_RULES) {
    if (r.re.test(c)) return r.cat;
  }
  return 'Otros';
}

/**
 * Divide un mensaje con múltiples gastos:
 * - por saltos de línea
 * - por ";"
 * - por " y " SOLO si parece separar items con monto repetido
 */
export function splitExpensesText(text) {
  if (!text) return [];
  const normalized = text.replace(/\r/g, '');
  let parts = normalized.split('\n').flatMap(x => x.split(';'));
  parts = parts.map(x => x.trim()).filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

/**
 * Parse de gasto simple: "20000 almuerzo hoy", "pagué 150k mercado ayer", "45.000 uber"
 */
export function parseExpenseLine(line) {
  const tz = config.app.timezone;
  const s = String(line).trim();

  // 1) monto: primer match "número" o "n k"
  const amountMatch = s.match(/(\d[\d.,]*\s*k\b|\d[\d.,]*)/i);
  const amount = parseCopAmount(amountMatch?.[1] || '');
  if (!amount) return null;

  // 2) fecha: palabras o patrones dentro del texto
  const dt = parseSpanishDate(s, tz) || nowInTZ(tz).startOf('day');
  const dateISO = toISODate(dt);

  // 3) concepto: quitar monto y tokens de fecha comunes
  let concept = s;
  if (amountMatch?.index != null) {
    concept = concept.slice(0, amountMatch.index) + concept.slice(amountMatch.index + amountMatch[0].length);
  }
  concept = concept
    .replace(/\b(hoy|ayer)\b/gi, '')
    .replace(/\b(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/gi, '')
    .replace(/\b(20\d{2}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]20\d{2})?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!concept) concept = 'Gasto';

  const category = categorize(concept);

  return { dateISO, concept, amount, category };
}

/**
 * Parse general desde texto:
 * - si es extracto Bancolombia: usa parseBancolombiaMovements
 * - si no: parseExpenseLine por cada split
 */
export function parseIncomingText(text) {
  const t = String(text || '').trim();
  if (!t) return [];

  if (looksLikeBancolombia(t)) {
    return parseBancolombiaMovements(t);
  }

  const parts = splitExpensesText(t);
  const out = [];
  for (const p of parts) {
    const e = parseExpenseLine(p);
    if (e) out.push(e);
  }
  return out;
}

function looksLikeBancolombia(t) {
  const s = t.toLowerCase();
  return s.includes('bancolombia') || s.includes('saldo') || /movimientos|transacci/i.test(s);
}

/**
 * Extracto Bancolombia (OCR):
 * Objetivo: encontrar líneas con: fecha + descripción + valor
 * Heurística:
 * - fechas dd/mm o dd-mm
 * - valor negativo o valor con signo "-" o con "debito"
 * - ignorar positivos (ingresos) y saldos
 */
export function parseBancolombiaMovements(ocrText) {
  const tz = config.app.timezone;
  const lines = String(ocrText).split('\n').map(x => x.trim()).filter(Boolean);

  const movements = [];
  for (const line of lines) {
    const low = line.toLowerCase();

    // filtros: encabezados/saldos/refs típicas
    if (/(saldo|disponible|total|resumen|fecha\s+descripcion|referenc|oficina|nit|cuenta)/i.test(low)) continue;

    const dateMatch = line.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/);
    if (!dateMatch) continue;

    // extraer montos: si hay varios, tomar el más probable como débito (preferir con "-" o palabra "deb")
    const moneyCandidates = [...line.matchAll(/-?\$?\s*\d[\d.,]*/g)].map(m => m[0]).filter(x => /\d/.test(x));
    if (!moneyCandidates.length) continue;

    // elegir candidato: prioriza negativo
    let chosen = moneyCandidates.find(x => x.includes('-')) || moneyCandidates[moneyCandidates.length - 1];
    let amount = parseCopAmount(chosen);
    if (!amount) continue;

    // Regla: ignorar ingresos (positivos) → asumimos que en extracto OCR, gastos son débitos.
    // Si no hay signo -, intentamos inferir por keywords: "abono", "consign", "pago recibido" → ignorar
    const isIncome = /(abono|consign|pago\s+recib|ingreso|transferencia\s+recib)/i.test(low);
    if (isIncome) continue;

    // construir fecha: dd/mm (año actual)
    const dt = parseSpanishDate(dateMatch[0], tz) || nowInTZ(tz).startOf('day');
    const dateISO = toISODate(dt);

    // descripción: quitar fecha y monto(s)
    let concept = line
      .replace(dateMatch[0], '')
      .replace(/-?\$?\s*\d[\d.,]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!concept) concept = 'Movimiento Bancolombia';

    const category = categorize(concept);
    movements.push({ dateISO, concept, amount, category });
  }

  // dedupe interno por (date|amount|concept)
  const seen = new Set();
  const out = [];
  for (const m of movements) {
    const k = `${m.dateISO}|${m.amount}|${m.concept.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}
