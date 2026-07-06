# 99 nätter på kronan

Three.js-spel: Sigge (dvärgvädur) i en trädgård med dag/natt-cykler, räv, katt, återväxande morötter och skyddsföremål. Spelas på [andreasmartensson.com/99-natter-pa-kronan](https://andreasmartensson.com/99-natter-pa-kronan/) efter publicering från AMC.

## Utveckling

```bash
npm install
npm run dev:multi
```

`npm run dev:multi` startar både den lokala WebSocket-servern på `ws://localhost:8787` och Vite på `http://localhost:5174/99-natter-pa-kronan/`. Kör `npm run dev` bara om du uttryckligen vill starta frontend utan multiplayer-server.

`vite.config.ts` sätter `base: '/99-natter-pa-kronan/'` så länkar passar när bygget ligger i en undermapp på domänen.

## Publicera till andreasmartensson.com (AMC)

Bygg och kopiera statiska filer till grannmappens `AMC` (kräver att båda projekten ligger sida-vid-sida under samma `Vibe`-rot):

```bash
VITE_SIGGE_WS_URL=wss://DIN-SERVER-DOMAN npm run build:amc
```

Sedan i `AMC`: `npm run deploy` (enligt det repots [README](../AMC/README.md)).

Kort: `public/99-natter-pa-kronan/` i AMC speglas till webrooten som `/99-natter-pa-kronan/` av `scripts/deploy.sh`.

## Multiplayer-server på Synology NAS

Servern är en Node/WebSocket-process som körs som Docker-container. Den lyssnar på port `8787` internt och har health endpoint på `http://NAS-IP:8787/health`.

### Lokal verifiering

```bash
npm run server
npm run server:check -- ws://127.0.0.1:8787
curl http://127.0.0.1:8787/health
```

### Synology Container Manager

1. Säkerställ att NAS:en har **Container Manager** installerat.
2. Kopiera hela projektmappen till NAS:en, eller åtminstone `Dockerfile`, `docker-compose.yml`, `package.json`, `package-lock.json`, `server/` och `scripts/`.
3. I DSM: öppna **Container Manager** → **Project** → **Create**.
4. Välj projektmappen och använd `docker-compose.yml`.
5. Starta projektet `sigge-hoppar-server`.
6. Verifiera från en dator i nätverket:

```bash
curl http://NAS-IP:8787/health
npm run server:check -- ws://NAS-IP:8787
```

### Publik åtkomst via DSM Reverse Proxy

1. Skapa DNS för en subdomän, t.ex. `sigge.andreasmartensson.com`, som pekar mot din publika IP eller Synology DDNS.
2. Öppna/vidarebefordra port `443` i routern till NAS:en.
3. I DSM: **Control Panel** → **Login Portal** → **Advanced** → **Reverse Proxy**.
4. Skapa regel:
   - Source protocol: `HTTPS`
   - Source hostname: `sigge.andreasmartensson.com`
   - Source port: `443`
   - Destination protocol: `HTTP`
   - Destination hostname: `localhost`
   - Destination port: `8787`
5. Lägg till WebSocket-stöd i reverse proxy-regeln via custom headers/WebSocket-alternativet.
6. Kontrollera SSL-certifikat i DSM för subdomänen.
7. Verifiera publikt:

```bash
curl https://sigge.andreasmartensson.com/health
npm run server:check -- wss://sigge.andreasmartensson.com
```

När detta fungerar kan frontend byggas med:

```bash
VITE_SIGGE_WS_URL=wss://sigge.andreasmartensson.com npm run build:amc
```

## Ser du inte senaste koden?

- **Lokalt (Vite):** kör alltid `npm run dev:multi` och öppna exakt `http://localhost:5174/99-natter-pa-kronan/`. Förhandsgranskare som “Live Server” på **rå** `index.html` kör **inte** Vite → du får då ofta tomt/trasigt spel och kan **aldrig** förlita dig på samma bunt som produktion. Använd `npm run preview` (efter `npm run build`) om du vill testa production-build lokalt.
- **Byggd sajt:** ladda upp innehållet i mappen `dist/`, aldrig endast råa käll-HTML från projektroten, till t.ex. `public/99-natter-pa-kronan/` när det packas med AMC. Om du ser råa konstiga tecken i HUD har fel fil satts upp.
- **Livesajt:** efter `npm run build:amc` + `npm run build` + `npm run deploy` i AMC. **Cache:** värddatorn sätter `no-cache` på alla `index.html` via [AMC `public/.htaccess`](../AMC/public/.htaccess) (när `mod_headers` finns). Vite ger **nytt hashi-namn** på `assets/*.js` per build, så nya filer cachas separat. Vid uppladdning: ladda alltid upp **hela** mappen `99-natter-pa-kronan/` inkl. nya `assets/…`. I tvivel: hård omladdning eller inkognito.
- **Kod-rad** i `index.html` ska stämma med `src/version.ts` när du bumpat version; uppdatera båda.

## Spelkontroller

- Piltangenter (och WASD) fram, bak, sväng; mellanslag hoppar.
