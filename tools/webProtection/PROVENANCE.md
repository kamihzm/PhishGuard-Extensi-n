# Procedencia, licencia y atribución — listas de Web Protection

Compilador offline propio de PhishGuard (Fase B). **No contiene ni deriva
código de uBlock Origin**: se inspiró solo en técnicas observadas (ver
`docs/web-protection-audit.md` §1).

## Fuentes aprobadas en la Fase B

Definidas en `sources.json` (`approvedForBundling: true`). Licencias
verificadas en la fuente primaria el 2026-09-29.

| Lista | Categoría | URL | Licencia | Snapshot |
|---|---|---|---|---|
| EasyList | ads | https://easylist.to/easylist/easylist.txt | Doble: GPLv3+ **o** CC BY-SA 3.0 — https://easylist.to/pages/licence.html | `sources/easylist.txt` (fecha, versión y SHA-256 en `sources/easylist.meta.json`) |
| EasyPrivacy | trackers | https://easylist.to/easylist/easyprivacy.txt | Igual que EasyList | `sources/easyprivacy.txt` (+ `.meta.json`) |

**Atribución:** EasyList y EasyPrivacy son obra de los autores de EasyList
(https://easylist.to/). PhishGuard redistribuye los snapshots sin modificar.
Las reglas DNR generadas a partir de ellos (`out/*.rules.json`) son una
adaptación distribuida bajo **Creative Commons Attribution-ShareAlike 3.0**
(https://creativecommons.org/licenses/by-sa/3.0/). Esa licencia se aplica a
esos archivos de datos, no al código de PhishGuard.

## Fuentes NO aprobadas (no se descargan ni se compilan)

URLhaus (abuse.ch), OpenPhish, las listas de malware-filter derivadas de
ellos y PhishTank. Motivos por fuente en `docs/web-protection-audit.md` §2.

## Proceso reproducible

1. `npm run wp:fetch` descarga un snapshot nuevo y registra fecha, versión
   (`! Version:`) y SHA-256. Solo se ejecuta para ACTUALIZAR las listas.
2. `npm run wp:compile` compila **solo desde los snapshots versionados**
   (nunca desde la red) y verifica que su SHA-256 coincida con el
   registrado. Escribe `out/report.json` con el SHA-256 de entrada y de
   salida de cada lista.
3. `.gitattributes` fija los snapshots como `-text` para que la conversión
   de fin de línea de git no altere sus bytes ni su SHA-256.

## Snapshot actual

| Lista | Versión | Líneas | Reglas DNR | Rechazadas | Cosméticas diferidas |
|---|---|---|---|---|---|
| EasyList | 202609292049 | 77 961 | 49 318 | 3 742 | 24 624 |
| EasyPrivacy | 202609292049 | 56 994 | 56 141 | 44 | 35 |

Desglose completo por motivo en `out/report.json`.
