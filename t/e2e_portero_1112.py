"""Portero digital integrado · 2026-11-12. Prueba de punta a punta con el PORTERO REAL (raveholding/PorteroCannabismatica,
clonado en ../ref o en PORTERO_DIR) y un relevo ntfy simulado (t/portero/fake-ntfy.js, del propio portero):
el timbre suena en el sistema estando en otra pantalla y con un formulario abierto; «Ya voy» llega a la pantalla del portero;
el timbre por QR llega aunque el portero esté cerrado y la respuesta llega al celular de la visita; emergencia; respuesta de
otra persona; una sola alerta por timbre; sin errores. Uso: python3 t/e2e_portero_1112.py   (PAGINA=index.html)"""
import http.server, os, socketserver, threading, json, subprocess, time
from functools import partial
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(RAIZ)
PORT_DIR = os.environ.get('PORTERO_DIR', os.path.join(os.path.dirname(RAIZ), 'ref', 'PorteroCannabismatica'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
U = 'http://127.0.0.1:%d/%s' % (srv.server_address[1], os.environ.get('PAGINA', 'dev.html'))
psrv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), partial(Q, directory=PORT_DIR)); threading.Thread(target=psrv.serve_forever, daemon=True).start()
PU = 'http://localhost:%d' % psrv.server_address[1]
ntfy = subprocess.Popen(['node', os.path.join(RAIZ, 't', 'portero', 'fake-ntfy.js'), '0'], stdout=subprocess.PIPE, text=True)
NT = 'http://127.0.0.1:%s' % ntfy.stdout.readline().strip()
TOPIC, QRT = 'cnb-prueba-sistema-0123456789', 'cnb-qr-prueba-9876543210'
oks, fallas = [0], []
def chk(c, n):
    if c: oks[0] += 1; print('ok  ' + n)
    else: fallas.append(n); print('FALLA ' + n)
def puente(route):
    """https://ntfy.sh/… → relevo simulado. Las suscripciones SSE se entregan en tandas (con retry corto): EventSource reconecta solo."""
    r = route.request; path = r.url.split('https://ntfy.sh', 1)[1]
    try:
        if r.method == 'GET' and '/sse' in path:
            body = urlopen(NT + path + ('&' if '?' in path else '?') + 'poll=1', timeout=5).read().decode()
            route.fulfill(status=200, headers={'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*'}, body='retry: 400\n\n' + body)
        elif r.method == 'OPTIONS': route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': '*'})
        else:
            res = urlopen(Request(NT + path, data=(r.post_data or '').encode(), method=r.method), timeout=5).read()
            route.fulfill(status=200, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}, body=res)
    except Exception as e: route.fulfill(status=502, body=str(e))
def esperar(pg, js, t=10):
    fin = time.time() + t
    while time.time() < fin:
        try:
            if pg.evaluate(js): return True
        except Exception: pass
        pg.wait_for_timeout(200)
    raise AssertionError('no se cumplió: ' + js)
def msgs(t):
    with urlopen('%s/%s/json?since=all&poll=1' % (NT, t), timeout=3) as r:
        return [json.loads(l) for l in r.read().decode().splitlines() if l.strip() and json.loads(l).get('event') == 'message']
