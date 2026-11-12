"""Editar · agregar · borrar (2026-11-12). Genéticas, ciclos de cultivo, lotes, cupones y menú público.
Borrar = baja con motivo y restaurable; bloqueado cuando rompería la trazabilidad. Uso: python3 t/e2e_crud_1112.py (PAGINA=index.html)"""
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
with sync_playwright() as pw:
    b = pw.chromium.launch(); p = b.new_page(viewport={'width': 1366, 'height': 900}); errs = []
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.goto(U); p.wait_for_timeout(700); ev = p.evaluate
    ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';CM.db.cfg.operador=u.nombre;})()")
    def ir(h): p.goto(U + '#/inicio'); p.wait_for_timeout(80); p.goto(U + h); p.wait_for_timeout(400)
    def submit(fid): p.click('#modalRoot button[type=submit][form=%s]' % fid); p.wait_for_timeout(300)
    def err(): return p.locator('#modalRoot [data-err]').first.inner_text() if p.locator('#modalRoot [data-err]').count() else ''
    def modal(): return p.inner_text('#modalRoot') if p.locator('#modalRoot .md').count() else ''

    # ---------- genéticas ----------
    ev("CM.cu.tab='cultivo'"); ir('#/trazabilidad')
    cid = ev("CM.cu.sel")
    p.click('[data-act=gen-nueva]'); p.wait_for_timeout(200)
    p.fill('#fGE [name=vari]', 'Aromito CBD'); p.fill('#fGE [name=plantas]', '8'); submit('fGE')
    g = ev("CM.cultivo(%s).geneticas.filter(x=>x.variedad==='Aromito CBD')[0]" % json.dumps(cid))
    chk(g and g['plantas'] == 8, 'agregar genética')
    p.click('[data-act=gen-editar][data-g="%s"]' % g['id']); p.wait_for_timeout(200)
    p.fill('#fGE [name=plantas]', '6'); p.fill('#fGE [name=motivo]', 'recuento'); submit('fGE')
    chk(ev("CM.cultivo(%s).geneticas.filter(x=>x.id===%s)[0].plantas" % (json.dumps(cid), json.dumps(g['id']))) == 6, 'editar genética')
    p.click('[data-act=gen-borrar][data-g="%s"]' % g['id']); p.wait_for_timeout(200)
    submit('fCR'); chk('motivo' in err().lower(), 'borrar pide motivo')
    p.fill('#fCR [name=motivo]', 'cargada por error'); submit('fCR')
    chk(p.locator('.cu-gen tbody tr', has_text='Aromito CBD').count() == 0 or p.locator('.crud-bajas', has_text='Aromito').count() == 1, 'borrar genética: sale de la tabla')
    chk(ev("!!CM.cultivo(%s).geneticas.filter(x=>x.id===%s)[0].borrada" % (json.dumps(cid), json.dumps(g['id']))) and ev("CM.db.audit.some(a=>a.accion==='Cultivo: genética borrada')"), 'queda como borrada (con motivo) y en la auditoría')
    p.locator('.crud-bajas summary', has_text='Genéticas borradas').click(); p.click('[data-act=gen-restaurar][data-g="%s"]' % g['id']); p.wait_for_timeout(300)
    chk(not ev("CM.cultivo(%s).geneticas.filter(x=>x.id===%s)[0].borrada" % (json.dumps(cid), json.dumps(g['id']))), 'restaurar genética')
    # genética con lote cosechado: no se borra
    gl = ev("(()=>{for(const c of CM.db.cultivos){for(const x of (c.geneticas||[])){if(CM.lotesVivos().some(l=>l.cu===c.id&&l.gen===x.id))return [c.id,x.id]}}return null})()")
    if not gl:
        p.click('[data-act=gen-cosecha][data-g="%s"]' % g['id']); p.wait_for_timeout(250)
        p.fill('#modalRoot [name=cant]', '50'); p.click('#modalRoot button[type=submit]'); p.wait_for_timeout(300)
        gl = [cid, g['id']]
    ev("CM.cu.sel=%s" % json.dumps(gl[0])); ir('#/trazabilidad')
    p.click('[data-act=gen-borrar][data-g="%s"]' % gl[1]); p.wait_for_timeout(200)
    chk('lotes cosechados' in modal(), 'genética con lotes cosechados: no se borra y explica la alternativa')
    p.keyboard.press('Escape')

    # ---------- ciclos ----------
    p.click('[data-act=cu-nuevo]'); p.wait_for_timeout(200)
    p.fill('#fCU [name=nombre]', 'Ciclo de prueba'); p.fill('#fCU [name=lote]', 'Sala 9'); submit('fCU')
    nc = ev("CM.cu.sel")
    p.click('[data-act=cu-editar][data-id="%s"]' % nc); p.wait_for_timeout(200)
    p.fill('#fCE [name=lote]', 'Sala 10'); p.fill('#fCE [name=motivo]', 'cambio de sala'); submit('fCE')
    chk(ev("CM.cultivo(%s).lote" % json.dumps(nc)) == 'Sala 10' and ev("CM.cultivo(%s).edHist.length" % json.dumps(nc)) == 1, 'editar ciclo (con historial)')
    p.click('[data-act=cu-borrar][data-id="%s"]' % nc); p.wait_for_timeout(200)
    p.fill('#fCR [name=motivo]', 'creado de prueba'); submit('fCR')
    chk(ev("!!CM.cultivo(%s).baja" % json.dumps(nc)) and p.locator('.cu-cod', has_text=nc).count() == 0, 'borrar ciclo vacío: sale de la lista')
    chk(ev("CM.ciclosVivos().every(c=>c.id!==%s)" % json.dumps(nc)), 'y no aparece al elegir ciclo de un lote')
    p.locator('.crud-bajas summary', has_text='Ciclos borrados').click(); p.click('[data-act=cu-restaurar][data-id="%s"]' % nc); p.wait_for_timeout(300)
    chk(not ev("CM.cultivo(%s).baja" % json.dumps(nc)), 'restaurar ciclo')
    ev("CM.cu.sel=%s" % json.dumps(gl[0])); ir('#/trazabilidad')
    p.click('[data-act=cu-borrar][data-id="%s"]' % gl[0]); p.wait_for_timeout(200)
    chk('Cerrar ciclo' in modal(), 'ciclo con registros o lotes: no se borra')
    p.keyboard.press('Escape')

    # ---------- lotes ----------
    ev("CM.cu.tab='lotes'"); ir('#/trazabilidad')
    lconDisp = ev("CM.db.disp[0].lote")
    p.click('[data-act=lote-borrar][data-id="%s"]' % lconDisp); p.wait_for_timeout(200)
    chk('dispensación' in modal() and 'Ajustar stock' in modal(), 'lote con dispensaciones: no se borra (trazabilidad)')
    p.keyboard.press('Escape')
    p.click('[data-act=lote-nuevo]'); p.wait_for_timeout(200)
    p.fill('#fLN [name=nombre]', 'Lote equivocado'); p.fill('#fLN [name=cant]', '40'); submit('fLN')
    nl = ev("CM.db.lotes[CM.db.lotes.length-1].id")
    p.click('[data-act=lote-editar][data-id="%s"]' % nl); p.wait_for_timeout(200)
    p.fill('#fLE [name=nombre]', 'Lote corregido'); p.fill('#fLE [name=quim]', 'Q2'); p.fill('#fLE [name=motivo]', 'nombre mal escrito'); submit('fLE')
    chk(ev("[CM.lote(%s).nombre, CM.lote(%s).quim]" % (json.dumps(nl), json.dumps(nl))) == ['Lote corregido', 'Q2'], 'editar lote (nombre y quimiotipo)')
    p.click('[data-act=lote-borrar][data-id="%s"]' % nl); p.wait_for_timeout(200)
    p.fill('#fCR [name=motivo]', 'cargado dos veces'); submit('fCR')
    chk(ev("CM.stockLote(%s)" % json.dumps(nl)) == 0 and ev("!!CM.lote(%s).baja" % json.dumps(nl)), 'borrar lote sin dispensaciones: stock a 0 con movimiento de baja')
    chk(p.locator('main table td', has_text=nl).count() == 0 or p.locator('.crud-bajas', has_text=nl).count() == 1, 'sale de la tabla de stock')
    ev("CM.acts.dispensar({getAttribute:()=>''})"); p.wait_for_timeout(200)
    chk(p.locator('#fDS option[value="%s"]' % nl).count() == 0, 'no se puede elegir al dispensar'); p.keyboard.press('Escape'); p.wait_for_timeout(100)
    ir('#/inventario')
    chk(p.locator('main', has_text=nl).count() == 0, 'tampoco aparece en Inventario')
    ir('#/trazabilidad'); p.locator('.crud-bajas summary', has_text='Lotes dados de baja').click(); p.click('[data-act=lote-restaurar][data-id="%s"]' % nl); p.wait_for_timeout(300)
    chk(ev("CM.stockLote(%s)" % json.dumps(nl)) == 40 and not ev("CM.lote(%s).baja" % json.dumps(nl)), 'restaurar lote: vuelve con su stock')

    # ---------- cupones ----------
    ev("CM.fid&&(CM.fid.tab='cupones')"); ir('#/fidelizacion')
    if p.locator('[data-act=fid-tab][data-v=cupones]').count(): p.click('[data-act=fid-tab][data-v=cupones]'); p.wait_for_timeout(300)
    cp = ev("CM.db.cupones[0]")
    p.click('[data-act=cupon-editar][data-id="%s"]' % cp['id']); p.wait_for_timeout(200)
    p.fill('#fCE2 [name=desc]', 'Descripción corregida'); p.fill('#fCE2 [name=motivo]', 'texto'); submit('fCE2')
    chk(ev("CM.db.cupones[0].desc") == 'Descripción corregida', 'editar cupón')
    p.click('[data-act=cupon-borrar][data-id="%s"]' % cp['id']); p.wait_for_timeout(200)
    p.fill('#fCR [name=motivo]', 'campaña terminada'); submit('fCR')
    chk(ev("CM.cupon(%s)" % json.dumps(cp['cod'])) is None, 'cupón borrado: ya no se puede canjear')
    p.locator('.crud-bajas summary', has_text='Cupones borrados').click(); p.click('[data-act=cupon-restaurar][data-id="%s"]' % cp['id']); p.wait_for_timeout(300)
    chk(ev("!!CM.cupon(%s)" % json.dumps(cp['cod'])), 'restaurar cupón')

    # ---------- menú público ----------
    ev("CM.mp.tab='items'"); ir('#/menu-publico')
    for tab in ['items', 'cat', 'serv', 'catalogo']:
        if p.locator('[data-act=mp-borrar][data-k=items]').count(): break
        if p.locator('[data-act=mp-tab][data-v=%s]' % tab).count(): p.click('[data-act=mp-tab][data-v=%s]' % tab); p.wait_for_timeout(250)
    it = ev("(()=>{const d=CM.db.menu.draft;return [d.items.find(i=>d.agenda.some(a=>a.item===i.id)).id, d.items.find(i=>!d.agenda.some(a=>a.item===i.id)).id]})()")
    p.click('[data-act=mp-borrar][data-k=items][data-id="%s"]' % it[0]); p.wait_for_timeout(200)
    chk('agenda' in modal().lower(), 'ítem con fechas en la agenda: pide borrar las fechas primero'); p.keyboard.press('Escape')
    p.click('[data-act=mp-borrar][data-k=items][data-id="%s"]' % it[1]); p.wait_for_timeout(200); submit('fCR')
    chk(ev("CM.db.menu.draft.items.every(i=>i.id!==%s)" % json.dumps(it[1])) and ev("CM.db.menu.pub.items.some(i=>i.id===%s)" % json.dumps(it[1])), 'borrar ítem: sale del borrador, lo publicado no cambia')

    chk(not errs, 'sin errores en la consola: %s' % errs[:3])
    b.close()
print('\n%d ok · %d fallas' % (oks[0], len(fallas)))
if fallas: print('\n'.join(fallas)); raise SystemExit(1)
