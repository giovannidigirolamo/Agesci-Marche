# Build APK Android

Questa cartella di progetto è predisposta per generare un **file APK Android** dell'app tramite Capacitor.
L'APK non viene creato dal sito a runtime: è un pacchetto Android che deve essere compilato con Android Studio
oppure con la pipeline GitHub Actions inclusa.

## 1. Build automatica con GitHub Actions

Il workflow si trova in `.github/workflows/build-apk.yml`.

1. Pubblica il progetto su un repository GitHub.
2. Se il sito è pubblicato, imposta in **Settings → Secrets and variables → Actions → Variables** la variabile:
   - `APP_API_BASE` = indirizzo completo del sito (es. `https://agesci-marche.vercel.app`).
   - Serve perché l'APK carica i file in locale: senza questo valore il login tramite codice socio non trova `/api/socio`.
3. Avvia il workflow **Build Android APK** da **Actions → Build Android APK → Run workflow**.
4. Scarica l'artefatto `Agesci-Marche-APK` e prendi il file `agesci-marche.apk`.

In alternativa, creando un tag `v1.0.0` il workflow allega l'APK anche alla Release GitHub.

## 2. Build locale con Android Studio

Requisiti: Node.js 22+, JDK 21, Android SDK.

```bash
npm install
npm run app:prepare
npx cap add android
npx cap sync android
npx cap open android
```

Da Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

Per la riga di comando:

```bash
cd android
./gradlew assembleDebug
```

Il file viene creato in:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## 3. Pubblicare l'APK sul sito

Copia l'APK generato in:

```text
downloads/agesci-marche.apk
```

Poi apri `downloads/apk-info.json` e imposta `"available": true`.

Il pulsante **“Scarica APK Android”** nel profilo utente diventa automaticamente attivo quando il file è presente.
Il file `vercel.json` imposta il tipo MIME corretto per il download.

Per la pubblicazione tramite Git/Vercel, includi il file APK nel repository (non è escluso da `.gitignore`).

## 4. Firma per la distribuzione

L'APK debug è installabile per test, ma non è adatto alla pubblicazione ufficiale.
Per una distribuzione stabile crea una keystore e configura la firma release in `android/app/build.gradle`.
Non salvare la keystore nel repository: usa i secret di GitHub Actions.

## Nota su iOS

Un file APK funziona solo su Android. Su iPhone/iPad non è possibile installare APK:
per iOS serve una distribuzione tramite App Store o TestFlight.