CFG = "window.CM_CFG={url:'',key:'',inactividadMin:15};"
SONIDOS = "window.__osc=0;(function(){const A=window.AudioContext;if(!A)return;const o=A.prototype.createOscillator;A.prototype.createOscillator=function(){window.__osc++;return o.apply(this,arguments)}})();"
SET = {'notif': {'ntfy': {'on': True, 'server': 'https://ntfy.sh', 'topic': TOPIC}, 'wa': {'on': False}, 'recips': [], 'ev': {'bell': True, 'sos': True, 'duress': True, 'lock': True, 'off': True}},
       'qr': {'on': True, 'topic': QRT, 'wa': '', 'page': PU + '/timbre.html'}}
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        sc = b.new_context(viewport={'width': 1366, 'height': 900}); sc.route('https://ntfy.sh/**', puente); sc.add_init_script(SONIDOS)
        p = sc.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ntfy' not in m.text else None)
        p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body=CFG))
        p.goto(U); p.wait_for_timeout(700); ev = p.evaluate
        ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';CM.db.cfg.operador=u.nombre;})()")
        def ir(h): p.goto(U + '#/inicio'); p.wait_for_timeout(80); p.goto(U + h); p.wait_for_timeout(400)

        # ---------- configurar en Configuración → Portero digital ----------
        ir('#/ajustes')
        chk(p.locator('[data-cfgsec=port]').count() == 1, 'Configuración tiene la sección «Portero digital»')
        p.click('[data-cfgsec=port]'); p.wait_for_timeout(150)
        if not p.locator('#ptCfg.open').count(): p.click('#ptCfg .cfg-head')
        chk('Sin configurar' in p.inner_text('#ptEstado'), 'estado inicial: sin configurar')
        p.check('#ptCfg [name=on]'); p.fill('#ptCfg [name=topic]', 'corto'); p.click('#ptCfg button[type=submit]'); p.wait_for_timeout(200)
        chk('10 y 64' in p.inner_text('#ptCfg [data-err]'), 'valida el tema')
        p.fill('#ptCfg [name=topic]', TOPIC); p.fill('#ptCfg [name=qr]', QRT); p.fill('#ptCfg [name=url]', 'https://raveholding.github.io/PorteroCannabismatica/'); p.fill('#ptCfg [name=url]', 'https://raveholding.github.io/PorteroCannabismatica/'); p.click('#ptCfg button[type=submit]'); p.wait_for_timeout(400)
        chk(ev("CM.db.ong.portero.topic") == TOPIC and ev("CM.db.ong.portero.qr") == QRT, 'guardado para todos los equipos')
        chk(not ev("CM.db.audit.some(a=>(a.detalle||'').indexOf(%s)>=0)" % json.dumps(TOPIC)), 'el tema (contraseña del canal) no va a la auditoría')
        esperar(p, "document.getElementById('ptEstado') && document.getElementById('ptEstado').textContent.indexOf('Escuchando')===0", 8)
        chk(True, 'estado: «Escuchando el portero en este equipo»')
        p.click('[data-act=pt-prueba]'); p.wait_for_timeout(200)
        chk(p.locator('.pt-al', has_text='Prueba').is_visible() and ev("window.__osc") > 0, '«Probar alerta» muestra el aviso y suena')
        p.click('.pt-al [data-act=pt-cerrar]'); p.wait_for_timeout(100)

        # ---------- portero real en la puerta ----------
        pc = b.new_context(viewport={'width': 1280, 'height': 860}); pc.route('https://ntfy.sh/**', puente)
        pc.add_init_script("if(!localStorage.getItem('cnb_ver')){localStorage.setItem('cnb_ver','2');localStorage.setItem('cnb_set',%s)}" % json.dumps(json.dumps(SET)))
        po = pc.new_page(); perr = []; po.on('pageerror', lambda e: perr.append(str(e)))
        po.goto(PU + '/index.html'); po.wait_for_timeout(1500)

        # el sistema en otra pantalla y con un formulario abierto
        ir('#/trazabilidad'); ev("CM.acts.dispensar({getAttribute:()=>''})"); p.wait_for_timeout(200)
        o0 = ev("window.__osc")
        po.locator('.tile[data-act="bell"]').click(); po.wait_for_timeout(300)
        area = po.locator('.area[data-act="ring"]').first; nom_area = area.inner_text().split('\n')[0].strip(); area.click()
        p.wait_for_selector('.pt-al', timeout=10000)
        al = p.locator('.pt-al').first
        chk('Timbre' in al.inner_text() and nom_area.split()[0] in al.inner_text(), 'el timbre aparece en el sistema estando en otra pantalla: «%s»' % al.inner_text().split('\n')[0])
        chk(p.locator('#fDS').is_visible() and al.is_visible(), 'aparece encima del formulario abierto, sin cerrarlo')
        chk(ev("window.__osc") > o0, 'suena')
        p.wait_for_timeout(4300)
        chk(ev("CM.portero.alertas[0].rep") >= 2, 'sigue sonando hasta que alguien responde')
        chk(al.locator('[data-act=pt-resp]').count() == 3 and al.locator('a[data-act=pt-abrir]').count() == 1, 'botones Ya voy · Un momento · No podemos y «Abrir portero»')
        al.locator('[data-act=pt-resp][data-c=voy]').click()
        esperar(po, "document.querySelector('#cstate') && document.querySelector('#cstate').textContent.includes('Ya vamos')", 10)
        chk(True, '«Ya voy» desde el sistema aparece en la pantalla del portero')
        p.wait_for_timeout(300)
        chk('Respondió' in p.locator('.pt-al').first.inner_text(), 'la alerta queda como respondida')
        n = ev("CM.portero.alertas[0].rep"); p.wait_for_timeout(4500)
        chk(ev("CM.portero.alertas[0].rep") == n, 'y deja de sonar')
        chk(ev("CM.db.audit.some(a=>a.accion==='Portero'&&/Ya voy/.test(a.detalle))"), 'la respuesta queda en la auditoría')
        p.screenshot(path='/tmp/portero_sistema.png')
        p.keyboard.press('Escape'); p.wait_for_timeout(100)
        po.screenshot(path='/tmp/portero_puerta.png')

        # ---------- «Abrir portero» ----------
        sc.route('https://raveholding.github.io/PorteroCannabismatica/**', lambda r: r.fulfill(status=200, content_type='text/html', body=open(os.path.join(PORT_DIR, 'index.html'), encoding='utf-8').read()))
        with sc.expect_page() as nueva: p.locator('.pt-al a[data-act=pt-abrir]').first.click()
        np_ = nueva.value; np_.wait_for_load_state(); np_.wait_for_timeout(800)
        chk(np_.url.startswith('https://raveholding.github.io/PorteroCannabismatica/') and np_.locator('.tile[data-act="bell"]').count() == 1, '«Abrir portero» abre el portero en otra pestaña')
        np_.close()

        # ---------- timbre por QR con el portero CERRADO ----------
        po.close()
        ev("CM.portero.alertas.slice().forEach(a=>CM.acts['pt-cerrar']({getAttribute:()=>a.id}))")
        vis = b.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True); vis.route('https://ntfy.sh/**', puente)
        vp = vis.new_page(); vp.goto(PU + '/timbre.html?t=' + QRT + '&h=https://ntfy.sh&n=Cannabism%C3%A1tica'); vp.wait_for_timeout(600)
        vp.locator('.chip').first.click(); vp.fill('#name', 'Lucía'); vp.locator('#bell').click()
        p.wait_for_selector('.pt-al', timeout=10000)
        al = p.locator('.pt-al').first
        chk('Lucía' in al.inner_text() and 'por QR' in al.inner_text(), 'timbre por QR llega al sistema aunque el portero esté cerrado')
        al.locator('[data-act=pt-resp][data-c=momento]').click()
        esperar(vp, "document.querySelector('#status').textContent.includes('Estamos atendiendo')", 10)
        chk(True, 'la respuesta del sistema llega al celular de la visita')
        vp.screenshot(path='/tmp/portero_visita.png')

        # ---------- respuesta de otra persona (desde la app ntfy del celular) ----------
        urlopen(Request('%s/' % NT, data=json.dumps({'topic': TOPIC, 'title': '🔔 Timbre · Consultas', 'message': 'Hay alguien en la puerta de Cannabismática (12:00). Respondé con los botones.', 'priority': 4,
              'actions': [{'action': 'http', 'label': 'Ya voy', 'url': 'https://ntfy.sh/%s-c' % TOPIC, 'method': 'POST', 'body': json.dumps({'type': 'reply', 'id': 'rid-otra', 'code': 'voy'})}]}).encode(), method='POST'))
        p.wait_for_selector('.pt-al[data-id="rid-otra"]', timeout=10000)
        chk(p.locator('.pt-al[data-id="rid-otra"]').count() == 1, 'un aviso de timbre publicado por el portero (formato real de ntfy) aparece')
        urlopen(Request('%s/%s-c' % (NT, TOPIC), data=json.dumps({'type': 'reply', 'id': 'rid-otra', 'code': 'nopuede'}).encode(), method='POST'))
        esperar(p, "document.querySelector('.pt-al[data-id=\"rid-otra\"]').textContent.includes('otra persona')", 10)
        chk('No podemos' in p.locator('.pt-al[data-id="rid-otra"]').inner_text(), 'si otra persona responde desde su celular, la alerta lo muestra')

        # ---------- emergencia ----------
        urlopen(Request('%s/' % NT, data=json.dumps({'topic': TOPIC, 'title': '🚨 EMERGENCIA · Cannabismática', 'message': 'Se activó el botón de emergencia en el portero (12:01). Llamada a 911.', 'priority': 5}).encode(), method='POST'))
        p.wait_for_selector('.pt-al.urg', timeout=10000)
        chk('EMERGENCIA' in p.locator('.pt-al.urg').inner_text(), 'emergencia: alerta roja que suena distinto')
        chk(p.locator('.pt-al.urg [data-act=pt-resp]').count() == 0, 'en una emergencia no hay botones de respuesta a la visita')
        p.locator('.pt-al.urg [data-act=pt-silenciar]').click(); p.wait_for_timeout(100)
        chk(ev("CM.portero.alertas.filter(a=>a.urg)[0].estado") == 'silencio', '«Silenciar» corta el sonido')

        # ---------- en este equipo: no recibir ----------
        ir('#/ajustes'); p.click('[data-cfgsec=port]'); p.wait_for_timeout(100)
        if not p.locator('#ptCfg.open').count(): p.click('#ptCfg .cfg-head')
        p.click('[data-act=pt-eq]'); p.wait_for_timeout(300)
        chk(ev("CM.portero.es") is None and 'Apagado en este equipo' in p.inner_text('#ptEstado'), '«No recibir acá» corta la conexión sólo en este equipo')
        p.click('[data-act=pt-eq]'); p.wait_for_timeout(300)
        # público y otra sesión: no escucha
        ev("CM.portero.alertas.slice().forEach(a=>CM.acts['pt-cerrar']({getAttribute:()=>a.id}))")
        p.goto(U + '#/m'); p.wait_for_timeout(500)
        chk(ev("CM.portero.es") is None, 'en el menú público no se escucha el portero')
        chk(not errs and not perr, 'sin errores en la consola: %s %s' % (errs[:2], perr[:2]))
        b.close()
finally:
    ntfy.kill()
print('\n%d ok · %d fallas' % (oks[0], len(fallas)))
if fallas: print('\n'.join(fallas)); raise SystemExit(1)
