import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Local fixture server for the Popup Guard / Redirect Guard E2E suite.
 *
 * One plain-HTTP server bound to 127.0.0.1 serves every fixture "site"; the
 * browser maps the hostnames below to it with `--host-resolver-rules`, so all
 * navigations are real network navigations (no request interception).
 * Routing is by the Host header, following the pattern of
 * tools/uiCapturas/server.mjs (HTTPS is not needed here: the guard treats
 * http and https the same and plain HTTP avoids certificate setup).
 *
 * Generic redirect endpoints, available on every host:
 * - `/out?to=<url>`  -> HTTP 302 to `<url>`;
 * - `/meta?to=<url>` -> `<meta http-equiv="refresh">` to `<url>`;
 * - `/js?to=<url>`   -> `location.replace(<url>)` after `delay` ms (default 0).
 */

/** Fixture sites (first-party, neutral and identity-provider hosts). */
export const FIXTURE_HOSTS = ['publisher.test', 'hop.test', 'legit.test', 'idp.test'] as const
/**
 * Hosts listed in extension/src/webProtection/generated/popupIndex.json
 * (`hosts`), so the guard has list evidence for them.
 */
export const LISTED_AD_HOSTS = ['popads.net', 'redirectingat.com'] as const

export interface FixtureServer {
  port: number
  /** Absolute URL on a fixture host, e.g. `url('publisher.test', '/')`. */
  url(host: string, path: string): string
  close(): Promise<void>
}

/** Chromium flag value mapping every fixture host to 127.0.0.1. */
export function hostResolverRules(): string {
  const rules = ['MAP *.test 127.0.0.1', ...LISTED_AD_HOSTS.map((h) => `MAP ${h} 127.0.0.1`)]
  return [...rules, 'EXCLUDE localhost'].join(', ')
}

const html = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font-family:sans-serif;margin:24px}a,button{display:block;margin:8px 0;font-size:16px}</style>` +
  `</head><body>${body}</body></html>`

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** Minimal valid one-page PDF ("legit document"). */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
)

function publisherHome(u: (host: string, path: string) => string): string {
  const adPopup = u('popads.net', '/x')
  const firstPartyRedirector = u(
    'publisher.test',
    `/out?to=${encodeURIComponent(u('popads.net', '/landing'))}`,
  )
  const hijackTarget = u('popads.net', '/ad')
  const hijackChainTarget = u('hop.test', `/out?to=${encodeURIComponent(u('popads.net', '/chain'))}`)
  // Port 1 on 127.0.0.1: connection refused, the navigation ends in an error page.
  const brokenLink = 'http://unreachable.test:1/'
  const oauth = u(
    'idp.test',
    `/authorize?client_id=e2e-client&response_type=code&redirect_uri=${encodeURIComponent(u('publisher.test', '/callback'))}`,
  )
  const blobDoc =
    '<!doctype html><title>Generated report</title><p>Report generated in the page.</p>'
  return html(
    'Publisher',
    `<h1>Publisher</h1>
<button id="popup-ad" onclick="window.open('${adPopup}')">Play video</button>
<button id="popup-first-party" onclick="window.open('${firstPartyRedirector}')">Watch now</button>
<a id="hijack" href="${u('legit.test', '/article')}"
   onclick="event.preventDefault(); location.href='${hijackTarget}'">Read the article</a>
<a id="hijack-chain" href="${u('legit.test', '/article')}"
   onclick="event.preventDefault(); location.href='${escapeAttr(hijackChainTarget)}'">Read the review</a>
<a id="broken-link" href="${brokenLink}">Broken link</a>
<a id="aff-direct" href="${u('redirectingat.com', '/aff?id=42')}">Deal of the day (affiliate)</a>
<form id="search-form" action="${u('legit.test', '/search')}" method="get">
  <input name="q" value="shoes"><button id="search-submit" type="submit">Search</button>
