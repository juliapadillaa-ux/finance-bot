import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

export async function generateMonthlyAnalysis({ monthTitle, data, historyByMonth }) {
  const model = genAI.getGenerativeModel({ model: config.gemini.model });

  // Reducir tokens: agregamos estadísticas base y entregamos filas resumidas
  const payload = {
    month: monthTitle,
    totals: summarize(data),
    byUser: summarizeByUser(data),
    byCategory: summarizeByCategory(data),
    rawSample: data.slice(0, 200), // límite defensivo
    history: historyByMonth || {},
  };

  const prompt = `
Eres un analista financiero personal. Con base en los datos (COP) genera:

1) Resumen financiero del mes. Si hay historial, compara con meses anteriores.
2) Tabla de distribución por categoría (categoría, total, %).
3) Identificación de "gastos hormiga" (frecuentes, bajos, suman mucho).
4) Tendencias de gasto (semanas, categorías, usuarios).
5) Recomendaciones accionables (bullet points claros).
6) Score financiero 0-100 (explica criterios brevemente).
7) Observaciones personalizadas por usuario (mínimo 3 bullets por usuario).

Requisitos de salida:
- Formato en Markdown.
- Incluye una tabla Markdown para categorías.
- Conclusiones accionables al final.

Datos JSON:
${JSON.stringify(payload)}
`.trim();

  const result = await model.generateContent(prompt);
  const text = result?.response?.text?.() || '';
  return text;
}

function summarize(data) {
  const total = data.reduce((a, x) => a + (x.amount || 0), 0);
  return { total, count: data.length };
}
function summarizeByUser(data) {
  const m = {};
  for (const x of data) {
    m[x.user] = (m[x.user] || 0) + x.amount;
  }
  return m;
}
function summarizeByCategory(data) {
  const m = {};
  for (const x of data) {
    const k = x.category || 'Otros';
    m[k] = (m[k] || 0) + x.amount;
  }
  return m;
}
