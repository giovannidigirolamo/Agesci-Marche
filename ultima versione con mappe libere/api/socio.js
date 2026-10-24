// api/socio.js
// Un'unica funzione per: registrazione (codice socio + email + password),
// accesso (codice socio + password), reimpostazione password (solo superadmin)
// e diagnostica (aprendo l'indirizzo /api/socio nel browser).
import admin from 'firebase-admin';
import crypto from 'node:crypto';

const SUPERADMIN_EMAIL = 'comunicazione@marche.agesci.it';
const MAX_TENTATIVI = 5;
const BLOCCO_MINUTI = 15;

// Inizializzazione dentro la funzione (non all'import): se manca una variabile
// d'ambiente si ottiene un errore leggibile invece di una pagina 500 muta.
function inizializza() {
  if (!admin.apps.length) {
    const mancanti = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
      .filter(k => !process.env[k]);
    if (mancanti.length) throw new Error('variabili mancanti su Vercel: ' + mancanti.join(', '));
    let chiave = process.env.FIREBASE_PRIVATE_KEY.trim();
    if (chiave.startsWith('"') && chiave.endsWith('"')) chiave = chiave.slice(1, -1);
    chiave = chiave.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: chiave,
      }),
    });
  }
  return admin.firestore();
}

function creaHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verificaHash(password, salvato) {
  try {
    const [salt, hash] = String(salvato).split(':');
    const prova = crypto.scryptSync(password, salt, 64);
    const atteso = Buffer.from(hash, 'hex');
    return atteso.length === prova.length && crypto.timingSafeEqual(atteso, prova);
  } catch (e) {
    return false;
  }
}

function codiceValido(c) {
  return typeof c === 'string' && c.length > 0 && c.length <= 100 && !/[\/\s]/.test(c);
}

