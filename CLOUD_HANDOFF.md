# Continuazione Watchline nel cloud

## Stato al 5 ottobre 2026

Il codice di questo ramo contiene le protezioni della libreria gia pubblicate su https://watchline.netlify.app. Le regole in `firebase/firestore.rules` sono gia state pubblicate manualmente. Non ripubblicare o cambiare dati di produzione come parte della sola configurazione cloud.

## Recupero ancora da verificare

Una persona ha inserito circa 70 titoli dall'icona Watchline sulla Home del proprio iPhone. La copia cloud esaminata contiene 13 titoli. Il telefono originale non era disponibile durante l'indagine: i controlli su altri dispositivi non escludono una copia locale ancora presente su quell'iPhone.

Non dichiarare i titoli definitivamente irrecuperabili e non promettere che siano recuperabili. Nel database controllato non sono state trovate copie precedenti alla perdita. Tre versioni del sito pubblicate ad agosto usavano lo stesso progetto Firebase e non un backend alternativo. Le nuove copie create oggi contengono i titoli rimasti, non automaticamente quelli persi prima.

Quando e disponibile l'iPhone originale:

1. Non rimuovere l'icona e non cancellare i dati del sito.
2. Aprire Watchline dall'icona abituale e annotare il numero di titoli o eventuali errori.
3. In Preferenze, sezione Copie recuperabili, usare Scarica libreria e conservare il JSON.
4. Aprire Vedi copie e distinguere copie Cloud da Dispositivo.
5. Se una copia contiene titoli mancanti, Recupera aggiunge solo quelli mancanti. Attendere Libreria salvata nel cloud.
6. Se restano 13 titoli, esaminare il file fornito dalla persona prima di proporre altre azioni. Non ripristinare un backup dell'intero telefono senza aver verificato la possibilita di recupero e le conseguenze.

Il file scaricato puo contenere dati personali: non commetterlo su GitHub e non riportare i titoli in log o documentazione pubblica.

## Protezioni implementate

- `src/library-persistence.ts`: salvataggio locale atomico, giornale delle modifiche per utente, migrazione del vecchio archivio, fino a 5 copie locali.
- `src/library-controller.ts`: salvataggio locale prima del successo UI, invii cloud seriali, retry, conservazione delle modifiche offline.
- `src/cloud-sync.ts`: unione iniziale e merge delle modifiche su una base confermata, conservando modifiche indipendenti di altri dispositivi.
- `src/cloud.ts`: transazioni Firestore con merge, fino a 20 copie precedenti a rotazione e una copia prima della prima modifica giornaliera.
- `firebase/firestore.rules`: accesso per proprietario, revisioni incrementali per bloccare vecchi client e nessuna cancellazione del documento principale.
- `src/LibrarySafetyPanel.tsx`: copie recuperabili, recupero dei soli titoli mancanti ed esportazione JSON.
- `public/sw.js`: aggiornamento PWA e cache della pagina e degli asset per riapertura offline.

## Verifica e limiti

Eseguire `npm ci`, `npm test`, `npm run build`. I test coprono migrazione 70/13, modifiche offline e riapertura, concorrenza, rimozioni volontarie, isolamento utenti, copie locali, quota e dati corrotti.

Sono stati verificati browser desktop e viewport mobile, un caso simulato 70 titoli e il salvataggio autenticato del sito pubblicato. L'iPhone originale non e stato verificato direttamente. Il recupero dei titoli storici rimane aperto.

`.env.local` e escluso da Git e non e trasferito automaticamente. Senza configurazione Firebase un ambiente cloud puo eseguire test/build ma non verificare l'accesso alla produzione. Per configurazione consultare `.env.example` e `FIREBASE_SETUP.md`. Non copiare credenziali dal PC, dal browser o dai servizi nel repository. Gli accessi Firebase e Netlify della sessione desktop non passano automaticamente al cloud.

Per continuare l'indagine occorre il risultato dei controlli sull'iPhone o il JSON esportato. In attesa di questi dati, evitare modifiche speculative e richieste di reinserire manualmente i titoli.
