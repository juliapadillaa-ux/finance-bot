import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { logger } from './logger.js';
import { handleTelegramUpdate } from './bot.js';

const app = express();

app.use(helmet());
app.use(express.json({ limit: '20mb' }));

app.get('/health', (_, res) => res.status(200).send('ok'));

// Webhook con path secreto para evitar tráfico random
app.post(config.telegram.secretPath, async (req, res) => {
  res.status(200).send('ok'); // responder rápido a Telegram
  await handleTelegramUpdate(req.body);
});

app.listen(config.port, () => {
  logger.info({ port: config.port, webhook: config.telegram.secretPath }, 'Server started');
});