</form>
<a id="auto-redirect" href="${escapeAttr(u('hop.test', `/js?delay=3000&to=${encodeURIComponent(u('popads.net', '/auto'))}`))}">Open the countdown page</a>
<a id="plain-link" href="${u('legit.test', '/article')}">Plain article link</a>
<a id="blank-link" href="${u('legit.test', '/new-tab')}" target="_blank">Open in new tab</a>
<a id="ctrl-link" href="${u('legit.test', '/ctrl')}">Ctrl+click me</a>
<button id="oauth" onclick="window.open('${escapeAttr(oauth)}', 'oauth', 'width=500,height=600')">Sign in with IdP</button>
<a id="pdf-link" href="${u('legit.test', '/doc.pdf')}" target="_blank">Download the PDF</a>
<!-- Inline handlers resolve bare URL to document.URL, hence window.URL. -->
<button id="blob-doc" onclick="window.open(window.URL.createObjectURL(new window.Blob([${escapeAttr(JSON.stringify(blobDoc))}], {type: 'text/html'})))">Open report</button>
<button id="popup-stale" onclick="window.open('${u('hop.test', '/landing')}')">Continue</button>
<button id="popup-fresh-hop" onclick="window.open('${u('hop.test', `/js?delay=300&to=${encodeURIComponent(u('redirectingat.com', '/aff'))}`)}')">Next</button>
${popunderFixtures(u)}`,
  )
}

/**
 * T6 popunder technique (animeyt.cc, 2026-10-15): a click on the player makes
 * a hidden same-origin about:blank iframe call
 * `open('about:blank', name, 'popup=1,...,width=5,height=5')`; about 1 s later
 * the script navigates that window to an UNLISTED site, which redirects again.
 * The negatives are legitimate windows opened by a user click on a button.
 */
/** Third-party chat widget (embedded iframe): its launcher opens a tiny empty window. */
function chatFrame(u: (host: string, path: string) => string): string {
  const to = escapeAttr(JSON.stringify(u('legit.test', '/chat')))
  return html(
    'Chat widget',
    `<button id="launch" onclick="var w = window.open('about:blank', 'vchat', 'popup=1,width=180,height=140'); setTimeout(function () { w.location.href = ${to} }, 300)">Chat</button>`,
  )
}

function popunderFixtures(u: (host: string, path: string) => string): string {
  const landing = u('hop.test', `/js?delay=100&to=${encodeURIComponent(u('legit.test', '/offer'))}`)
  const tiny = "'popup=1,top=0,left=' + screen.availWidth + ',width=5,height=5'"
  // T7: at the opener window's right edge. Headless Chrome moves windows asked
  // for at `screen.availWidth` back inside a smaller work area (measured
  // left=682 with a 1280 px opener), so the edge is taken from the opener.
  const atOpenerEdge =
    "'popup=1,top=' + window.screenY + ',left=' + (window.screenX + window.outerWidth - 30) + ',width=5,height=5'"
  // Opens an empty popup window and navigates it later, like the ad script.
  const openThenGo = (opener: string, name: string, features: string, to: string, ms = 1000) =>
    `var w = ${opener}.open('about:blank', '${name}', ${features}); ` +
    `setTimeout(function () { w.location.href = ${escapeAttr(JSON.stringify(to))} }, ${ms})`
  const hiddenFrame =
    "var f = document.createElement('iframe'); f.style.display = 'none'; document.body.appendChild(f)"
  const oauth = u('idp.test', '/authorize?client_id=e2e-client&response_type=code')
  return `<div id="player" style="width:320px;height:120px;background:#111;color:#eee"
  onclick="${hiddenFrame}; ${openThenGo('f.contentWindow', 'pu1', tiny, landing)}">Player (click to play)</div>
<div id="player-top" style="width:320px;height:60px;background:#222;color:#eee"
  onclick="${openThenGo('window', 'pu2', tiny, landing)}">Second player</div>
