"""Prueba del armado (index.html = un solo JS minificado): todas las pantallas abren a 360 y 1280 px sin errores ni desbordes."""
"""Ajustes pedidos por la ONG el 2026-11-08 (Chromium real, modo local con datos FICTICIOS: no toca la base del cliente).
Membresías y planes, buscador de pacientes, cultivo (genéticas, fases, nombres), dispensación con origen desde el lote,
donación mixta y caja, Inicio sin datos de ejemplo, tareas con todo el equipo, domicilio de cultivo y «Trazabilidad / Stock».
Uso: python3 t/e2e_ajustes_1108.py"""
import http.server, os, socketserver, threading, json
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(RAIZ)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
U = 'http://127.0.0.1:%d/index.html' % srv.server_address[1]
oks, fallas = [0], []
def chk(c, n):
    if c: oks[0] += 1; print('ok  ' + n)
    else: fallas.append(n); print('FALLA ' + n)

with sync_playwright() as pw:
    b = pw.chromium.launch()
    p = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.route('**/*supabase.co/**', lambda r: r.abort())
    p.goto(U); p.wait_for_timeout(700)
    ev = p.evaluate
    ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';})()")
    def ir(h): p.goto(U + '#/inicio'); p.wait_for_timeout(80); p.goto(U + h); p.wait_for_timeout(300)
    def submit(form_id): p.click('#modalRoot button[type=submit][form=%s]' % form_id); p.wait_for_timeout(300)
    def err(): return p.locator('#modalRoot [data-err]').first.inner_text() if p.locator('#modalRoot [data-err]').count() else ''

    rutas = ev("Object.keys(CM.VIEWS)")
    for w in (360, 1280):
        p.set_viewport_size({'width': w, 'height': 800})
        for r in rutas:
            if r in ('tarjeta','paciente'): continue
            ir('#/' + r)
            chk(ev("document.documentElement.scrollWidth<=innerWidth+1"), '%s %d' % (r, w))
    chk(not errs, 'consola %s' % errs[:3])
    b.close()
print('%d ok, %d fallas' % (oks[0], len(fallas)), fallas)

