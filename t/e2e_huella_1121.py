"""2026-11-21 (Chromium real + agente local en modo SIMULADO; datos FICTICIOS). Lector de huellas en el legajo:
detección automática, emparejamiento con código, firmas HMAC (respuesta adulterada rechazada), consentimiento, registrar
3 lecturas, huella de otro legajo rechazada, identificar en la dispensa, quitar (revocar), permisos y función apagada.
Requiere Go para compilar el agente.  Uso: python3 t/e2e_huella_1121.py"""
import http.server, os, socketserver, threading, json, subprocess, tempfile, time, re, queue
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(RAIZ)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIG = 'http://127.0.0.1:%d' % srv.server_address[1]
U = ORIG + '/' + os.environ.get('PAGINA', 'dev.html')
oks, fallas = [0], []
def chk(c, n):
    if c: oks[0] += 1; print('ok  ' + n)
    else: fallas.append(n); print('FALLA ' + n)
tmp = tempfile.mkdtemp(); exe = os.path.join(tmp, 'agente')
subprocess.run(['go', 'build', '-o', exe, '.'], cwd='tools/agente-huellas', check=True)
env = dict(os.environ, VBONG_HUELLAS_DIR=os.path.join(tmp, 'datos'))
ag = subprocess.Popen([exe, '-simular', '-origen', ORIG], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
lineas = queue.Queue()
threading.Thread(target=lambda: [lineas.put(l) for l in ag.stdout], daemon=True).start()
def codigo():
    t0 = time.time(); visto = False
    while time.time() - t0 < 5:
        try: l = lineas.get(timeout=0.5)
        except queue.Empty: continue
        if 'emparejar' in l: visto = True
        m = re.search(r'\b(\d{6})\b', l)
        if m and visto: return m.group(1)
    return None
time.sleep(0.8)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
        p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
        p.route('**/*supabase.co/**', lambda r: r.abort())
        p.goto(U); p.wait_for_timeout(700)
        ev = p.evaluate
        ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';CM.db.cfg.operador=u.nombre;CM.db.cfg.huella=null;localStorage.removeItem('vbong_huella_par');})()")
        def ir(h): p.goto(U + '#/inicio'); p.wait_for_timeout(80); p.goto(U + h); p.wait_for_timeout(400)
        def submit(fid): p.click('#modalRoot button[type=submit][form=%s]' % fid); p.wait_for_timeout(400)
        def err(): return p.locator('#modalRoot [data-err]').first.inner_text() if p.locator('#modalRoot [data-err]').count() else ''
        dnis = ev("Object.keys(CM.db.pacientes).filter(k=>CM.reglasDispensar(CM.db.pacientes[k]).bloquea===false).slice(0,2)")
        ev("(()=>{%s.forEach((d,i)=>{CM.db.pacientes[d].leg='L-TEST0'+i;});CM.save();})()" % json.dumps(dnis))
        # apagado
        ir('#/paciente/' + dnis[0])
        chk(p.locator('h2', has_text='Huella digital').count() == 0, 'apagado: la ficha no muestra la huella')
        ir('#/perifericos')
        chk(p.locator('h2', has_text='Lector de huellas digitales').count() == 1 and p.locator('[data-form=huella-on]').count() == 1, 'Periféricos ofrece activarlo (apagado por defecto)')
        submit_btn = '[data-form=huella-on] button[type=submit]'
        p.click(submit_btn); p.wait_for_timeout(200)
        chk('revisión legal' in p.locator('[data-form=huella-on] [data-err]').inner_text(), 'sin confirmar la revisión legal no se activa')
        p.check('[data-form=huella-on] [name=legal]'); p.click(submit_btn); p.wait_for_timeout(1500)
        chk(ev("CM.db.cfg.huella.on===true && !!CM.db.cfg.huella.legal.user"), 'activado, con quién confirmó la revisión legal')
        chk(ev("CM.db.audit.some(a=>a.accion==='Lector de huellas activado')"), 'la activación queda en la auditoría')
        ir('#/perifericos'); p.wait_for_timeout(800)
        chk('falta emparejar' in p.locator('[data-hu-st]').first.inner_text(), 'detección automática: encuentra el agente y el lector (falta emparejar): %s' % p.locator('[data-hu-st]').first.inner_text())
        chk('Conectado' in p.locator('.kv', has_text='Lector').first.inner_text(), 'muestra el lector conectado')
        # emparejar
        p.click('[data-act=hu-emparejar]'); p.wait_for_timeout(500)
        cod = codigo()
        chk(bool(cod), 'el agente mostró el código en la PC')
        p.fill('#fHE [name=codigo]', '000000' if cod != '000000' else '111111'); submit('fHE')
        chk('incorrecto' in err().lower(), 'código equivocado rechazado: %s' % err())
        p.fill('#fHE [name=codigo]', cod); submit('fHE'); p.wait_for_timeout(800)
        chk(ev("!!JSON.parse(localStorage.getItem('vbong_huella_par')).clave"), 'emparejado: la clave queda sólo en este navegador')
        chk(ev("JSON.stringify(CM.db).indexOf(JSON.parse(localStorage.getItem('vbong_huella_par')).clave)<0"), 'la clave del emparejamiento no va a la base (no se sincroniza)')
        chk('Lector listo' in p.locator('[data-hu-st]').first.inner_text(), 'estado: «Lector listo»')
        # seguridad del canal
        r = ev("fetch('http://127.0.0.1:52181/identificar',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)")
        chk(r == 401, 'pedido sin firma rechazado por el agente (%s)' % r)
        bad = ev("""(async()=>{const k=JSON.parse(localStorage.getItem('vbong_huella_par'));const o=k.clave;k.clave=btoa('x'.repeat(32));localStorage.setItem('vbong_huella_par',JSON.stringify(k));
          let m='';try{await CM.huella.pedir('/verificar',{});m='paso';}catch(e){m=e.message;}k.clave=o;localStorage.setItem('vbong_huella_par',JSON.stringify(k));return m;})()""")
        chk('no reconoce' in bad or 'emparejado' in bad, 'con otra clave el agente no responde: %s' % bad)
        ok2 = ev("CM.huella.pedir('/verificar',{}).then(j=>j.agente)")
        chk(ok2 == 'vbong-huellas', 'pedido firmado y respuesta con firma verificada')
        # respuesta adulterada (proxy que cambia el cuerpo)
        p.route('http://127.0.0.1:52181/verificar', lambda rt: (lambda resp: rt.fulfill(response=resp, body=resp.text().replace('vbong-huellas', 'falso')))(rt.fetch()))
        adult = ev("CM.huella.pedir('/verificar',{}).then(()=>'aceptada',e=>e.message)")
        chk('firma' in adult, 'respuesta adulterada rechazada: %s' % adult)
        p.unroute('http://127.0.0.1:52181/verificar')
        def dedo(d, veces=1, cada=1.1):
            for _ in range(veces):
                ev("CM.huella.pedir('/sim/dedo',{dedo:%s})" % json.dumps(d)); time.sleep(cada)
        # registrar
        ir('#/paciente/' + dnis[0])
        chk(p.locator('h2', has_text='Huella digital').count() == 1, 'la ficha muestra la tarjeta «Huella digital»')
        p.click('[data-act=hu-enrolar]'); p.wait_for_timeout(300)
        submit('fHU')
        chk('consentimiento' in err(), 'sin consentimiento no se registra')
        p.check('#fHU [name=acepta]'); p.select_option('#fHU [name=dedo]', 'Pulgar derecho'); p.click('#modalRoot button[type=submit][form=fHU]'); p.wait_for_timeout(500)
        chk('1 de 3' in p.locator('[data-hu-msg]').inner_text() or 'Apoyá' in p.locator('[data-hu-msg]').inner_text(), 'pide apoyar el dedo: %s' % p.locator('[data-hu-msg]').inner_text())
        dedo('A', 1); dedo('B', 1, 1.6)  # una lectura distinta: la descarta
        dedo('A', 2, 2.0); p.wait_for_timeout(1500)
        h = ev("CM.db.pacientes[%s].huella" % json.dumps(dnis[0]))
        chk(h and h['ref'] == 'L-TEST00' and re.match(r'^[0-9a-f]{64}$', h['hash']) and h['dedo'] == 'Pulgar derecho' and h['consent']['version'], 'registrada: referencia, hash, dedo y consentimiento en el legajo: %s' % (h and {k: h[k] for k in ('ref', 'dedo')}))
        chk(ev("!JSON.stringify(CM.db.pacientes[%s]).match(/tpl|imagen|image/i)" % json.dumps(dnis[0])), 'el legajo no guarda la plantilla ni la imagen')
        datos = open(os.path.join(tmp, 'datos', 'plantillas.bin'), 'rb').read()
        chk(b'L-TEST00' in datos and b'dedo|A' not in datos, 'la PC guarda la plantilla (en Windows, cifrada con DPAPI)')
        chk(ev("CM.db.audit.some(a=>a.accion==='Huella registrada')"), 'el registro queda en la auditoría')
        # la misma huella en otro legajo: rechazada
        ir('#/paciente/' + dnis[1]); p.click('[data-act=hu-enrolar]'); p.wait_for_timeout(300)
        p.check('#fHU [name=acepta]'); p.click('#modalRoot button[type=submit][form=fHU]'); p.wait_for_timeout(400)
        dedo('A', 3, 1.8); p.wait_for_timeout(1500)
        chk(ev("!CM.db.pacientes[%s].huella" % json.dumps(dnis[1])) and p.locator('.toast', has_text='L-TEST00').count() >= 1, 'la misma huella en otro legajo se rechaza y avisa en cuál está')
        # identificar en la dispensa
        ir('#/dispensaciones'); ev("CM.acts.dispensar({getAttribute:()=>''})"); p.wait_for_timeout(500)
        chk(p.locator('#fDS [data-act=hu-ds]').count() == 1 and p.locator('#fDS [data-act=hu-ds]').is_enabled(), 'la dispensa ofrece «Identificar con huella»')
        p.click('#fDS [data-act=hu-ds]'); p.wait_for_timeout(300); dedo('A', 1); p.wait_for_timeout(1200)
        chk(p.input_value('#dsDni') == 'L-TEST00' and p.locator('#dsPac .pac-ok').count() == 1, 'huella reconocida: se completa el paciente en la dispensa')
        p.fill('#dsDni', ''); p.click('#fDS [data-act=hu-ds]'); p.wait_for_timeout(300); dedo('Z', 1); p.wait_for_timeout(1200)
        chk(p.input_value('#dsDni') == '' and p.locator('.toast', has_text='No se encontró').count() >= 1, 'huella desconocida: no completa nada y avisa')
        chk(ev("CM.db.audit.filter(a=>/^Huella: /.test(a.accion)).length>=2"), 'cada identificación queda en la auditoría')
        p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(200)
        # quitar
        ir('#/paciente/' + dnis[0]); p.click('[data-act=hu-quitar]'); p.wait_for_timeout(300)
        submit('fHQ'); chk('motivo' in err(), 'quitar pide motivo')
        p.fill('#fHQ [name=motivo]', 'lo pidió el paciente'); submit('fHQ'); p.wait_for_timeout(800)
        chk(ev("!CM.db.pacientes[%s].huella && CM.db.pacientes[%s].huellaHist.slice(-1)[0].enPc===true" % (json.dumps(dnis[0]), json.dumps(dnis[0]))), 'quitada del legajo y de la PC, con historial')
        reg = ev("CM.huella.pedir('/registradas',{}).then(j=>Object.keys(j.refs))")
        chk('L-TEST00' not in reg, 'el agente ya no tiene esa huella: %s' % reg)
        # permisos
        ev("CM.db.cfg.rol='operador'"); ir('#/perifericos')
        chk(p.locator('[data-act=hu-off]').count() == 0, 'operador no ve «Apagar»')
        ev("CM.db.cfg.rol='admin'")
        # agente caído: nada se bloquea
        ag.terminate(); ag.wait(5); time.sleep(0.3)
        ev("CM.huella.detectar()"); p.wait_for_timeout(1200)
        ir('#/dispensaciones'); ev("CM.acts.dispensar({getAttribute:()=>''})"); p.wait_for_timeout(1500)
        chk(p.locator('#fDS [data-act=hu-ds]').is_disabled() and p.locator('#dsDni').is_enabled(), 'sin agente: el botón de huella se deshabilita y se sigue buscando a mano')
        chk(not [e for e in errs if 'supabase' not in e and 'Failed to load' not in e and '52181' not in e and 'ERR_CONNECTION_REFUSED' not in e], 'consola sin errores: %s' % [e for e in errs][:4])
        b.close()
finally:
    if ag.poll() is None: ag.terminate()
print('\n%d ok · %d fallas' % (oks[0], len(fallas)))
if fallas: raise SystemExit(1)