export default async function handler(req, res) {
  // Permette di chiamare la funzione anche se il sito è ospitato su un altro dominio.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let db;
  try {
    db = inizializza();
  } catch (e) {
    return res.status(500).json({ error: 'Configurazione del server incompleta: ' + e.message });
  }

  // Diagnostica: aprire https://TUO-SITO/api/socio nel browser.
  if (req.method === 'GET') {
    let soci = null;
    try { soci = (await db.collection('soci_validi').count().get()).data().count; } catch (e) { /* non bloccante */ }
    return res.status(200).json({ ok: true, messaggio: 'Il servizio funziona.', progetto: process.env.FIREBASE_PROJECT_ID, sociInElenco: soci });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const { azione } = body;
  const codice = String(body.codiceSocio || '').trim();

  try {
    // ---------- REGISTRAZIONE ----------
    if (azione === 'registra') {
      const emailIn = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!codiceValido(codice) || !emailIn || !password) {
        return res.status(400).json({ error: 'Inserisci codice socio, email e password.' });
      }
      if (password.length < 6) return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri.' });

      const socioSnap = await db.collection('soci_validi').doc(codice).get();
      if (!socioSnap.exists) {
        return res.status(404).json({ error: 'Codice socio non presente nell\'elenco. Controlla di averlo scritto correttamente o contatta la segreteria regionale.' });
      }
      const socio = socioSnap.data();
      const emailElenco = String(socio.email || '').trim().toLowerCase();
      if (!emailElenco) {
        return res.status(403).json({ error: 'Per questo codice socio non risulta un\'email nell\'elenco: contatta la segreteria regionale.' });
      }
      if (emailElenco !== emailIn) {
        return res.status(403).json({ error: 'L\'email non corrisponde a quella registrata per questo codice socio.' });
      }
      // L'email dell'amministrazione regionale non può mai diventare un account "socio":
      // darebbe gli stessi permessi del superadmin a chi si registra per primo.
      if (emailElenco === SUPERADMIN_EMAIL.toLowerCase()) {
        return res.status(403).json({ error: 'Questo account usa "Accesso amministratore".' });
      }

      const credRef = db.collection('credenziali_soci').doc(codice);
      if ((await credRef.get()).exists) {
        return res.status(409).json({ error: 'Questo codice socio ha già un account: usa "Accedi". Se non ricordi la password, contatta la segreteria regionale.' });
      }

      try {
        await admin.auth().createUser({ uid: codice, displayName: `${socio.nome || ''} ${socio.cognome || ''}`.trim() || undefined });
      } catch (e) {
        if (e.code !== 'auth/uid-already-exists') throw e;
      }
      // Il profilo si crea solo la prima volta: dopo un reset password resta quello
      // esistente, così non si perdono ruoli admin né eventuali modifiche di zona/gruppo.
      const profiloRef = db.collection('profili').doc(codice);
      if (!(await profiloRef.get()).exists) {
        await profiloRef.set({
          codiceSocio: codice,
          email: emailElenco,
          nomeCognome: `${socio.nome || ''} ${socio.cognome || ''}`.trim(),
          zona: socio.zona || '',
          groupName: socio.gruppo || '',
          branche: socio.branca ? [socio.branca] : [],
          zoneGroupUpdatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          isAdmin: false,
          disabledModules: ['eventi', 'bilanci']
        });
      }
      // Le credenziali si salvano per ultime: se un passaggio precedente fallisce
      // si può semplicemente riprovare, senza restare bloccati.
      await credRef.set({ passwordHash: creaHash(password), tentativi: 0, createdAt: new Date().toISOString() });

      const token = await admin.auth().createCustomToken(codice, { email: emailElenco });
      return res.status(200).json({ success: true, token });
    }

    // ---------- ACCESSO ----------
    if (azione === 'accedi') {
      const password = String(body.password || '');
      if (!codiceValido(codice) || !password) return res.status(400).json({ error: 'Inserisci codice socio e password.' });

      const credRef = db.collection('credenziali_soci').doc(codice);
      const credSnap = await credRef.get();
      if (!credSnap.exists) {
        return res.status(404).json({ error: 'Account non ancora attivato: usa "Prima volta? Attiva il tuo account".' });
      }
      const cred = credSnap.data();
      if (cred.bloccatoFinoA && new Date(cred.bloccatoFinoA) > new Date()) {
        return res.status(429).json({ error: `Troppi tentativi errati. Riprova tra qualche minuto.` });
      }
      if (!verificaHash(password, cred.passwordHash)) {
        const tentativi = (cred.tentativi || 0) + 1;
        const aggiorna = { tentativi };
        if (tentativi >= MAX_TENTATIVI) {
          aggiorna.bloccatoFinoA = new Date(Date.now() + BLOCCO_MINUTI * 60000).toISOString();
          aggiorna.tentativi = 0;
        }
        await credRef.update(aggiorna);
        return res.status(401).json({ error: 'Password errata.' });
      }
      await credRef.update({ tentativi: 0, bloccatoFinoA: null });

      const profilo = await db.collection('profili').doc(codice).get();
      const email = profilo.exists ? String(profilo.data().email || '').toLowerCase() : '';
      if (email === SUPERADMIN_EMAIL.toLowerCase()) {
        return res.status(403).json({ error: 'Questo account usa "Accesso amministratore".' });
      }
      const token = await admin.auth().createCustomToken(codice, { email });
      return res.status(200).json({ success: true, token });
    }

    // ---------- REIMPOSTA PASSWORD (solo superadmin) ----------
    if (azione === 'reimposta') {
      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return res.status(401).json({ error: 'Accesso non autorizzato.' });
      let chiamante;
      try { chiamante = (await admin.auth().verifyIdToken(idToken)).email; } catch (e) {
        return res.status(401).json({ error: 'Sessione non valida: esci e rientra.' });
      }
      if (chiamante !== SUPERADMIN_EMAIL) return res.status(403).json({ error: 'Solo il superadmin può reimpostare una password.' });
      if (!codiceValido(codice)) return res.status(400).json({ error: 'Codice socio non valido.' });
      await db.collection('credenziali_soci').doc(codice).delete();
      return res.status(200).json({ success: true, message: 'Password azzerata: il socio può riattivare l\'account con codice socio ed email.' });
    }

    return res.status(400).json({ error: 'Richiesta non valida.' });
  } catch (error) {
    return res.status(500).json({ error: 'Errore del server: ' + error.message });
  }
}
