"""Instalar el sistema (2026-11-13): botón sólo para el equipo, nunca en el menú público de pacientes.
Uso: python3 t/e2e_instalar_1113.py (PAGINA=index.html)"""
import http.server, os, socketserver, threading, json
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(RAIZ)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d/' % srv.server_address[1]
U = BASE + os.environ.get('PAGINA', 'dev.html')
oks, fallas = [0], []
def chk(c, n):
    if c: oks[0] += 1; print('ok  ' + n)
    else: fallas.append(n); print('FALLA ' + n)
FAKE = """window.__fakeBIP=function(){const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=function(){window.__prompted=(window.__prompted||0)+1};e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e);return e.defaultPrevented;}"""
with sync_playwright() as pw:
    b = pw.chromium.launch(); p = b.new_page(viewport={'width': 1366, 'height': 900}); errs = []
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.add_init_script(FAKE)
    # manifiesto
    r = p.request.get(BASE + 'manifest.webmanifest'); m = r.json()
    chk(r.ok and any(i['sizes'] == '512x512' for i in m['icons']) and any(i['sizes'] == '192x192' for i in m['icons']), 'manifiesto con íconos 192 y 512')
    chk('#/acceso' in m['start_url'] and m['display'] == 'standalone', 'abre directo en el ingreso del equipo, como app')
    chk(p.request.get(BASE + 'assets/icon-512.png').ok, 'ícono 512 publicado')

    # paciente: menú público, sin botón y sin cartel del navegador
    p.goto(U + '#/m'); p.wait_for_timeout(700); ev = p.evaluate
    prevenido = ev("window.__fakeBIP()"); p.wait_for_timeout(200)
    chk(prevenido, 'en el menú público se evita el cartel automático del navegador')
    chk(p.locator('#sideInst:visible, .inst-aviso, [data-act=inst-app]:visible').count() == 0, 'paciente: no aparece «Instalar el sistema»')

    # equipo
    ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';CM.db.cfg.operador=u.nombre;})()")
    p.goto(U + '#/inicio'); p.wait_for_timeout(500)
    chk(p.locator('#sideInst').count() == 1, 'equipo: botón en el menú lateral')
    chk(p.locator('.inst-aviso').count() == 1, 'equipo: aviso en Inicio')
    p.click('#sideInst'); p.wait_for_timeout(300)
    chk(ev("window.__prompted") == 1, 'el botón abre el instalador del navegador')
    p.wait_for_timeout(200)
    # tras aceptar, el evento se consume: sin evento y sin iOS ya no hay botón
    p.goto(U + '#/pacientes'); p.wait_for_timeout(400)
    chk(p.locator('#sideInst').count() == 0, 'después de instalar, el botón desaparece')
    ev("window.__fakeBIP()"); p.wait_for_timeout(200)
    p.goto(U + '#/inicio'); p.wait_for_timeout(400)
    p.click('.inst-aviso [data-act=inst-no]'); p.wait_for_timeout(200)
    chk(p.locator('.inst-aviso').count() == 0 and p.locator('#sideInst').count() == 1, '«Ahora no» oculta el aviso (el botón del menú queda)')
    p.goto(U + '#/ajustes'); p.wait_for_timeout(500)
    chk(p.locator('#instCfg').count() == 1, 'tarjeta en Configuración')
    # sin instalador del navegador (iPhone, etc.): pasos
    ev("window.__cmInstalarSiempre=true")
    p.goto(U + '#/inicio'); p.wait_for_timeout(300)
    p.click('#sideInst'); p.wait_for_timeout(200)  # usa el evento guardado
    p.goto(U + '#/pacientes'); p.wait_for_timeout(300)
    p.click('#sideInst'); p.wait_for_timeout(300)
    chk('Instalar el sistema en este equipo' in p.inner_text('#modalRoot'), 'sin instalador: muestra los pasos')
    errs2 = [e for e in errs if 'favicon' not in e and 'Failed to load resource' not in e]
    chk(not errs2, 'sin errores de consola ' + (str(errs2[:3]) if errs2 else ''))
    b.close()
print('\n%d ok · %d fallas' % (oks[0], len(fallas)))
if fallas: raise SystemExit(1)
