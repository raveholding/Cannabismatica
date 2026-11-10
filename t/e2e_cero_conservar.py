"""«Empezar de cero» conservando pacientes, legajos y documentos · 2026-11-10 (Chromium real, datos FICTICIOS, no toca la base del cliente).
Parte 1: modo nube contra un servidor simulado (se intercepta supabase.co): llama a sync_vaciar_conservar, deja pacientes,
documentos, seguimientos e historias clínicas del menú, y borra lo demás en el equipo. Si falta la función del servidor no borra nada.
Parte 2: modo local (demo): misma opción. Uso: python3 t/e2e_cero_conservar.py"""
import http.server, os, socketserver, threading, json
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(RAIZ)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
U = 'http://127.0.0.1:%d/%s' % (srv.server_address[1], os.environ.get('PAGINA', 'dev.html'))
oks, fallas = [0], []
def chk(c, n):
    if c: oks[0] += 1; print('ok  ' + n)
    else: fallas.append(n); print('FALLA ' + n)

LLAMADAS = []
MODO_SRV = {'falta': False}
def nube(route):
    url = route.request.url
    if '/rest/v1/rpc/' in url:
        fn = url.split('/rest/v1/rpc/')[1].split('?')[0]; LLAMADAS.append(fn)
        if fn == 'sync_vaciar_conservar':
            if MODO_SRV['falta']:
                return route.fulfill(status=404, content_type='application/json', body=json.dumps({'code': 'PGRST202', 'message': 'Could not find the function public.sync_vaciar_conservar without parameters in the schema cache'}))
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'retirados': 9, 'pacientes': 2, 'docs': 3, 'seg': 1}))
        return route.fulfill(status=200, content_type='application/json', body='[]' if fn == 'sync_push' else 'null')
    return route.fulfill(status=200, content_type='application/json', body='[]')

