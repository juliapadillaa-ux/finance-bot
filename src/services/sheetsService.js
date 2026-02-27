import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { movementHash } from '../utils/hash.js';

const sheets = google.sheets('v4');

function authClient() {
  // En Cloud Run, usa Application Default Credentials (Service Account del servicio).
  // Local: GOOGLE_APPLICATION_CREDENTIALS apuntando a JSON.
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheetsClient() {
  const auth = await authClient().getClient();
  return { auth };
}

const META_SHEET_TITLE = '__meta';
const META_HEADERS = ['hash', 'createdAtISO'];

export async function ensureMonthSheet(monthTitle) {
  const { auth } = await getSheetsClient();
  const spreadsheetId = config.google.sheetsSpreadsheetId;

  const ss = await sheets.spreadsheets.get({ auth, spreadsheetId });
  const titles = ss.data.sheets?.map(s => s.properties?.title) || [];

  const requests = [];
  if (!titles.includes(monthTitle)) {
    requests.push({
      addSheet: { properties: { title: monthTitle } },
    });
  }
  if (!titles.includes(META_SHEET_TITLE)) {
    requests.push({
      addSheet: { properties: { title: META_SHEET_TITLE, hidden: true } },
    });
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      auth,
      spreadsheetId,
      requestBody: { requests },
    });
  }

  // Asegurar headers mes y meta
  await ensureHeaders(monthTitle, ['Fecha', 'Concepto', 'Valor', 'Usuario', 'Categoría']);
  await ensureHeaders(META_SHEET_TITLE, META_HEADERS);

  return monthTitle;
}

async function ensureHeaders(sheetTitle, headers) {
  const { auth } = await getSheetsClient();
  const spreadsheetId = config.google.sheetsSpreadsheetId;

  const range = `${sheetTitle}!A1:Z1`;
  const r = await sheets.spreadsheets.values.get({ auth, spreadsheetId, range });
  const existing = r.data.values?.[0] || [];
  const needs = headers.some((h, i) => (existing[i] || '').trim() !== h);

  if (needs) {
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
}

export function monthTabFromISODate(dateISO, tz) {
  const dt = DateTime.fromISO(dateISO, { zone: tz });
  return dt.toFormat('yyyy-LL'); // 2026-02
}

async function metaHasHash(hash) {
  const { auth } = await getSheetsClient();
  const spreadsheetId = config.google.sheetsSpreadsheetId;

  // Nota: para alto volumen, conviene cache/DB. Para 2 usuarios sirve.
  const range = `${META_SHEET_TITLE}!A:A`;
  const r = await sheets.spreadsheets.values.get({ auth, spreadsheetId, range });
  const col = (r.data.values || []).flat().map(String);
  return col.includes(hash);
}

async function metaAppendHash(hash) {
  const { auth } = await getSheetsClient();
  const spreadsheetId = config.google.sheetsSpreadsheetId;

  await sheets.spreadsheets.values.append({
    auth,
    spreadsheetId,
    range: `${META_SHEET_TITLE}!A:B`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[hash, new Date().toISOString()]],
    },
  });
}

export async function appendExpenseRow({ dateISO, concept, amount, user, category }) {
  if (!dateISO || !concept || !amount || !user) {
    throw new Error('appendExpenseRow missing required fields');
  }

  const monthTitle = monthTabFromISODate(dateISO, config.app.timezone);
  await ensureMonthSheet(monthTitle);

  const hash = movementHash({ user, dateISO, amount, concept });
  if (await metaHasHash(hash)) {
    logger.warn({ hash }, 'Duplicate prevented');
    return { inserted: false, reason: 'duplicate' };
  }

  const { auth } = await getSheetsClient();
  const spreadsheetId = config.google.sheetsSpreadsheetId;

  await sheets.spreadsheets.values.append({
    auth,
    spreadsheetId,
    range: `${monthTitle}!A:E`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[dateISO, concept, amount, user, category]],
    },
  });

  await metaAppendHash(hash);
  return { inserted: true, monthTitle };
}

export async function getMonthData(monthTitle) {
  const { auth } = await getSheetsClient();
  const spreadsheetId = config.google.sheetsSpreadsheetId;

  const range = `${monthTitle}!A:E`;
  const r = await sheets.spreadsheets.values.get({ auth, spreadsheetId, range });
  const rows = r.data.values || [];
  if (rows.length <= 1) return [];

  const [header, ...data] = rows;
  const idx = {
    date: header.indexOf('Fecha'),
    concept: header.indexOf('Concepto'),
    value: header.indexOf('Valor'),
    user: header.indexOf('Usuario'),
    category: header.indexOf('Categoría'),
  };

  return data.map(row => ({
    dateISO: row[idx.date],
    concept: row[idx.concept],
    amount: Number(row[idx.value]),
    user: row[idx.user],
    category: row[idx.category],
  })).filter(x => x.dateISO && x.concept && Number.isFinite(x.amount));
}

export async function listMonthTabs() {
  const { auth } = await getSheetsClient();
  const spreadsheetId = config.google.sheetsSpreadsheetId;
  const ss = await sheets.spreadsheets.get({ auth, spreadsheetId });
  return (ss.data.sheets || [])
    .map(s => s.properties?.title)
    .filter(t => t && /^\d{4}-\d{2}$/.test(t));
}
