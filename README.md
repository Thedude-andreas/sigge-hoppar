# 99 nätter på kronan

Three.js-spel: Sigge (dvärgvädur) i en trädgård med dag/natt-cykler, räv, katt, återväxande morötter och skyddsföremål. Spelas på [andreasmartensson.com/99-natter-pa-kronan](https://andreasmartensson.com/99-natter-pa-kronan/) efter publicering från AMC.

## Utveckling

```bash
npm install
npm run dev
```

`vite.config.ts` sätter `base: '/99-natter-pa-kronan/'` så länkar passar när bygget ligger i en undermapp på domänen.

## Publicera till andreasmartensson.com (AMC)

Bygg och kopiera statiska filer till grannmappens `AMC` (kräver att båda projekten ligger sida-vid-sida under samma `Vibe`-rot):

```bash
npm run build:amc
```

Sedan i `AMC`: `npm run deploy` (enligt det repots [README](../AMC/README.md)).

Kort: `public/99-natter-pa-kronan/` i AMC speglas till webrooten som `/99-natter-pa-kronan/` av `scripts/deploy.sh`.

## Ser du inte senaste koden?

- **Lokalt (Vite):** kör alltid `npm run dev` och öppna exakt `http://localhost:5173/99-natter-pa-kronan/`. Förhandsgranskare som “Live Server” på **rå** `index.html` kör **inte** Vite → du får då ofta tomt/trasigt spel och kan **aldrig** förlita dig på samma bunt som produktion. Använd `npm run preview` (efter `npm run build`) om du vill testa production-build lokalt.
- **Byggd sajt:** ladda upp innehållet i mappen `dist/`, aldrig endast råa käll-HTML från projektroten, till t.ex. `public/99-natter-pa-kronan/` när det packas med AMC. Om du ser råa konstiga tecken i HUD har fel fil satts upp.
- **Livesajt:** efter `npm run build:amc` + `npm run build` + `npm run deploy` i AMC. **Cache:** värddatorn sätter `no-cache` på alla `index.html` via [AMC `public/.htaccess`](../AMC/public/.htaccess) (när `mod_headers` finns). Vite ger **nytt hashi-namn** på `assets/*.js` per build, så nya filer cachas separat. Vid uppladdning: ladda alltid upp **hela** mappen `99-natter-pa-kronan/` inkl. nya `assets/…`. I tvivel: hård omladdning eller inkognito.
- **Kod-rad** i `index.html` ska stämma med `src/version.ts` när du bumpat version; uppdatera båda.

## Spelkontroller

- Piltangenter (och WASD) fram, bak, sväng; mellanslag hoppar.
