"""Etapa 2 · 2026-11-11 (Chromium real, modo local con datos FICTICIOS).
Varias genéticas en una sala, cosecha → lote por genética, dispensación con genética, trazabilidad completa
sala → genética → lote → dispensación → legajo, «Genética de un lote», registros diarios con genética.
Uso: python3 t/e2e_cultivo_gen_1111.py   (PAGINA=index.html para el paquete publicado)"""
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
    b = pw.chromium.launch()
    p = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.route('**/*supabase.co/**', lambda r: r.abort())
    p.goto(U); p.wait_for_timeout(700)
    ev = p.evaluate
    ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';CM.db.cfg.operador=u.nombre;})()")
    def ir(h): p.goto(U + '#/inicio'); p.wait_for_timeout(80); p.goto(U + h); p.wait_for_timeout(300)
    def submit(fid): p.click('#modalRoot button[type=submit][form=%s]' % fid); p.wait_for_timeout(300)
    def err(): return p.locator('#modalRoot [data-err]').first.inner_text() if p.locator('#modalRoot [data-err]').count() else ''

    # ---------- sala con dos genéticas ----------
    ir('#/cultivo')
    p.click('[data-act=cu-nuevo]'); p.wait_for_timeout(200)
    f = p.locator('#modalRoot form').first; fid = f.get_attribute('id')
    p.fill('#%s [name=nombre]' % fid, 'Sala 2 prueba'); p.fill('#%s [name=lote]' % fid, 'Sala 2'); submit(fid)
    cu = ev("CM.db.cultivos.find(c=>c.nombre==='Sala 2 prueba').id")
    chk(bool(cu), 'ciclo «Sala 2 prueba» creado: %s' % cu)
    ev("CM.cu.sel=%s;CM.render()" % json.dumps(cu)); p.wait_for_timeout(200)
    for v, n in [('Petroleum', '7'), ('Tropicanna Cookies', '11')]:
        p.click('[data-act=gen-nueva][data-id="%s"]' % cu); p.wait_for_timeout(200)
        p.fill('#fGE [name=vari]', v); p.fill('#fGE [name=plantas]', n); submit('fGE')
    gs = ev("CM.cultivo(%s).geneticas.map(x=>[x.id,x.variedad,x.plantas])" % json.dumps(cu))
    chk(len(gs) == 2, 'dos genéticas en la misma sala: %s' % [x[1] for x in gs])
    g1, g2 = gs[0][0], gs[1][0]
    chk(p.locator('th', has_text='Lotes y dispensado').count() == 1 and p.locator('text=Sin lotes todavía').count() == 2, 'cada genética muestra sus lotes (todavía ninguno)')

    # ---------- registro diario de la sala con genética opcional ----------
    p.click('[data-act=cr-nuevo][data-id="%s"]' % cu); p.wait_for_timeout(200)
    chk(p.locator('#fCR [name=gen] option').count() == 3, 'registro: se puede elegir la genética (o toda la sala)')
    p.select_option('#fCR [name=fase]', 'Vegetativo'); p.fill('#fCR [name=enc]', 'Operador demo'); p.fill('#fCR [name=ph]', '6,2')
    p.select_option('#fCR [name=gen]', g2); p.fill('#fCR [name=obs]', 'hojas amarillas'); submit('fCR')
    r = ev("CM.db.cultReg[CM.db.cultReg.length-1]")
    chk(r['gen'] == g2 and r['genVar'] == 'Tropicanna Cookies', 'el registro guarda la genética')
    chk(p.locator('table.cult .pill', has_text='Tropicanna Cookies').count() == 1, 'la planilla muestra la genética del registro')
    p.click('[data-act=cr-nuevo][data-id="%s"]' % cu); p.wait_for_timeout(200)
    p.select_option('#fCR [name=fase]', 'Vegetativo'); p.fill('#fCR [name=enc]', 'Operador demo'); p.fill('#fCR [name=h]', '60'); submit('fCR')
    chk(ev("CM.db.cultReg[CM.db.cultReg.length-1].gen") == '', 'sin elegir genética, el registro es de toda la sala')

    # ---------- cosecha → lote por genética ----------
    p.click('[data-act=gen-cosecha][data-g="%s"]' % g1); p.wait_for_timeout(200)
    chk(p.input_value('#fGC [name=nombre]') == 'Petroleum', 'cosecha: el nombre del lote viene de la genética')
    submit('fGC'); chk('cantidad' in err().lower(), 'pide la cantidad: %s' % err())
    p.fill('#fGC [name=cant]', '120'); p.fill('#fGC [name=sug]', '5000'); p.fill('#fGC [name=quim]', 'Q1'); submit('fGC')
    l1 = ev("CM.db.lotes[CM.db.lotes.length-1]")
    chk(l1['cu'] == cu and l1['gen'] == g1 and l1['genVar'] == 'Petroleum' and l1['sug'] == 500000, 'lote creado con su sala, su genética y el sugerido')
    chk(ev("CM.stockLote(%s)" % json.dumps(l1['id'])) == 120, 'el lote ingresa 120 g de stock')
    chk(ev("CM.cultivo(%s).geneticas.find(x=>x.id===%s).estado" % (json.dumps(cu), json.dumps(g1))) == 'Cosechada', 'la genética queda «Cosechada» (con historial)')
    # cosecha parcial de la otra genética, en dos lotes
    for cant in ['40', '30']:
        p.click('[data-act=gen-cosecha][data-g="%s"]' % g2); p.wait_for_timeout(200)
        p.fill('#fGC [name=cant]', cant); p.uncheck('#fGC [name=marcar]'); submit('fGC')
    l2s = ev("CM.db.lotes.filter(l=>l.gen===%s).map(l=>l.id)" % json.dumps(g2))
    chk(len(l2s) == 2 and ev("CM.cultivo(%s).geneticas.find(x=>x.id===%s).estado" % (json.dumps(cu), json.dumps(g2))) != 'Cosechada', 'cosecha parcial: dos lotes de la misma genética y sigue activa')

    # ---------- dispensación lleva la genética ----------
    dnis = ev("Object.keys(CM.db.pacientes).filter(k=>CM.reglasDispensar(CM.db.pacientes[k]).bloquea===false).slice(0,2)")
    for i, (dni, lid, cant) in enumerate([(dnis[0], l1['id'], '3'), (dnis[1], l1['id'], '6'), (dnis[0], l2s[0], '2')]):
        ev("CM.acts.dispensar({getAttribute:()=>%s})" % json.dumps(dni)); p.wait_for_timeout(250)
        p.select_option('#fDS [name=lote]', lid); p.wait_for_timeout(120)
        if i == 0: chk('genética' in p.locator('#dsCu').inner_text() and 'Petroleum' in p.locator('#dsCu').inner_text(), 'la dispensación muestra la genética de origen: %s' % p.locator('#dsCu').inner_text())
        p.fill('#fDS [name=cant]', cant); p.fill('#fDS [name=aporte]', ''); submit('fDS'); p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)
    ds = ev("CM.db.disp.slice(-3).map(d=>[d.lote,d.cu,d.gen,d.genVar])")
    chk(ds[0][1:] == [cu, g1, 'Petroleum'] and ds[2][1:] == [cu, g2, 'Tropicanna Cookies'], 'cada dispensación guarda sala y genética: %s' % ds)

    # ---------- trazabilidad completa ----------
    ir('#/cultivo'); ev("CM.cu.sel=%s;CM.render()" % json.dumps(cu)); p.wait_for_timeout(200)
    tz = ev("(()=>{const c=CM.cultivo(%s);const x=c.geneticas.find(y=>y.id===%s);const t=CM.trazGen(c,x);return [t.lotes.length,t.disp.length,t.pacientes,t.porU.g,t.ingreso];})()" % (json.dumps(cu), json.dumps(g1)))
    chk(tz == [1, 2, 2, 9, 120], 'Petroleum: 1 lote, 2 dispensaciones, 2 pacientes, 9 g de 120: %s' % tz)
    chk(p.locator('td', has_text='dispensado a 2 pacientes').count() == 1, 'la tabla de genéticas resume lo dispensado')
    p.click('[data-act=gen-traz][data-g="%s"]' % g1); p.wait_for_timeout(250)
    m = p.locator('#modalRoot').inner_text()
    chk('Sala 2 prueba' in m and 'Petroleum' in m and l1['id'] in m and 'legajo' in m.lower(), 'modal de trazabilidad: sala → genética → lote → dispensaciones')
    chk(ev("Object.values(CM.db.pacientes).some(p=>%s.includes(p.nombre))" % json.dumps(m)) is False, 'la trazabilidad no muestra nombres de pacientes (sólo legajo)')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)
    tz2 = ev("(()=>{const c=CM.cultivo(%s);const x=c.geneticas.find(y=>y.id===%s);const t=CM.trazGen(c,x);return [t.lotes.length,t.disp.length,t.porU.g];})()" % (json.dumps(cu), json.dumps(g2)))
    chk(tz2 == [2, 1, 2], 'Tropicanna Cookies sigue su propia trazabilidad: %s' % tz2)

    # ---------- anular una dispensación sale de la trazabilidad ----------
    did = ev("CM.db.disp[CM.db.disp.length-1].id")
    ev("CM.acts['anular-disp']({getAttribute:()=>%s})" % json.dumps(did)); p.wait_for_timeout(200)
    p.fill('#fAN [name=motivo]', 'error de carga'); submit('fAN')
    chk(ev("(()=>{const c=CM.cultivo(%s);return CM.trazGen(c,c.geneticas.find(y=>y.id===%s)).disp.length})()" % (json.dumps(cu), json.dumps(g2))) == 0, 'una dispensación anulada no cuenta en la trazabilidad')

    # ---------- genética de un lote existente ----------
    ir('#/trazabilidad')
    chk(p.locator('small', has_text='Genética: Petroleum').count() >= 1, 'Trazabilidad / Stock muestra la genética del lote')
    lv = ev("CM.db.lotes.find(l=>!l.gen && l.prod==='flores').id")
    p.click('[data-act=lote-gen]'); p.wait_for_timeout(200)
    p.select_option('#fLG [name=lote]', lv); p.select_option('#fLG [name=gen]', cu + '|' + g2); submit('fLG')
    l3 = ev("CM.lote(%s)" % json.dumps(lv))
    chk(l3['cu'] == cu and l3['gen'] == g2 and len(l3.get('cuHist', [])) >= 1, 'lote existente vinculado a la genética, con historial')
    p.click('[data-act=lote-gen]'); p.wait_for_timeout(200)
    p.select_option('#fLG [name=lote]', lv); p.select_option('#fLG [name=gen]', cu + '|' + g1); submit('fLG')
    chk('motivo' in err().lower(), 'cambiar la genética de un lote pide motivo')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(100)
    # cambiar el ciclo borra la genética vieja
    otro = ev("CM.db.cultivos.find(c=>c.id!==%s).id" % json.dumps(cu))
    p.click('[data-act=lote-ciclo]'); p.wait_for_timeout(200)
    p.select_option('#fLC [name=lote]', lv); p.select_option('#fLC [name=cu]', otro); p.fill('#fLC [name=motivo]', 'otra sala'); submit('fLC')
    chk(ev("CM.lote(%s).cu" % json.dumps(lv)) == otro and not ev("CM.lote(%s).gen" % json.dumps(lv)), 'si cambia el ciclo del lote, se quita la genética que era de la otra sala')

    for h in ['#/cultivo', '#/trazabilidad', '#/dispensaciones', '#/inicio']:
        ir(h); chk(p.locator('main h1').count() >= 1, 'abre ' + h)
    chk(not errs, 'consola sin errores %s' % errs[:3])
    b.close()
print('%d ok, %d fallas' % (oks[0], len(fallas)))
if fallas: print('FALLAS:', fallas); raise SystemExit(1)
