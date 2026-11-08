"""Clave olvidada y donaciones (editar / quitar / restaurar) · 2026-11-08 · datos FICTICIOS (Chromium real, modo local con datos FICTICIOS: no toca la base del cliente).
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

    # clave olvidada: sólo administración, sin contacto al desarrollador
    ev("CM.ses.set(null)"); p.goto(U + '#/acceso'); p.wait_for_timeout(300)
    p.click('[data-act=olvide]'); p.wait_for_timeout(200)
    t = p.locator('#modalRoot').inner_text()
    chk('administra el sistema' in t and 'Clave temporal' in t, 'olvidé mi clave → pedirla a la administración')
    chk(p.locator('#modalRoot a[href*="wa.me"]').count() == 0, 'el modal no manda al soporte del desarrollador')
    p.click('#modalRoot [data-act=modal-close]')
    ev("(()=>{const u=CM.db.users[0];CM.ses.set(u.id);})()")
    # donación ficticia
    ev("""(()=>{const h=CM.hoy();CM.db.aportes.push({id:'A-T1',fecha:h,ts:new Date().toISOString(),dni:'',rec:{nombre:'Donante prueba',doc:null},disp:'',cent:500000,medio:'efectivo',concepto:CM.CONCEPTOS[0],obs:'',user:'x',estado:'registrado',comp:'',mig:true});CM.save();})()""")
    ir('#/aportes')
    tot0 = ev("CM.db.aportes.filter(a=>a.estado==='registrado'&&a.fecha.slice(0,7)===CM.mesActual()).reduce((s,a)=>s+a.cent,0)")
    chk(p.locator('[data-act=ap-editar][data-id=A-T1]').count() == 1, 'admin ve «Editar» en la donación')
    p.click('[data-act=ap-editar][data-id=A-T1]'); p.wait_for_timeout(200)
    p.select_option('#fAPE [name=medio]', 'transferencia'); submit('fAPE')
    chk('motivo' in err().lower(), 'editar sin motivo no se guarda')
    p.fill('#fAPE [name=motivo]', 'era transferencia'); submit('fAPE')
    a = ev("CM.db.aportes.find(x=>x.id==='A-T1')")
    chk(a['medio'] == 'transferencia' and a['hist'][0]['antes']['medio'] == 'efectivo' and ev("CM.db.audit[0].accion") == 'Donación editada', 'medio corregido, historial y auditoría')
    # mixto
    p.click('[data-act=ap-editar][data-id=A-T1]'); p.wait_for_timeout(200)
    p.select_option('#fAPE [name=medio]', 'mixto'); p.wait_for_timeout(100)
    p.fill('#fAPE [name=mx_efectivo]', '2000'); p.fill('#fAPE [name=mx_transferencia]', '2000'); p.fill('#fAPE [name=motivo]', 'mitad y mitad'); submit('fAPE')
    chk('no da el importe' in err(), 'mixto que no suma no se guarda')
    p.fill('#fAPE [name=mx_transferencia]', '3000'); submit('fAPE')
    chk(ev("JSON.stringify(CM.partesAporte(CM.db.aportes.find(x=>x.id==='A-T1')))") == '[{"m":"efectivo","a":200000},{"m":"transferencia","a":300000}]', 'mixto 2.000 + 3.000 guardado')
    # quitar
    p.click('[data-act=ap-quitar][data-id=A-T1]'); p.wait_for_timeout(200); p.fill('#fAPQ [name=motivo]', 'se vuelve a cargar'); submit('fAPQ')
    tot1 = ev("CM.db.aportes.filter(a=>a.estado==='registrado'&&a.fecha.slice(0,7)===CM.mesActual()).reduce((s,a)=>s+a.cent,0)")
    chk(ev("CM.db.aportes.find(x=>x.id==='A-T1').estado") == 'quitada' and tot1 == tot0 - 500000, 'quitada: sale de los totales')
    chk(p.locator('tr', has_text='A-T1').count() == 0, 'quitada no aparece en la lista por defecto')
    p.select_option('#apFlt', 'quitada'); p.evaluate("CM.render()"); p.wait_for_timeout(200)
    chk(p.locator('[data-act=ap-restaurar][data-id=A-T1]').count() == 1, 'filtro «Quitadas» la muestra con «Restaurar»')
    p.click('[data-act=ap-restaurar][data-id=A-T1]'); p.wait_for_timeout(200)
    chk(ev("CM.db.aportes.find(x=>x.id==='A-T1').estado") == 'registrado', 'restaurar la vuelve a registrar')
    # caja cerrada: no se edita
    ev("CM.db.cajas.push({id:'CJ-T',nro:1,estado:'cerrada',fecha:CM.hoy(),cierre:{movs:[{ref:'A-T1'}]}});CM.save()")
    ir('#/aportes')
    chk(p.locator('[data-act=ap-editar][data-id=A-T1]').count() == 0, 'donación dentro de una caja cerrada: sin «Editar»')
    ev("CM.db.cajas=CM.db.cajas.filter(c=>c.id!=='CJ-T');CM.save()")
    # operador no ve acciones
    ev("CM.db.cfg.rol='operador';(CM.ses.cur&&CM.ses.cur())") ; ev("(()=>{const u=CM.db.users[0];u.rol='operador';CM.save();})()")
    ir('#/aportes')
    chk(p.locator('[data-act=ap-editar]').count() == 0 and p.locator('[data-act=ap-quitar]').count() == 0, 'operador no ve editar/quitar')
    for w in (360, 1280):
        p.set_viewport_size({'width': w, 'height': 800}); ir('#/aportes')
        chk(ev("document.documentElement.scrollWidth<=innerWidth+1"), 'sin desborde a %d px' % w)
    chk(not errs, 'consola sin errores %s' % errs[:3])
    b.close()
print('\n%d ok, %d fallas' % (oks[0], len(fallas)))
import sys; sys.exit(1 if fallas else 0)
