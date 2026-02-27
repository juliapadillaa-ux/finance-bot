import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';
import vision from '@google-cloud/vision';
import { logger } from '../logger.js';
import { config } from '../config.js';

const visionClient = new vision.ImageAnnotatorClient();
const storage = new Storage();

function isPdf(filePath) {
  return path.extname(filePath).toLowerCase() === '.pdf';
}

export async function ocrExtractText(filePath) {
  if (isPdf(filePath)) {
    if (!config.google.gcsBucket) {
      throw new Error('GCS_BUCKET is required to OCR PDFs with Vision asyncBatchAnnotateFiles');
    }
    return await ocrPdfViaGcs(filePath);
  }
  return await ocrImage(filePath);
}

async function ocrImage(filePath) {
  const [result] = await visionClient.textDetection(filePath);
  const text = result?.fullTextAnnotation?.text || '';
  logger.info({ len: text.length }, 'OCR image extracted');
  return text;
}

/**
 * Vision OCR PDF requiere GCS input/output.
 * - Sube PDF a gs://bucket/in/...
 * - Ejecuta asyncBatchAnnotateFiles
 * - Lee JSON de salida y concatena texto
 */
async function ocrPdfViaGcs(localPdfPath) {
  const bucketName = config.google.gcsBucket;
  const inName = `vision-in/${Date.now()}-${path.basename(localPdfPath)}`;
  const outPrefix = `vision-out/${Date.now()}-${path.basename(localPdfPath, '.pdf')}/`;

  await storage.bucket(bucketName).upload(localPdfPath, { destination: inName });
  const gcsSourceUri = `gs://${bucketName}/${inName}`;
  const gcsDestinationUri = `gs://${bucketName}/${outPrefix}`;

  const request = {
    requests: [
      {
        inputConfig: { gcsSource: { uri: gcsSourceUri }, mimeType: 'application/pdf' },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        outputConfig: { gcsDestination: { uri: gcsDestinationUri }, batchSize: 5 },
      },
    ],
  };

  const [operation] = await visionClient.asyncBatchAnnotateFiles(request);
  await operation.promise();

  // Leer outputs JSON
  const [files] = await storage.bucket(bucketName).getFiles({ prefix: outPrefix });
  const jsonFiles = files.filter(f => f.name.endsWith('.json'));

  let fullText = '';
  for (const f of jsonFiles) {
    const [buf] = await f.download();
    const payload = JSON.parse(buf.toString('utf8'));
    const responses = payload?.responses || [];
    for (const resp of responses) {
      const t = resp?.fullTextAnnotation?.text;
      if (t) fullText += t + '\n';
    }
  }

  logger.info({ len: fullText.length, jsonCount: jsonFiles.length }, 'OCR PDF extracted');
  return fullText.trim();
}
