import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { parseIncomingText } from './parser.js';
import { appendExpenseRow, ensureMonthSheet, getMonthData, listMonthTabs } from './services/sheetsService.js';
import { ocrExtractText } from './services/ocrService.js';
import { telegramGetFileUrl, downloadToTmp } from './utils/telegramFile.js';
import { formatCop } from './utils/money.js';
import { generateMonthlyAnalysis } from './services/geminiService.js';

const TG_API = `https://api.telegram.org/bot${config.telegram.token}`;

async function tgSendMessage(chatId, text) {
  await axios.post(`${TG_API}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  }, { timeout: 30000 });
}

function getTelegramUserName(from) {
  if (!from) return 'unknown';
  return from.username || [from.first_name, from.last_name].filter(Boolean).join(' ') || String(from.id);
}

function validateAmount(amount) {
  if (!Number.isFinite(amount)) return 'Monto inválido.';
  if (amount < config.app.minAmountCOP) return `Monto demasiado bajo (< ${config.app.minAmountCOP}).`;
  if (amount > config.app.maxAmountCOP) return `Monto demasiado alto (> ${config.app.maxAmountCOP}).`;
  return null;
}

export async function handleTelegramUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat?.id;
  const user = getTelegramUserName(msg.from);

  try {
    // Commands
    if (msg.text?.startsWith('/start')) {
      await tgSendMessage(chatId,
`Hola, *${user}* 👋
Envíame gastos como:
- \`20000 almuerzo hoy\`
- \`pagué 150k mercado ayer\`
O envía fotos/PDF de facturas/extractos (Bancolombia).
Comando: /analisis (mes actual o especifica \`/analisis 2026-02\`)`);
      return;
    }

    if (msg.text?.startsWith('/analisis')) {
      const parts = msg.text.trim().split(/\s+/);
      const month = parts[1] || null;
      await runAnalysis(chatId, month);
      return;
    }

    // 1) Texto simple
    if (msg.text) {
      await processText(chatId, user, msg.text);
      return;
    }

    // 2) Fotos
    if (msg.photo?.length) {
      const best = msg.photo[msg.photo.length - 1]; // mayor resolución
      await processFile(chatId, user, best.file_id, `photo-${best.file_unique_id}.jpg`);
      return;
    }

    // 3) Documentos (pdf / image)
    if (msg.document?.file_id) {
      const filename = msg.document.file_name || `doc-${msg.document.file_unique_id}`;
      await processFile(chatId, user, msg.document.file_id, filename);
      return;
    }

    await tgSendMessage(chatId, 'No entendí el mensaje. Envíame texto, foto o PDF.');

  } catch (e) {
    logger.error({ err: e }, 'handleTelegramUpdate failed');
    if (chatId) {
      await tgSendMessage(chatId, 'Ocurrió un error procesando tu solicitud. Intenta de nuevo o envía el texto del gasto.');
    }
  }
}

async function processText(chatId, user, text) {
  const expenses = parseIncomingText(text);
  if (!expenses.length) {
    await tgSendMessage(chatId, 'No pude detectar un gasto. Ej: `20000 almuerzo hoy`');
    return;
  }

  let inserted = 0;
  let duplicates = 0;
  let total = 0;

  for (const e of expenses) {
    const err = validateAmount(e.amount);
    if (err) continue;

    const res = await appendExpenseRow({ ...e, user });
    if (res.inserted) {
      inserted++;
      total += e.amount;
    } else {
      duplicates++;
    }
  }

  await tgSendMessage(chatId,
`Listo ✅
- Registrados: *${inserted}*
- Duplicados evitados: *${duplicates}*
- Total: *${formatCop(total)}*`);
}

async function processFile(chatId, user, fileId, filenameHint) {
  await tgSendMessage(chatId, 'Procesando archivo (OCR)… ⏳');

  const url = await telegramGetFileUrl(config.telegram.token, fileId);
  const localPath = await downloadToTmp(url, filenameHint);

  const ocrText = await ocrExtractText(localPath);
  if (!ocrText || ocrText.length < 10) {
    await tgSendMessage(chatId, 'No pude extraer texto del archivo. Intenta con una imagen más nítida.');
    return;
  }

  const expenses = parseIncomingText(ocrText);
  if (!expenses.length) {
    await tgSendMessage(chatId, 'Extraje texto, pero no identifiqué movimientos. Si es un extracto, intenta enviar una página donde se vean claramente los movimientos.');
    return;
  }

  let inserted = 0;
  let duplicates = 0;
  let total = 0;

  for (const e of expenses) {
    const err = validateAmount(e.amount);
    if (err) continue;

    const res = await appendExpenseRow({ ...e, user });
    if (res.inserted) {
      inserted++;
      total += e.amount;
    } else duplicates++;
  }

  await tgSendMessage(chatId,
`OCR listo ✅
- Movimientos detectados: *${expenses.length}*
- Registrados: *${inserted}*
- Duplicados evitados: *${duplicates}*
- Total: *${formatCop(total)}*`);
}

async function runAnalysis(chatId, monthArg) {
  // Si no dan mes, intentamos mes actual según TZ.
  const tz = config.app.timezone;
  const now = (await import('luxon')).DateTime.now().setZone(tz);
  const monthTitle = monthArg || now.toFormat('yyyy-LL');

  await ensureMonthSheet(monthTitle);
  const data = await getMonthData(monthTitle);

  if (!data.length) {
    await tgSendMessage(chatId, `No hay datos en *${monthTitle}* todavía.`);
    return;
  }

  // Historial: si hay otros meses, trae totales agregados (ligero)
  const tabs = await listMonthTabs();
  const history = {};
  for (const t of tabs) {
    if (t === monthTitle) continue;
    const d = await getMonthData(t);
    history[t] = {
      total: d.reduce((a, x) => a + x.amount, 0),
      count: d.length,
    };
  }

  const analysis = await generateMonthlyAnalysis({ monthTitle, data, historyByMonth: history });
  await tgSendMessage(chatId, analysis.slice(0, 3800)); // telegram límite práctico
  if (analysis.length > 3800) {
    await tgSendMessage(chatId, 'El análisis fue muy largo. Si quieres, lo ajusto para enviarlo en varias partes.');
  }
}
