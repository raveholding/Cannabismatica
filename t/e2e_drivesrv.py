"""Drive por servidor en el navegador (Chromium real). La nube y la función se SIMULAN: no toca la base del cliente.
Uso: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 t/e2e_drivesrv.py"""
import http.server, os, socketserver, sys, threading, json
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
MOCK = r"""
(function(){var N=CM.nube;N.activa=true;N.ses={at:'jwt',me:{rol:window.__ROL||'admin',nombre:'Prueba'}};window.__calls=[];
window.__estado={ok:true,configurado:true,conectado:!!window.__CONECTADO,cuenta:'ong@gmail.com',raiz:'https://drive.google.com/drive/folders/RAIZ000000001'};
N._fn=function(fn,b){window.__calls.push(b.accion);if(b.accion==='estado')return Promise.resolve(window.__estado);
 if(b.accion==='conectar')return Promise.resolve({ok:true,url:'https://accounts.google.com/o/oauth2/v2/auth?x=1'});
 if(b.accion==='carpeta')return Promise.resolve({ok:true,carpeta:'CARP'+b.legajo.replace(/\W/g,''),url:'https://drive.google.com/drive/folders/CARP'+b.legajo.replace(/\W/g,''),creada:true});
 if(b.accion==='subir'){if(!b.b64||b.hash.length!==64)return Promise.reject(new Error('mal'));return Promise.resolve({ok:true,carpeta:'CARPX000000000',archivo:{id:'ARCH0000000001',webViewLink:'https://drive.google.com/file/d/ARCH/view'}});}
 return Promise.reject(new Error('?'));};})();
"""
open('/tmp/doc_srv.pdf', 'wb').write(b'%PDF-1.4\n% ficticio\n')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    def pagina(conectado, rol='admin'):
        p = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
        p.route('**/*supabase.co/**', lambda r: r.abort())
        def drivesrv(r):
            src = open(os.path.join(RAIZ, 'js/m-drivesrv.js')).read()
            r.fulfill(status=200, content_type='application/javascript', body='window.__CONECTADO=%s;window.__ROL=%s;' % ('true' if conectado else 'false', json.dumps(rol)) + MOCK + src)
        p.route('**/js/m-drivesrv.js*', drivesrv)
        p.goto(U); p.wait_for_timeout(700)
        p.evaluate("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol=%s;})()" % json.dumps(rol))
        p.evaluate("CM.driveSrvEstado(true)"); p.wait_for_timeout(200)
        return p, errs
    # 1) conectado: modo servidor, carpeta y subida sin conectar nada en el equipo
    p, errs = pagina(True)
    chk(p.evaluate("CM.driveModo()") == 'servidor', 'Drive de la ONG conectado → modo servidor')
    k = p.evaluate("CM.nuevoPaciente({nombre:'Prueba Drive (ficticia)',doc:{tipo:'DNI',num:'99100077'},origen:'prueba'}).dni")
    p.goto(U + '#/pacientes'); p.wait_for_timeout(300)
    chk(p.locator('text=Google Drive de la ONG').count() >= 1 and p.locator('text=Conectado · ong@gmail.com').count() == 1, 'tarjeta «Google Drive de la ONG» conectada con la cuenta')
    chk(p.locator('text=Conectar Drive y procesar').count() == 0, 'ya no pide conectar Drive en este equipo')
    p.click('[data-act=legajo-lote]'); p.wait_for_timeout(800)
    sin = p.evaluate("Object.values(CM.db.pacientes).filter(x=>x.leg&&!x.driveId&&!(x.drive1&&x.drive1!=='https://drive.google.com/drive/my-drive')).length")
    chk(sin == 0 and p.evaluate("CM.db.pacientes[%s].driveId" % json.dumps(k)).startswith('CARP'), 'procesar legajos crea las carpetas por el servidor')
    p.goto(U + '#/paciente/' + k); p.wait_for_timeout(300)
    chk(p.locator('section.drive a.btn.pri', has_text='Abrir carpeta del legajo').count() == 1, 'la ficha abre directo la carpeta del legajo')
    p.set_input_files('#docFile', '/tmp/doc_srv.pdf'); p.wait_for_timeout(300)
    p.select_option('form[data-form=doc-subir] select[name=tipo]', 'REPROCANN'); p.click('#modalRoot button[type=submit]'); p.wait_for_timeout(1200)
    d = p.evaluate("CM.db.legDocs.find(x=>x.dni===%s)" % json.dumps(k))
    chk(d and d['estado'] == 'subido' and d['fileId'] == 'ARCH0000000001', 'el documento se sube por el servidor y queda «En Drive»')
    chk(not errs, 'consola sin errores ' + ' | '.join(errs[:2])); p.close()
    # 2) sin conectar, admin: botón para conectar una sola vez
    p, errs = pagina(False)
    p.goto(U + '#/pacientes'); p.wait_for_timeout(300)
    chk(p.locator('[data-act=drive-srv-conectar]').count() == 1, 'admin ve «Conectar Google Drive de la ONG»')
    p.route('https://accounts.google.com/**', lambda r: r.fulfill(status=200, body='google'))
    p.click('[data-act=drive-srv-conectar]'); p.wait_for_timeout(600)
    chk(p.url.startswith('https://accounts.google.com/'), 'lleva a autorizar en Google')
    p.close()
    # 3) sin conectar, mostrador: no puede conectar y el documento queda pendiente en el equipo
    p, errs = pagina(False, 'mostrador')
    p.goto(U + '#/pacientes'); p.wait_for_timeout(300)
    chk(p.locator('[data-act=drive-srv-conectar]').count() == 0 and p.locator('text=Un administrador tiene que conectar').count() == 1, 'mostrador no puede conectar y ve el aviso')
    chk(p.evaluate("CM.driveModo()") != 'servidor', 'sin conectar no finge modo servidor')
    chk(not errs, 'consola sin errores ' + ' | '.join(errs[:2])); p.close()
    # 4) vuelta de Google: aviso y URL limpia
    p, errs = pagina(True); p.goto(U.replace('index.html', 'index.html?drive=ok') + '#/pacientes'); p.wait_for_timeout(2200)
    chk('drive=' not in p.url and p.locator('text=Google Drive de la ONG conectado').count() >= 1, 'vuelta de Google: aviso y dirección limpia')
    p.close(); b.close()
print('\n%d correctas, %d fallas' % (oks[0], len(fallas))); sys.exit(1 if fallas else 0)
