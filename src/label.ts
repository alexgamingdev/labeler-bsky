import { LabelerServer } from '@skyware/labeler';

import { DID, SIGNING_KEY } from './config.js';
import logger from './logger.js';

// Wir erstellen den Server hier und exportieren ihn
export const labelerServer = new LabelerServer({
  did: DID,
  signingKey: SIGNING_KEY,
});

export function label(targetDid: string, rkey: string) {
  try {
    // Prüfe ob das Label bereits existiert, um Duplikate zu vermeiden
    const existing = labelerServer.db
      .prepare('SELECT COUNT(*) as count FROM labels WHERE uri = ? AND val = ? AND neg = 0')
      .get(targetDid, 'verifiziert') as { count: number };

    if (existing.count > 0) {
      logger.info(`Label 'verifiziert' für ${targetDid} existiert bereits, überspringe.`);
      return;
    }

    // Erstellt das Label 'verifiziert' für die Ziel-DID
    labelerServer.createLabel({
      val: 'verifiziert',
      uri: targetDid,
    });
    logger.info(`Label 'verifiziert' erfolgreich für ${targetDid} vergeben (rkey: ${rkey}).`);
  } catch (error) {
    logger.error(`Fehler beim Labeln von ${targetDid}: ${error}`);
  }
}
