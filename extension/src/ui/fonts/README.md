# Atkinson Hyperlegible (incluida en la extensión)

- **Fuente:** Atkinson Hyperlegible, de Braille Institute of America, diseñada para lectores con baja visión.
- **Licencia:** SIL Open Font License 1.1. El texto completo está en `OFL.txt`. Permite usarla, incluirla y redistribuirla con software, siempre que no se venda sola.
- **Origen de los archivos:** paquete npm `@fontsource/atkinson-hyperlegible` 5.3.0 (licencia `OFL-1.1`), subconjunto `latin`. Este subconjunto cubre el español: tildes, ñ, ¿, ¡, «», —, … y ·.
  - `AtkinsonHyperlegible-Regular.woff2` corresponde a `atkinson-hyperlegible-latin-400-normal.woff2`.
  - `AtkinsonHyperlegible-Bold.woff2` corresponde a `atkinson-hyperlegible-latin-700-normal.woff2`.
- **Uso:** solo como archivo local, con `@font-face` en `popup.css` y `warning.css`. Manifest V3 no permite cargar fuentes remotas, así que no hay enlaces a Google Fonts ni a ningún otro servidor.
- **El aviso de nivel medio dentro de la página** no la usa. Usa la fuente del sistema para no tener que exponer archivos a las páginas web (`web_accessible_resources`).