<button id="play-button" onclick="${openThenGo('window', 'pu3', atOpenerEdge, landing)}">Play episode</button>
<button id="play-full" onclick="${openThenGo('window', 'pu4', tiny, landing)}">Play episode (asks for the screen's right edge)</button>
<button id="corner-button" onclick="${openThenGo('window', 'corner', "'popup=1,left=0,top=0,width=5,height=5'", u('legit.test', '/player'))}">Pop out (top-left corner)</button>
<button id="grow-button" onclick="var w = window.open('about:blank', 'growb', 'popup=1,width=5,height=5'); setTimeout(function () { w.resizeTo(600, 700); setTimeout(function () { w.location.href = ${escapeAttr(JSON.stringify(u('legit.test', '/details')))} }, 300) }, 200)">Open details (button, grows first)</button>
<button id="oauth-blank" onclick="${openThenGo('window', 'oauth2', "'popup=1,width=516,height=735'", oauth, 300)}">Sign in (OAuth window)</button>
<button id="pay-blank" onclick="${openThenGo('window', 'pay', "'popup=1,width=450,height=650'", u('legit.test', '/checkoutnow?token=e2e'), 300)}">Pay</button>
<button id="mini-player" onclick="window.open('${u('legit.test', '/player')}', 'player', 'popup=1,width=180,height=140')">Pop out the player</button>
<button id="chat-widget" onclick="${openThenGo('window', 'chat', "'popup=1,width=360,height=520'", u('legit.test', '/chat'), 300)}">Open chat</button>
<button id="tiny-widget" onclick="${openThenGo('window', 'widget', "'popup=1,width=180,height=140'", u('publisher.test', '/widget'), 300)}">Open mini widget</button>
<button id="print-window" onclick="var w = window.open('about:blank', 'print', 'popup=1,width=600,height=400'); w.document.write('<h1>Invoice 42</h1>'); w.document.close()">Print invoice</button>
<button id="login-3p" onclick="window.open('${u('idp.test', '/signin')}', 'login', 'popup=1,width=480,height=600')">Sign in with partner</button>
<button id="tiny-chat" onclick="${openThenGo('window', 'tinychat', "'popup=1,width=180,height=140'", u('legit.test', '/chat'), 300)}">Chat with us</button>
<div id="grow-then-go" style="width:320px;height:40px;background:#333;color:#eee"
  onclick="var w = window.open('about:blank', 'grow', 'popup=1,width=5,height=5'); setTimeout(function () { w.resizeTo(600, 700); setTimeout(function () { w.location.href = ${escapeAttr(JSON.stringify(u('legit.test', '/details')))} }, 300) }, 200)">Open details (grows first)</div>
<iframe id="chat-frame" src="${u('legit.test', '/chat-frame')}" style="width:200px;height:60px"></iframe>
<button id="big-blank" onclick="${openThenGo('window', 'big', "'popup=1,width=800,height=600'", u('legit.test', '/landing'), 300)}">Open details window</button>`
}

export async function startFixtureServer(): Promise<FixtureServer> {
  let port = 0
  const u = (host: string, path: string) => `http://${host}:${port}${path}`

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const host = (req.headers.host ?? '').split(':')[0]!.toLowerCase()
    const url = new URL(req.url ?? '/', 'http://fixture.invalid')
    const send = (status: number, body: string | Buffer, type = 'text/html; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
      res.end(body)
    }
    const to = url.searchParams.get('to')
    if (to !== null && /^https?:\/\//.test(to)) {
      if (url.pathname === '/out') {
        res.writeHead(302, { location: to, 'cache-control': 'no-store' })
        return res.end()
      }
      if (url.pathname === '/meta') {
        return send(
          200,
          html('Redirecting', `<meta http-equiv="refresh" content="0;url=${escapeAttr(to)}">`),
        )
      }
      if (url.pathname === '/js') {
        const delay = Number(url.searchParams.get('delay') ?? '0') || 0
        return send(
          200,
          html(
            'Redirecting',
            `<script>setTimeout(() => location.replace(${JSON.stringify(to)}), ${delay})</script>`,
          ),
        )
      }
    }
    switch (host) {
      case 'publisher.test':
        if (url.pathname === '/') return send(200, publisherHome(u))
        return send(200, html('Publisher page', `<p>Publisher ${url.pathname}</p>`))
      case 'hop.test':
        return send(
          200,
          html(
            'Hop',
            `<p>Intermediate page</p><a id="aff-link" href="${u('redirectingat.com', '/aff')}">Deal</a>`,
          ),
        )
      case 'legit.test':
        if (url.pathname === '/doc.pdf') return send(200, PDF, 'application/pdf')
        if (url.pathname === '/chat-frame') return send(200, chatFrame(u))
        return send(200, html('Legit', `<p>Legit content ${url.pathname}</p>`))
      case 'idp.test':
        return send(
          200,
          html('Identity provider', '<form><input name="user"><button>Sign in</button></form>'),
        )
      case 'popads.net':
      case 'redirectingat.com':
        return send(200, html('Ad', `<p>Ad landing on ${host}</p>`))
      default:
        return send(404, html('Not found', '404'))
    }
  }

  const server: Server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  return {
    port,
    url: u,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
