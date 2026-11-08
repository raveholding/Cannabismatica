"""Tarjeta del Club (QR y código que cambian, reemitir, baja, celular) y detalle de operaciones de caja · 2026-11-08 · datos FICTICIOS (Chromium real, modo local con datos FICTICIOS: no toca la base del cliente).
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

    D = ev("Object.keys(CM.db.pacientes).slice(0,3)")
    d1, d2, d3 = D[0], D[1], D[2]
    ev("CM.db.sellos=[];CM.save()")
    ir('#/fidelizacion'); ev("CM.fid.tab='sellos';CM.render()"); p.wait_for_timeout(200)
    p.click('[data-act=sello-tarjeta][data-dni="%s"]' % d1); p.wait_for_timeout(200)
    chk(p.locator('#modalRoot [data-act=club-emitir]').count() == 1, 'paciente sin tarjeta → «Emitir tarjeta»')
    p.click('#modalRoot [data-act=club-emitir]'); p.wait_for_timeout(250)
    c1 = ev("CM.paciente('%s').club" % d1)
    chk(c1['num'] == '0001' and len(c1['id']) == 16 and len(c1['sec']) == 24, 'emitida: socio 0001, id y clave al azar')
    aud = ev("JSON.stringify(CM.db.audit.slice(0,3))")
    chk(c1['sec'] not in aud and c1['id'] not in aud, 'la auditoría no guarda el identificador ni la clave')
    chk(p.locator('#modalRoot svg').count() >= 1 and 'Socio/a N.º 0001' in p.locator('#modalRoot').inner_text(), 'tarjeta impresa con QR y N.º de socio')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)
    tokN = 'CM2N|' + c1['id']
    chk(ev("CM.leerTokenSello('%s').dni" % tokN) == d1, 'QR impreso identifica al paciente')
    chk('vieja' in ev("CM.leerTokenSello('CM-S|%s|abcdef12').err" % d1), 'tarjeta vieja CM-S rechazada')
    # celular: QR rotativo de un solo uso
    ev("CM.clubEmitir('%s','');CM.save()" % d2)
    c2 = ev("CM.paciente('%s').club" % d2)
    w = ev("CM.clubVentana()"); cod = ev("CM.clubCodigo('%s',%d)" % (c2['sec'], w))
    tok = 'CM2|%s|%s' % (c2['id'], cod)
    r = ev("(()=>{const r=CM.leerTokenSello('%s');return CM.sellarLeido(r,'x').ok?'ok':'no'})()" % tok)
    chk(r == 'ok' and ev("CM.saldoSellos('%s')" % d2) == 1, 'QR del celular → sello')
    chk('ya se usó' in (ev("CM.leerTokenSello('%s').err||''" % tok)), 'el mismo QR no se puede usar dos veces')
    chk('venció' in (ev("CM.leerTokenSello('CM2|%s|%s').err||''" % (c2['id'], '0000' if cod != '0000' else '1111'))), 'código equivocado/vencido rechazado')
    # código de 8 cifras (otro paciente)
    ev("CM.clubEmitir('%s','');CM.save()" % d3)
    c3 = ev("CM.paciente('%s').club" % d3)
    cod3 = ev("CM.clubCodigo('%s',CM.clubVentana())" % c3['sec'])
    ir('#/fidelizacion'); ev("CM.fid.tab='sellos';CM.render()"); p.wait_for_timeout(200)
    p.fill('[data-form=sello-cod] [name=cod]', c3['num'] + '9999' if cod3 != '9999' else c3['num'] + '0000'); p.click('[data-form=sello-cod] button[type=submit]'); p.wait_for_timeout(200)
    chk('no coincide' in p.locator('[data-form=sello-cod] [data-err]').inner_text(), 'código de 8 cifras incorrecto: avisa')
    p.fill('[data-form=sello-cod] [name=cod]', c3['num'] + cod3); p.click('[data-form=sello-cod] button[type=submit]'); p.wait_for_timeout(250)
    chk(ev("CM.saldoSellos('%s')" % d3) == 1 and 'código de 8 cifras' in ev("CM.db.audit[0].detalle"), 'código de 8 cifras → sello, auditado con el medio')
    # reloj adelantado: el código anterior vence
    ev("window.__now=Date.now()+10*60000")
    chk('venció' in ev("CM.leerCodigoClub('%s').err||''" % (c3['num'] + cod3)), 'a los 10 minutos el código ya no sirve')
    ev("delete window.__now")
    # reemitir: lo anterior deja de servir
    ev("CM.clubEmitir('%s','perdió');CM.save()" % d1)
    chk(ev("CM.leerTokenSello('%s').err||''" % tokN) != '' and ev("CM.paciente('%s').club.num" % d1) == '0001', 'reemitir: QR anterior inválido, mismo N.º de socio')
    # celular: enlace personal
    c2b = c2
    p.goto(U + '#/tarjeta/%s.%s' % (c2b['id'], c2b['sec'])); p.wait_for_timeout(700)
    chk('#/mitarjeta' in p.url and ev("JSON.parse(localStorage.getItem('cm_mitarjeta')).id") == c2b['id'], 'abrir el enlace guarda la tarjeta y pasa a #/mitarjeta')
    p.wait_for_timeout(300)
    txt = p.locator('#main').inner_text()
    chk('Socio/a N.º 0002' in txt and '1 / ' in txt, 'tarjeta en el celular: N.º de socio y sellos al día (%s)' % txt[:60].replace('\n', ' '))
    codv = ev("CM.clubCodigo('%s',CM.clubVentana())" % c2b['sec'])
    chk(codv in p.locator('.mitj-cod').inner_text() and p.locator('.mitj-qr svg').count() == 1, 'muestra el código vigente y el QR')
    for wd in (360, 412):
        p.set_viewport_size({'width': wd, 'height': 800}); p.wait_for_timeout(150)
        chk(ev("document.documentElement.scrollWidth<=innerWidth+1"), 'mi tarjeta sin desborde a %d px' % wd)
    ev("localStorage.removeItem('cm_mitarjeta')"); ev("CM.render()"); p.wait_for_timeout(600)
    chk(ev("!!localStorage.getItem('cm_mitarjeta')") and 'Socio/a N.º' in p.locator('#main').inner_text(), 'si se borra localStorage se restaura desde IndexedDB')
    # baja
    ev("CM.clubBaja('%s','prueba');CM.save()" % d2); ev("CM.render()"); p.wait_for_timeout(400)
    chk('sin validez' in p.locator('#main').inner_text(), 'tarjeta dada de baja: el celular avisa')
    chk('no existe' in ev("CM.leerTokenSello('CM2N|%s').err||''" % c2b['id']), 'tarjeta dada de baja: el mostrador la rechaza')
    p.set_viewport_size({'width': 1280, 'height': 900})
    # caja: detalle de operación
    ev("(()=>{const u=CM.db.users[0];CM.ses.set(u.id);})()")
    ev("CM.db.cajas.filter(c=>c.estado==='abierta').forEach(c=>{c.estado='cerrada';c.cierre={movs:[],fecha:CM.hoy(),notas:[],porMedio:{},hash:''}});CM.save()")
    ir('#/caja'); p.click('[data-act=caja-abrir]'); p.wait_for_timeout(200); p.fill('#fCA [name=ini]', '1000'); submit('fCA')
    ev("""(()=>{CM.db.aportes.push({id:'A-TC',fecha:CM.hoy(),ts:new Date().toISOString(),dni:'%s',rec:null,disp:'',cent:500000,medio:'mixto',pays:[{m:'efectivo',a:200000},{m:'transferencia',a:300000}],concepto:CM.CONCEPTOS[0],obs:'',user:'x',estado:'registrado',comp:''});CM.save();})()""" % d1)
    ir('#/caja')
    chk(p.locator('[data-act=op-det][data-id="AP-A-TC-1"]').count() == 1 and p.locator('[data-act=op-det][data-id="AP-A-TC-2"]').count() == 1, 'donación mixta: dos movimientos con «Ver»')
    p.click('[data-act=op-det][data-id="AP-A-TC-2"]'); p.wait_for_timeout(200)
    t = p.locator('#modalRoot').inner_text()
    chk('Donación A-TC' in t and 'Transferencia' in t and 'Efectivo' in t and 'Se concilia aparte' in t, 'detalle: donación, sus dos medios y cómo entra a la caja')
    p.click('#modalRoot [data-act=modal-close]')
    p.click('[data-act=caja-mov][data-tipo=egreso]'); p.wait_for_timeout(200)
    rub = ev("CM.rubrosPara('egreso')[0].id"); p.select_option('#fCM [name=rubro]', rub); p.fill('#fCM [name=importe]', '100'); p.fill('#fCM [name=motivo]', 'envases de prueba'); submit('fCM')
    mid = ev("CM.db.cmovs[CM.db.cmovs.length-1].id")
    p.click('[data-act=caja-corregir][data-id="%s"]' % mid); p.wait_for_timeout(200)
    p.select_option('#fCM [name=rubro]', ev("CM.rubrosPara('ingreso')[0].id")); p.fill('#fCM [name=importe]', '100'); p.fill('#fCM [name=motivo]', 'corrección'); submit('fCM')
    chk(ev("CM.db.cmovs[CM.db.cmovs.length-1].ref") == mid, 'el contraasiento queda vinculado al movimiento original')
    p.click('[data-act=op-det][data-id="%s"]' % mid); p.wait_for_timeout(200)
    chk('Corregido por' in p.locator('#modalRoot').inner_text(), 'el detalle muestra la corrección')
    p.click('#modalRoot [data-act=modal-close]')
    for wd in (360, 1280):
        p.set_viewport_size({'width': wd, 'height': 800}); ir('#/caja')
        chk(ev("document.documentElement.scrollWidth<=innerWidth+1"), 'caja sin desborde a %d px' % wd)
    chk(not errs, 'consola sin errores %s' % errs[:3])
    b.close()
print('\n%d ok, %d fallas' % (oks[0], len(fallas)))
import sys; sys.exit(1 if fallas else 0)
