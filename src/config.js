import 'dotenv/config';

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 8080),

  telegram: {
    token: must('TELEGRAM_BOT_TOKEN'),
    secretPath: must('TELEGRAM_WEBHOOK_SECRET_PATH'), // e.g. /telegram/webhook/abc123
  },

  google: {
    projectId: must('GOOGLE_PROJECT_ID'),
    sheetsSpreadsheetId: must('SHEETS_SPREADSHEET_ID'),
    gcsBucket: process.env.GCS_BUCKET || '', // requerido si procesas PDFs
  },

  gemini: {
    apiKey: must('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
  },

  app: {
    timezone: process.env.APP_TIMEZONE || 'America/Bogota',
    defaultCurrency: 'COP',
    maxAmountCOP: Number(process.env.MAX_AMOUNT_COP || 50000000),
    minAmountCOP: Number(process.env.MIN_AMOUNT_COP || 100),
  },
};
