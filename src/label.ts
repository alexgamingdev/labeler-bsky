import { LabelerServer } from '@skyware/labeler';

import { BSKY_IDENTIFIER, BSKY_PASSWORD, DID, SIGNING_KEY } from './config.js';

// Wir erstellen den Server hier und exportieren ihn
export const labelerServer = new LabelerServer({
  did: DID,
  signingKey: SIGNING_KEY,
});

export function label(targetDid: string, rkey: string) {
  try {
    // Erstellt das Label 'verifiziert' für die Ziel-DID
    labelerServer.createLabel({
      val: 'verifiziert',
      uri: targetDid,
    });
  } catch (error) {
    console.error(`Fehler beim Labeln von ${targetDid}:`, error);
  }
}
