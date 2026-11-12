# PhishGuard (extensión)

Extensión de Chrome (Manifest V3) que analiza la URL de cada página y avisa si puede ser phishing. Combina 20 reglas expertas con un Random Forest calibrado y explica el motivo de cada aviso. Todo corre en el navegador: no se envía ninguna URL a un servidor.

Proyecto de Inteligencia Artificial, Universidad Cooperativa de Colombia, Sede Villavicencio.

## Niveles de riesgo

| Nivel | Puntaje | Qué hace |
|---|---|---|
| Bajo | 0 a 34 | Insignia verde |
| Medio | 35 a 64 | Insignia naranja; la página carga normal |
| Alto | 65 a 100 | Reemplaza la navegación por una advertencia |

El puntaje combina 30 % reglas y 70 % modelo.

## Módulo de protección web

Bloquea anuncios y rastreadores con reglas de EasyList y EasyPrivacy, oculta elementos de publicidad y cierra ventanas emergentes de anuncios. Si algo falla, la página carga normal.

## Cómo usarla

Requisitos: Node.js 24 y npm.

```bash
cd extension
npm ci
npm run build
```

Luego, en Chrome: `chrome://extensions` > activar *Modo de desarrollador* > *Cargar descomprimida* > elegir la carpeta `extension/dist`.

## Pruebas

```bash
cd extension
npm run typecheck
npm run lint
npm test            # Vitest
npm run test:e2e    # Playwright (opcional, necesita Chrome)
```

## Estructura

```
extension/
  src/
    agent/            decisión y combinación de reglas + modelo
    rules/            las 20 reglas expertas
    ml/               Random Forest (forestModel.json) y vectorización
    features/         variables extraídas de la URL
    background/       service worker
    ui/               popup, advertencia y aviso de nivel medio
    webProtection/    bloqueo de anuncios y ventanas emergentes
  e2e/                pruebas extremo a extremo
tools/webProtection/  compila las listas EasyList/EasyPrivacy al compilar
```

## Licencias pendientes

Las listas EasyList y EasyPrivacy van incluidas en `tools/webProtection/sources/`. Hay que revisar sus licencias antes de publicar la extensión en una tienda.

## Integrantes

Cristian C. Hernández M., Jhonatan D. Olave M. y Dioyanny Y. Aranguren S. Docente: Ing. Yomaria G. Paredes.
