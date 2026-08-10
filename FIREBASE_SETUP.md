# Configurazione cloud di Watchline con Firebase

## 1. Crea il progetto e registra l'app web

1. Crea un progetto in [Firebase Console](https://console.firebase.google.com/).
2. In **Authentication → Sign-in method**, abilita **Email/Password**.
3. In **Firestore Database**, crea il database in modalità produzione.
4. In **Project settings → Your apps**, registra una nuova app Web e copia la configurazione nel file `.env.local` usando `.env.example` come traccia.

Questi valori di configurazione web non sono password. Non inserire mai nel frontend credenziali Admin SDK o file di servizio.

## 2. Regole Firestore

Apri **Firestore Database → Rules** e incolla `firebase/firestore.rules`, poi pubblica le regole.

Ogni account può leggere e modificare solo il proprio documento `watchline_users/{uid}`.

## 3. I due utenti

Firebase Auth usa internamente un alias tecnico, ma Watchline mostra solo username e password:

`nomeutente@watchline.com`

In **Authentication → Users → Add user**, crea i due account con l'alias corrispondente e una password. L'app userà solo il prefisso come nome utente, ad esempio `marco`.

I nomi utente ammessi sono 3–32 caratteri: lettere minuscole, numeri e `_`.

Riavvia Vite dopo aver salvato `.env.local`. Per Netlify, inserisci le stesse variabili nella configurazione del sito e fai un nuovo deploy.
