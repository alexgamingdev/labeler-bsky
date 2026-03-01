import { CommitCreateEvent, Jetstream } from '@skyware/jetstream';
import fs from 'node:fs';

import { CURSOR_UPDATE_INTERVAL, DID, FIREHOSE_URL, HOST, METRICS_PORT, PORT, WANTED_COLLECTION } from './config.js';
import { label, labelerServer } from './label.js';
import logger from './logger.js';
import { startMetricsServer } from './metrics.js';

let cursor = 0;
let cursorUpdateInterval: NodeJS.Timeout;

function epochUsToDateTime(cursor: number): string {
  return new Date(cursor / 1000).toISOString();
}

// --- MANUELLE VERIFIKATION BEIM START ---
function runManualVerification() {
  try {
    if (fs.existsSync('verifiziert.ah')) {
      const data = fs.readFileSync('verifiziert.ah', 'utf8');
      const verifiedDids = data
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('did:'));

      logger.info(`${verifiedDids.length} DIDs in verifiziert.ah gefunden. Starte Labeling...`);

      for (const targetDid of verifiedDids) {
        // Wir nutzen 'verifiziert' als Standard-rkey, da wir manuell labeln
        label(targetDid, 'verifiziert');
      }
    } else {
      logger.warn('Datei verifiziert.ah nicht gefunden. Erstelle leere Datei...');
      fs.writeFileSync('verifiziert.ah', '', 'utf8');
    }
  } catch (error) {
    logger.error(`Fehler bei der manuellen Verifikation: ${error}`);
  }
}

// --- CURSOR INITIALISIERUNG ---
try {
  logger.info('Trying to read cursor from cursor.txt...');
  cursor = Number(fs.readFileSync('cursor.txt', 'utf8'));
  logger.info(`Cursor found: ${cursor} (${epochUsToDateTime(cursor)})`);
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    cursor = Math.floor(Date.now() * 1000);
    logger.info(`Cursor not found in cursor.txt, setting cursor to: ${cursor} (${epochUsToDateTime(cursor)})`);
    fs.writeFileSync('cursor.txt', cursor.toString(), 'utf8');
  } else {
    logger.error(error);
    process.exit(1);
  }
}

const jetstream = new Jetstream({
  wantedCollections: [WANTED_COLLECTION],
  endpoint: FIREHOSE_URL,
  cursor: cursor,
});

jetstream.on('open', () => {
  logger.info(
    `Connected to Jetstream at ${FIREHOSE_URL} with cursor ${jetstream.cursor} (${epochUsToDateTime(jetstream.cursor!)})`,
  );
  cursorUpdateInterval = setInterval(() => {
    if (jetstream.cursor) {
      logger.info(`Cursor updated to: ${jetstream.cursor} (${epochUsToDateTime(jetstream.cursor)})`);
      fs.writeFile('cursor.txt', jetstream.cursor.toString(), (err) => {
        if (err) logger.error(err);
      });
    }
  }, CURSOR_UPDATE_INTERVAL);
});

jetstream.on('close', () => {
  clearInterval(cursorUpdateInterval);
  logger.info('Jetstream connection closed.');
});

jetstream.on('error', (error) => {
  logger.error(`Jetstream error: ${error.message}`);
});

jetstream.onCreate(WANTED_COLLECTION, (event: CommitCreateEvent<typeof WANTED_COLLECTION>) => {
  // Wenn DU einen Post likes, bekommt der Ersteller ein Label
  if (event.did === DID) {
    const subjectUri = event.commit?.record?.subject?.uri;
    if (subjectUri) {
      // Extrahiere die Ersteller-DID aus der Post-URI (Format: at://did:plc:xxxxx/app.bsky.feed.post/rkey)
      const posterDid = subjectUri.split('/')[2];
      if (posterDid && posterDid.startsWith('did:')) {
        logger.info(`Du likest einen Post von ${posterDid}. Vergebe Label...`);
        label(posterDid, subjectUri.split('/').pop()!);
      }
    }
  }
});

const metricsServer = startMetricsServer(METRICS_PORT);

labelerServer.app.listen({ port: PORT, host: HOST }, (error, address) => {
  if (error) {
    logger.error('Error starting server: %s', error);
  } else {
    logger.info(`Labeler server listening on ${address}`);

    // Starte die manuelle Verifikation aus der .ah Datei, sobald der Server bereit ist
    runManualVerification();

    // Wenn du GitHub Actions nutzt: Hier könnte man process.exit(0) einbauen,
    // damit die Action nach dem Labeln sofort beendet wird.
  }
});

jetstream.start();

function shutdown() {
  try {
    logger.info('Shutting down gracefully...');
    if (jetstream.cursor) {
      fs.writeFileSync('cursor.txt', jetstream.cursor.toString(), 'utf8');
    }
    jetstream.close();
    labelerServer.stop();
    metricsServer.close();
  } catch (error) {
    logger.error(`Error shutting down gracefully: ${error}`);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
