# tvlibre-cobalt

Script que carga una versión modificada de [TizenTube Cobalt](https://github.com/reisxd/TizenTubeCobalt)
en una TV Android. Junta en un solo archivo:

1. **Scriptlets de [uBlock Origin](https://github.com/gorhill/uBlock)** (el mismo código que integra Brave)
   con las reglas para `www.youtube.com` de las listas de uBO (`filters`, `quick-fixes`, `unbreak`, `privacy`).
2. **[TizenTube](https://github.com/reisxd/TizenTube)** (bloqueo de anuncios, SponsorBlock, DeArrow, velocidad...).

Una GitHub Action lo regenera cada 6 horas con las versiones más recientes, así que el mantenimiento lo
hacen los autores de uBlock Origin y TizenTube.

- Script publicado: `https://cdn.jsdelivr.net/gh/Zeus339/tvlibre-cobalt@main/tvlibre.js`
  (está en la raíz para que la URL tenga la misma longitud que la original de TizenTube Cobalt).
- Generación local: `node build.mjs` (Node 20+, git).

Licencia: GPL-3.0 (como uBlock Origin y TizenTube).
