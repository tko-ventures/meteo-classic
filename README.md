# meteo-classic

Meteogram modelu UM 4 km w układzie starego meteo.pl (legenda po lewej, panele:
temperatura, opad i wilgotność, ciśnienie, wiatr, kierunek wiatru, podstawy
chmur i widzialność, zachmurzenie i mgła), rysowany z bieżących danych, które
pobiera nowa strona meteo.pl (`devmgramapi.meteo.pl`).

**https://app.ometeo.pl/**

## Adresy

Wystarczy podmienić domenę w linku z nowej aplikacji meteo.pl:

| meteo.pl                                              | meteo-classic                                          |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `https://app.meteo.pl/meteogram/51.22,18.57`          | `https://app.ometeo.pl/meteogram/51.22,18.57`          |
| `https://www.meteo.pl/meteogramy?lat=51.22&lng=18.57` | `https://app.ometeo.pl/meteogramy?lat=51.22&lng=18.57` |

Przykład z nazwą miejsca:
https://app.ometeo.pl/meteogram/51.22,18.57?name=Wieluń

Obrazek PNG (generowany po stronie serwera, do osadzania np. w Home Assistant
albo na forum):

```
https://app.ometeo.pl/meteogram/51.22,18.57.png
```

Parametry opcjonalne (strona i obrazek): `name=Wieluń`, `model=um4_120`
(prognoza 120 h), `legend=0` (bez legendy), `scale=2` (tylko obrazek, 2×
ostrzejszy).

Na stronie można też wpisać miejscowość, współrzędne albo wkleić dowolny link z
meteo.pl. Przycisk „Pobierz PNG” zapisuje obrazek, a „Link do obrazka” daje
stały adres PNG.

## Pliki

- `render.js`: całe rysowanie (wspólne dla przeglądarki i serwera)
- `app.js`, `index.html`: strona
- `api/meteogram.js`: endpoint PNG (`@napi-rs/canvas`, czcionka Arimo z pakietu
  `@expo-google-fonts/arimo`, licencja SIL OFL 1.1)
- `vercel.json`: przepisywanie adresów `/meteogram/…` i `/meteogramy`
- `tests/`: testy (Vitest) na zapisanej prognozie, bez sieci

## Praca nad kodem

Styl według `@epic-web/config` (Kent C. Dodds): Oxfmt do formatowania, Oxlint do
lintowania.

```bash
npm test           # Vitest w trybie watch
npm run validate   # lint + sprawdzenie formatowania + testy
npm run format     # formatowanie
npm run sample     # rysuje przykładowy meteogram do /tmp/meteogram-sample.png
```

## Wdrożenie

Hostowane na Vercel (projekt `meteo-classic`), z Vercel Web Analytics.

```bash
npm i -g vercel
vercel login
vercel --prod
```

Dane: ICM Uniwersytet Warszawski (meteo.pl). To nieoficjalna wizualizacja; API
nie jest udokumentowane i może się zmienić.

## Licencja

Kod: MIT (plik `LICENSE`). Dane pogodowe należą do ICM UW, wyszukiwanie miejsc:
© OpenStreetMap / Nominatim.
