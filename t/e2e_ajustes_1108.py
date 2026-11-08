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
U = 'http://127.0.0.1:%d/dev.html' % srv.server_address[1]
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

    # ---------- 1) membresías: sin planes → pide crear; plan nuevo; buscador de pacientes ----------
    ev("CM.db.planes=[];CM.db.membresias=[];CM.save()")
    ir('#/fidelizacion'); ev("CM.fid.tab='memb';CM.render()"); p.wait_for_timeout(200)
    chk(p.locator('text=Todavía no hay planes').count() == 1, 'sin planes: se avisa y se ofrece crear (admin)')
    p.click('[data-act=memb-nueva]'); p.wait_for_timeout(200)
    chk(p.locator('#modalRoot', has_text='Todavía no hay planes activos').count() == 1 and p.locator('#modalRoot [data-act=plan-nuevo]').count() == 1, 'nueva membresía sin planes → botón «Crear plan»')
    p.click('#modalRoot [data-act=plan-nuevo]'); p.wait_for_timeout(200)
    p.fill('#fPL [name=n]', 'Plan de Salud'); p.fill('#fPL [name=cent]', '8.000'); p.fill('#fPL [name=ben]', 'Consulta y seguimiento'); submit('fPL')
    p.click('[data-act=plan-nuevo]'); p.wait_for_timeout(200); p.fill('#fPL [name=n]', 'Consulta Médica'); submit('fPL')
    pl = ev("CM.db.planes.map(x=>[x.n,x.cent,x.per])")
    chk(pl == [['Plan de Salud', 800000, 'mensual'], ['Consulta Médica', 0, 'mensual']], 'planes «Plan de Salud» y «Consulta Médica» creados: %s' % pl)
    p.click('[data-act=plan-nuevo]'); p.wait_for_timeout(200); p.fill('#fPL [name=n]', 'plan de salud'); submit('fPL')
    chk('Ya hay un plan' in err(), 'no se repite un plan con el mismo nombre'); p.click('#modalRoot [data-act=modal-close]')
    pid = ev("CM.db.planes[1].id")
    p.click('[data-act=plan-editar][data-id="%s"]' % pid); p.wait_for_timeout(200); p.fill('#fPL [name=cent]', '5000'); submit('fPL')
    chk(ev("CM.db.planes[1].cent") == 500000 and ev("CM.db.audit[0].accion") == 'Plan modificado', 'modificar plan: cuota nueva y auditado')
    # buscador de pacientes
    p.click('[data-act=memb-nueva]'); p.wait_for_timeout(200)
    p.fill('#fMB [name=dni]', 'fern'); p.wait_for_timeout(150)
    chk(p.locator('#modalRoot [data-act=pacpick-sel]').count() >= 1 or p.locator('#modalRoot .pac-ok').count() == 1, 'al escribir parte del nombre aparecen los pacientes')
    p.fill('#fMB [name=dni]', 'a'); p.wait_for_timeout(150)
    n_bot = p.locator('#modalRoot [data-act=pacpick-sel]').count()
    chk(n_bot >= 2, 'varias coincidencias → botones para tocar (%d)' % n_bot)
    p.locator('#modalRoot [data-act=pacpick-sel]').first.click(); p.wait_for_timeout(150)
    chk(p.locator('#modalRoot .pac-ok').count() == 1, 'tocar un paciente lo deja elegido')
    p.check('#fMB [name=ok]'); submit('fMB')
    chk(ev("CM.db.membresias.length") == 1 and ev("CM.db.membresias[0].plan") == ev("CM.db.planes[0].id"), 'membresía creada con el paciente elegido y el plan')
    # pago con importe variable
    p.click('[data-act=memb-pago]'); p.wait_for_timeout(200); p.fill('#fMP [name=cent]', '7.500'); submit('fMP')
    ult = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(ult['cent'] == 750000 and 'Cuota de socio' in ult['obs'], 'confirmar pago registra la donación con el importe cargado')
    # permisos: supervisor sin nivel admin en Fidelización no ve ni puede crear planes
    ev("CM.db.cfg.rol='supervisor';CM.db.perms.supervisor.fidelizacion='edit';CM.render()"); p.wait_for_timeout(200)
    chk(p.locator('[data-act=plan-nuevo]').count() == 0 and p.locator('[data-act=plan-editar]').count() == 0, 'supervisor sin permiso: no ve crear/editar planes')
    chk(ev("CM.acts['plan-nuevo'](),!!document.querySelector('#fPL')") is False, 'supervisor sin permiso: la acción se rechaza')
    ev("CM.db.perms.supervisor.fidelizacion='admin';CM.render()"); p.wait_for_timeout(200)
    chk(p.locator('[data-act=plan-nuevo]').count() == 1, 'con permiso «admin» en Fidelización sí puede')
    ev("CM.db.cfg.rol='admin';CM.render()")

    # ---------- 2) cultivo ----------
    ir('#/cultivo')
    c0 = ev("CM.db.cultivos[0]")
    chk(p.locator('b.cu-nom', has_text=c0['nombre']).count() == 1 and p.locator('small.cu-cod', has_text=c0['id']).count() == 1, 'lista de ciclos: nombre del espacio en negrita, código chico')
    p.click('[data-act=gen-nueva]'); p.wait_for_timeout(200)
    p.fill('#fGE [name=vari]', 'Fancy Mood'); p.select_option('#fGE [name=tipo]', 'Híbrida'); p.fill('#fGE [name=plantas]', '7'); p.fill('#fGE [name=obs]', 'Carpa 240x120'); submit('fGE')
    p.click('[data-act=gen-nueva]'); p.wait_for_timeout(200); p.fill('#fGE [name=vari]', 'Aromito'); p.fill('#fGE [name=plantas]', '4'); submit('fGE')
    g = ev("CM.cultivo(CM.cu.sel).geneticas")
    chk(len(g) == 2 and g[0]['plantas'] == 7 and g[0]['tipo'] == 'Híbrida', 'dos genéticas cargadas en el espacio')
    chk(p.locator('text=Total de plantas activas').count() == 1 and p.locator('.cu-gen b', has_text='11').count() == 1, 'total de plantas = 11')
    p.click('[data-act=gen-editar][data-g="%s"]' % g[0]['id']); p.wait_for_timeout(200); p.fill('#fGE [name=plantas]', '6'); submit('fGE')
    chk('motivo' in err().lower(), 'editar sin motivo: se pide')
    p.fill('#fGE [name=motivo]', 'Se descartó una planta'); p.select_option('#fGE [name=estado]', 'En observación'); submit('fGE')
    g = ev("CM.cultivo(CM.cu.sel).geneticas[0]")
    chk(g['plantas'] == 6 and g['estado'] == 'En observación' and len(g['hist']) == 1 and g['hist'][0]['antes']['plantas'] == 7, 'edición guarda lo anterior y el motivo')
    p.click('[data-act=cr-nuevo]'); p.wait_for_timeout(200)
    fases = p.eval_on_selector_all('#fCR [name=fase] option', 'os=>os.map(o=>o.textContent)')
    i = fases.index('Floración')
    chk(fases[i + 1:i + 5] == ['Stretching', 'Engorde', 'Maduración', 'Lavado de raíces (washing)'], 'fases después de Floración: %s' % fases[i + 1:i + 5])
    p.click('#modalRoot [data-act=modal-close]')

    # ---------- 3) lote con ciclo → la dispensación toma el origen sola; donación mixta ----------
    ir('#/trazabilidad')
    chk(p.locator('h1', has_text='Trazabilidad / Stock').count() == 1 and p.locator('#nav a', has_text='Trazabilidad / Stock').count() == 1, 'menú y título «Trazabilidad / Stock»')
    p.click('[data-act=lote-nuevo]'); p.wait_for_timeout(200)
    p.fill('#fLN [name=nombre]', 'Fancy Q1 prueba'); p.fill('#fLN [name=cant]', '100'); p.select_option('#fLN [name=cu]', c0['id']); submit('fLN')
    lote = ev("CM.db.lotes[CM.db.lotes.length-1]")
    chk(lote['cu'] == c0['id'], 'lote nuevo guarda su ciclo de origen')
    chk(p.locator('td', has_text=c0['nombre']).count() >= 1, 'la tabla de stock muestra el ciclo del lote')
    dni = ev("Object.keys(CM.db.pacientes).find(k=>CM.reglasDispensar(CM.db.pacientes[k]).bloquea===false)")
    ev("CM.acts.dispensar({getAttribute:()=>%s})" % json.dumps(dni)); p.wait_for_timeout(250)
    chk(p.locator('#fDS [name=cu]').count() == 0, 'la dispensación ya no pide elegir el ciclo')
    p.select_option('#dsLote', lote['id']); p.wait_for_timeout(100)
    chk(c0['nombre'] in p.inner_text('#dsCu'), 'al elegir el lote se muestra su origen de cultivo')
    chk(p.locator('#fDS [name=fc]').count() == 1, 'modo local (demo): sigue la Factura C simulada')
    p.fill('#fDS [name=cant]', '2'); p.fill('#fDS [name=obs]', 'prueba'); p.fill('#fDS [name=aporte]', '1.500')
    p.select_option('#fDS [name=medio]', 'mixto'); p.wait_for_timeout(100)
    chk(p.locator('#fDS [data-mixto]').is_visible(), 'medio «Mixto» muestra los importes por medio')
    p.uncheck('#fDS [name=fc]')
    p.fill('#fDS [name=mx_efectivo]', '1.000'); p.fill('#fDS [name=mx_transferencia]', '400'); submit('fDS')
    chk('faltan' in err(), 'si la suma no cierra, avisa cuánto falta: %s' % err()[:60])
    p.fill('#fDS [name=mx_transferencia]', '500'); p.wait_for_timeout(100)
    chk('cierra' in p.inner_text('#fDS [data-mxsum]'), 'la suma se muestra en vivo y cierra')
    submit('fDS')
    d = ev("CM.db.disp[CM.db.disp.length-1]"); a = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(d['cu'] == c0['id'], 'la dispensación quedó con el ciclo del lote')
    chk(a['medio'] == 'mixto' and a['pays'] == [{'m': 'efectivo', 'a': 100000}, {'m': 'transferencia', 'a': 50000}], 'donación mixta guardada con su detalle')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(100)
    caja = ev("(()=>{const c=CM.cajaAbierta();if(!c)return null;const mv=CM.cajaMovs(c).filter(m=>m.ref==='%s');return {n:mv.length,ef:mv.filter(m=>m.medio==='efectivo').reduce((s,m)=>s+m.cent,0),tr:mv.filter(m=>m.medio==='transferencia').reduce((s,m)=>s+m.cent,0)}})()" % a['id'])
    chk(caja is not None and caja == {'n': 2, 'ef': 100000, 'tr': 50000}, 'caja: la mixta entra como 2 movimientos y sólo $1.000 al efectivo: %s' % caja)
    # lote sin ciclo: avisa y no bloquea
    p.click('[data-act=lote-nuevo]') if p.locator('[data-act=lote-nuevo]').count() else None
    ev("CM.modal.close(true)")
    lsc = ev("CM.db.lotes.find(l=>!l.cu && CM.stockLote(l.id)>2).id")
    ev("CM.acts.dispensar({getAttribute:()=>%s})" % json.dumps(dni)); p.wait_for_timeout(200)
    p.select_option('#dsLote', lsc); p.wait_for_timeout(100)
    chk('no tiene ciclo' in p.inner_text('#dsCu'), 'lote sin ciclo: se avisa')
    p.fill('#fDS [name=cant]', '1'); p.fill('#fDS [name=obs]', 'prueba'); submit('fDS')
    chk(ev("CM.db.disp[CM.db.disp.length-1].lote") == lsc, 'lote sin ciclo: igual se dispensa')
    ev("CM.modal.close(true)")
    # asignar ciclo a un lote existente
    ir('#/trazabilidad'); p.click('[data-act=lote-ciclo]'); p.wait_for_timeout(200)
    p.select_option('#fLC [name=lote]', lsc); p.select_option('#fLC [name=cu]', c0['id']); submit('fLC')
    chk(ev("CM.lote(%s).cu" % json.dumps(lsc)) == c0['id'] and len(ev("CM.lote(%s).cuHist" % json.dumps(lsc))) == 1, 'asignar ciclo a un lote: guardado con historial')
    p.click('[data-act=lote-ciclo]'); p.wait_for_timeout(200); p.select_option('#fLC [name=lote]', lsc); p.select_option('#fLC [name=cu]', ''); submit('fLC')
    chk('motivo' in err().lower(), 'cambiar un ciclo ya asignado pide motivo'); ev("CM.modal.close(true)")

    # ---------- 4) donación suelta mixta ----------
    ev("CM.acts.aporte({getAttribute:()=>''})"); p.wait_for_timeout(200)
    p.fill('#fAP [name=importe]', '3000'); p.select_option('#fAP [name=medio]', 'mixto')
    p.fill('#fAP [name=mx_mercadopago]', '2000'); p.fill('#fAP [name=mx_efectivo]', '1000'); p.uncheck('#fAP [name=fc]'); submit('fAP')
    a = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(a['medio'] == 'mixto' and sum(x['a'] for x in a['pays']) == 300000, 'donación mixta desde «Donaciones»')
    ev("CM.modal.close(true)")
    ir('#/aportes')
    chk(p.locator('td', has_text='Mixto: Efectivo').count() >= 1, 'la lista de donaciones muestra el detalle de la mixta')

    # ---------- 5) Inicio y Factura C con nube ----------
    ir('#/inicio')
    chk('Datos de ejemplo' in p.inner_text('#hqh'), 'modo demo: conserva la ayuda de ejemplo')
    ev("CM.nube.activa=true;CM.render()"); p.wait_for_timeout(200)
    chk('Datos de ejemplo' not in p.inner_text('#hqh') and '99000001' not in p.inner_text('#main'), 'con nube: sin datos ni números de ejemplo en Inicio')
    ev("CM.acts.aporte({getAttribute:()=>''})"); p.wait_for_timeout(200)
    chk(p.locator('#fAP [name=fc]').count() == 0, 'con nube: no se ofrece la Factura C simulada')
    ev("CM.modal.close(true);CM.nube.activa=false")
    ev("(()=>{const a=CM.db.aportes.find(x=>x.estado==='registrado');a.fecha=CM.hoy();a.mig=true;CM.save();CM.render();})()"); p.wait_for_timeout(200)
    chk('importadas del sistema anterior' in p.inner_text('#main'), 'Inicio separa lo importado del sistema anterior')

    # ---------- 6) domicilio de cultivo ----------
    ir('#/reprocann')
    chk(p.locator('th', has_text='Domicilio de cultivo').count() == 1, 'REPROCANN: columna domicilio de cultivo')
    p.locator('[data-act=rep-edit]').first.click(); p.wait_for_timeout(200)
    p.select_option('#fRP [name=cult]', 'autocultivo'); submit('fRP')
    chk('domicilio' in err().lower(), 'autocultivo sin domicilio: se pide')
    p.fill('#fRP [name=cultDir]', 'Calle Ficticia 123, Salta')
    if ev("document.querySelector('#fRP [name=estado]').value") == 'valido' and not ev("document.querySelector('#fRP [name=vence]').value"):
        p.fill('#fRP [name=vence]', '2029-01-01')
    submit('fRP')
    chk(ev("Object.values(CM.db.pacientes).some(x=>x.cultivo&&x.cultivo.tipo==='autocultivo'&&x.cultivo.dir.indexOf('Ficticia')>0)"), 'domicilio de cultivo guardado')
    chk(p.locator('td .pill', has_text='Autocultivo').count() == 1 and p.locator('td .pill', has_text='A completar').count() >= 1, 'la tabla muestra Autocultivo y «A completar»')

    # ---------- 7) tareas: todo el equipo ----------
    ev("CM.db.users=[{id:'u1',nombre:'Persona Uno (ficticia)',activo:true},{id:'u2',nombre:'Persona Dos (ficticia)',activo:true}].concat(CM.db.users)")
    ir('#/tareas')
    opts = p.eval_on_selector_all('#tarResp option', 'os=>os.map(o=>o.textContent)')
    chk('Persona Uno (ficticia)' in opts and 'Persona Dos (ficticia)' in opts and len(opts) >= 4, 'filtro de tareas con personal y usuarios del sistema (%d)' % len(opts))
    p.click('[data-act=tar-nueva]'); p.wait_for_timeout(200); p.fill('#fTA [name=t]', 'Tarea de prueba'); p.select_option('#fTA [name=resp]', 'U:u1'); submit('fTA')
    chk(p.locator('.kcard', has_text='Tarea de prueba').count() == 1, 'tarea asignada a un usuario del sistema')

    # ---------- 8) forma ----------
    for w, h in ((360, 800), (768, 900)):
        p.set_viewport_size({'width': w, 'height': h})
        for r in ('#/fidelizacion', '#/cultivo', '#/trazabilidad', '#/reprocann'):
            ir(r)
            chk(ev('document.documentElement.scrollWidth <= innerWidth + 1'), 'sin desborde horizontal %s a %d px' % (r, w))
    chk(not errs, 'consola sin errores' + (': ' + ' | '.join(errs[:3]) if errs else ''))
    b.close()
print('\n%d ok, %d fallas' % (oks[0], len(fallas)))
raise SystemExit(1 if fallas else 0)