SEMBRAR = """(()=>{
  const N=CM.nube, d=N.dbVacia(); d._s.eq=1; d.cfg.rol='admin'; d.cfg.operador='Admin prueba';
  d.pacientes={'30111222':{dni:'30111222',leg:'L-1',doc:{tipo:'DNI',num:'30111222'},nombre:'Ana Prueba',reprocann:{estado:'vigente',vence:'2027-01-01'}},
               '30111223':{dni:'30111223',leg:'L-2',doc:{tipo:'DNI',num:'30111223'},nombre:'Beto Prueba',reprocann:{estado:'sin'}}};
  d.legDocs=[{id:'DOC-1',dni:'30111222',tipo:'Consentimiento informado'},{id:'DOC-2',dni:'30111222',tipo:'REPROCANN'},{id:'DOC-3',dni:'30111223',tipo:'Consentimiento informado'}];
  d.seg=[{id:'SE-1',dni:'30111222'}]; d.menu.hcs=[{id:'HC-a',pac:'30111223',nonce:'n1',estado:'pendiente'}];
  d.lotes=[{id:'LT-1'}]; d.movs=[{id:'MV-1',lote:'LT-1',cant:5}]; d.disp=[{id:'D-1',dni:'30111222'}]; d.aportes=[{id:'A-1',dni:'30111222',cent:1000}];
  d.cajas=[{id:'CJ-1-00001',nro:1,estado:'abierta'}]; d.cmovs=[{id:'CM-1'}]; d.sellos=[{id:'S-1',dni:'30111222',cant:1}]; d.membresias=[{id:'MB-1'}];
  d.tareas=[{id:'T-1'}]; d.staff=[{id:'ST-1'}]; d.menu.turnos=[{id:'TU-1'}]; d.menu.altas=[{id:'CL-1'}];
  ['pacientes|30111222','legDocs|DOC-1','seg|SE-1','m_hcs|HC-a','aportes|A-1','lotes|LT-1','cajas|CJ-1-00001','m_turnos|TU-1'].forEach(k=>{d._s.h[k]='x';d._s.sv[k]=1;});
  N.ses={at:'tok',rt:'r',exp:Date.now()+36e5,uid:'u1',correo:'a@x',me:{rol:'admin',nombre:'Admin prueba'}};
  CM.db=d; CM.render(); return true;})()"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    # ---------------- parte 1: nube simulada ----------------
    p = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'https://ouvfubqmrixdbgjhzhiu.supabase.co',key:'sb_publishable_x',inactividadMin:15};"))
    p.route('**/*supabase.co/**', nube)
    p.goto(U); p.wait_for_timeout(800)
    chk(p.evaluate("!!(CM.nube&&CM.nube.activa)"), 'modo nube activo (servidor simulado)')
    p.evaluate(SEMBRAR)
    def abrir():
        p.evaluate("CM.acts.vaciar()"); p.wait_for_timeout(200)
    abrir()
    txt = p.locator('#modalRoot').inner_text()
    chk(p.locator('#modalRoot input[name=modo][value=conservar]').is_checked(), 'por defecto: conservar pacientes, legajos y documentos')
    chk('2 paciente(s)' in txt and '3 documento(s)' in txt, 'el aviso dice cuántos pacientes y documentos quedan')
    # sin escribir BORRAR no hace nada
    p.click('#modalRoot button[type=submit][form=fVC]'); p.wait_for_timeout(250)
    chk('BORRAR' in p.locator('#modalRoot [data-err]').inner_text() and 'sync_vaciar_conservar' not in LLAMADAS, 'sin confirmar no llama al servidor')
    # falta la actualización del servidor: no borra nada
    MODO_SRV['falta'] = True
    p.fill('#fVC [name=conf]', 'BORRAR'); p.click('#modalRoot button[type=submit][form=fVC]'); p.wait_for_timeout(500)
    e = p.locator('#modalRoot [data-err]').inner_text()
    chk('Falta instalar' in e and 'No se borró nada' in e, 'servidor sin la función 06: lo avisa (%s)' % e)
    chk(p.evaluate("CM.db.aportes.length===1&&CM.db.lotes.length===1&&Object.keys(CM.db.pacientes).length===2"), 'con error no se borró nada en el equipo')
    # ahora sí
    MODO_SRV['falta'] = False; LLAMADAS.clear()
    p.click('#modalRoot button[type=submit][form=fVC]'); p.wait_for_timeout(600)
    chk('sync_vaciar_conservar' in LLAMADAS and 'sync_vaciar' not in LLAMADAS, 'llama sólo a sync_vaciar_conservar')
    st = p.evaluate("""(()=>{const d=CM.db;return {pac:Object.keys(d.pacientes).length,docs:d.legDocs.length,seg:d.seg.length,hcs:d.menu.hcs.length,
      rep:d.pacientes['30111222'].reprocann.estado,
      op:[d.lotes,d.movs,d.disp,d.aportes,d.cajas,d.cmovs,d.sellos,d.membresias,d.tareas,d.staff,d.menu.turnos,d.menu.altas].map(a=>a.length).reduce((x,y)=>x+y,0),
      hk:Object.keys(d._s.h).sort(), hash:location.hash, aud:d.audit[0]&&d.audit[0].accion}})()""")
    chk(st['pac'] == 2 and st['docs'] == 3 and st['seg'] == 1 and st['hcs'] == 1, 'quedan pacientes, documentos, seguimientos e HC del menú: %s' % st)
    chk(st['rep'] == 'vigente', 'el REPROCANN del paciente queda igual')
    chk(st['op'] == 0, 'lotes, stock, dispensaciones, donaciones, cajas, sellos, membresías, tareas, personal, turnos y altas: borrados')
    chk(st['hk'] == ['legDocs|DOC-1', 'm_hcs|HC-a', 'pacientes|30111222', 'seg|SE-1'], 'el equipo no vuelve a subir lo borrado ni pierde lo conservado (%s)' % st['hk'])
    chk(st['hash'] == '#/pacientes' and st['aud'] == 'Empezar de cero (conservando pacientes)', 'abre Pacientes y queda en la auditoría')
    chk('quedaron 2 pacientes' in p.locator('#toastRoot').inner_text(), 'mensaje final con la cantidad')
    p.wait_for_timeout(300)
    chk('Ana Prueba' in p.locator('#main').inner_text(), 'la lista de pacientes se ve')
    # modo «borrar todo» sigue igual
    p.evaluate(SEMBRAR); LLAMADAS.clear(); abrir()
    p.check('#modalRoot input[name=modo][value=todo]'); p.fill('#fVC [name=conf]', 'BORRAR'); p.click('#modalRoot button[type=submit][form=fVC]'); p.wait_for_timeout(600)
    chk('sync_vaciar' in LLAMADAS and 'sync_vaciar_conservar' not in LLAMADAS and p.evaluate("Object.keys(CM.db.pacientes).length===0"), '«Borrar todo» usa la función de siempre y borra los pacientes')
    chk(not errs, 'sin errores de JavaScript (%s)' % errs[:3])
    p.close()

    # ---------------- parte 2: modo local (demo) ----------------
    p = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.route('**/*supabase.co/**', lambda r: r.abort())
    p.goto(U); p.wait_for_timeout(700)
    p.evaluate("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';CM.db.legDocs=[{id:'DOC-9',dni:Object.keys(CM.db.pacientes)[0],tipo:'REPROCANN'}];CM.save();})()")
    n0 = p.evaluate("Object.keys(CM.db.pacientes).length")
    p.evaluate("CM.acts.vaciar()"); p.wait_for_timeout(200)
    chk(p.locator('#modalRoot input[name=vcModo][value=conservar]').is_checked(), 'local: por defecto conserva')
    p.click('#modalRoot [data-act=vaciar-ok]'); p.wait_for_timeout(300)
    r = p.evaluate("({pac:Object.keys(CM.db.pacientes).length,docs:CM.db.legDocs.length,disp:CM.db.disp.length,ap:CM.db.aportes.length,lot:CM.db.lotes.length})")
    chk(n0 > 0 and r['pac'] == n0 and r['docs'] == 1 and r['disp'] + r['ap'] + r['lot'] == 0, 'local: quedan %d pacientes y el documento; lo demás vacío %s' % (n0, r))
    p.evaluate("CM.acts.vaciar()"); p.wait_for_timeout(200); p.check('#modalRoot input[name=vcModo][value=todo]'); p.click('#modalRoot [data-act=vaciar-ok]'); p.wait_for_timeout(300)
    chk(p.evaluate("Object.keys(CM.db.pacientes).length") == 0, 'local: «Borrar todo» deja el sistema vacío')
    chk(not errs, 'local: sin errores de JavaScript (%s)' % errs[:3])
    b.close()
print('\n%d ok, %d fallas' % (oks[0], len(fallas)))
if fallas: raise SystemExit(1)
