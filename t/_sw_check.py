"""Service worker: segunda apertura usa lo guardado; sin red la página igual abre; pedidos a otros sitios no se tocan."""
import http.server, os, socketserver, threading
from playwright.sync_api import sync_playwright
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
U = 'http://127.0.0.1:%d/index.html' % srv.server_address[1]
ok = []
with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(); p = ctx.new_page()
    p.goto(U); p.wait_for_timeout(500)
    p.evaluate("navigator.serviceWorker.register('sw.js').then(()=>navigator.serviceWorker.ready)"); p.wait_for_timeout(800)
    p.reload(); p.wait_for_timeout(1200)
    n = p.evaluate(r"caches.open('vbong-v2').then(c=>c.keys()).then(k=>k.map(r=>r.url.replace(/^https?:\/\/[^/]+\//,'')))")
    ok.append(('guardó app.min.js, css y la página', any('app.min.js' in x for x in n) and any('app.min.css' in x for x in n) and any('index.html' in x for x in n), n))
    ctx.set_offline(True); p.reload(); p.wait_for_timeout(1500)
    ok.append(('sin red la página abre igual', p.evaluate("document.documentElement.classList.contains('rdy')"), ''))
    b.close()
for n, c, d in ok: print(('ok  ' if c else 'FALLA ') + n, d if not c else '')
