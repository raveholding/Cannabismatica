"""Etapa 1 · 2026-11-11 (Chromium real, modo local con datos FICTICIOS: no toca la base del cliente).
Aporte sugerido por lote y 5+1, Recibido / Cambio (efectivo, transferencia, mixto), caja principal, traspasos,
consolidado, corte X, corte Z dentro del sello, impresora térmica (configuración) y regresiones de la caja.
Uso: python3 t/e2e_caja2_1111.py   (PAGINA=index.html para probar el paquete publicado)"""
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
    def val(sel): return p.input_value(sel)
    def txt(sel): return p.locator(sel).first.inner_text()
    cierres_viejos = ev("CM.db.cajas.filter(c=>c.cierre).every(c=>CM.verificarCierre(c.cierre))")
    chk(cierres_viejos, 'los cierres sellados que ya existían siguen íntegros con el sello nuevo')

    # ---------- 1) lote con aporte sugerido; el siguiente de la misma genética lo hereda ----------
    ir('#/trazabilidad')
    chk(p.locator('th', has_text='Aporte sugerido').count() == 1, 'la tabla de stock muestra la columna «Aporte sugerido»')
    p.click('[data-act=lote-nuevo]'); p.wait_for_timeout(200)
    p.fill('#fLN [name=nombre]', 'Petroleum prueba'); p.fill('#fLN [name=cant]', '120'); p.fill('#fLN [name=sug]', '5.000'); submit('fLN')
    l1 = ev("CM.db.lotes[CM.db.lotes.length-1]")
    chk(l1['sug'] == 500000, 'lote nuevo guarda el aporte sugerido ($ 5.000 por gramo)')
    p.click('[data-act=lote-nuevo]'); p.wait_for_timeout(200)
    p.fill('#fLN [name=nombre]', 'Petroleum prueba'); p.fill('#fLN [name=cant]', '50'); submit('fLN')
    l2 = ev("CM.db.lotes[CM.db.lotes.length-1]")
    chk(l2['sug'] == 500000, 'otro lote de la misma genética hereda el sugerido')
    p.click('[data-act=lote-sug][data-id="%s"]' % l2['id']); p.wait_for_timeout(200)
    chk(val('#fLS [name=sug]') == '5000', 'editar sugerido: trae el valor actual')
    p.fill('#fLS [name=sug]', '6000'); p.fill('#fLS [name=motivo]', 'actualización'); p.uncheck('#fLS [name=todos]'); submit('fLS')
    s12 = ev("[CM.lote(%s).sug, CM.lote(%s).sug, (CM.lote(%s).sugHist||[]).length]" % (json.dumps(l1['id']), json.dumps(l2['id']), json.dumps(l2['id'])))
    chk(s12 == [500000, 600000, 1], 'cambio de sugerido sólo en ese lote, con historial: %s' % s12)
    chk(ev("CM.db.audit.some(a=>a.accion==='Aporte sugerido')"), 'el cambio de sugerido queda en la auditoría')

    # ---------- 2) dispensación: subtotal, 5+1, total ----------
    ir('#/caja')
    ab = ev("CM.cajaAbierta() && CM.cajaAbierta().id")
    chk(bool(ab), 'hay una caja abierta para las pruebas: %s' % ab)
    esp0 = ev("CM.totCaja(CM.cajaAbierta()).esperadoEf")
    dni = ev("Object.keys(CM.db.pacientes).find(k=>CM.reglasDispensar(CM.db.pacientes[k]).bloquea===false)")
    def abrir_disp():
        ev("CM.acts.dispensar({getAttribute:()=>%s})" % json.dumps(dni)); p.wait_for_timeout(250)
        p.select_option('#fDS [name=lote]', l1['id']); p.wait_for_timeout(120)
    abrir_disp()
    chk(val('#fDS [name=sug]') == '5000', 'al elegir el lote se carga el sugerido por gramo')
    p.fill('#fDS [name=cant]', '3'); p.wait_for_timeout(100)
    chk(txt('#fDS [data-apc-sub]') == ev("CM.fmtMoney(1500000)") and val('#fDS [name=desc]') == '0' and val('#fDS [name=aporte]') == '15000', '3 g: subtotal $ 15.000, 5+1 en 0, total 15000 (%s / %s / %s)' % (txt('#fDS [data-apc-sub]'), val('#fDS [name=desc]'), val('#fDS [name=aporte]')))
    p.fill('#fDS [name=cant]', '6'); p.wait_for_timeout(100)
    chk(val('#fDS [name=desc]') == '5000' and val('#fDS [name=aporte]') == '25000', '6 g: 5+1 descuenta 1 g → total 25000 (%s / %s)' % (val('#fDS [name=desc]'), val('#fDS [name=aporte]')))
    p.fill('#fDS [name=cant]', '12'); p.wait_for_timeout(100)
    chk(val('#fDS [name=desc]') == '10000' and val('#fDS [name=aporte]') == '50000', '12 g: 2 sin aporte → total 50000')
    chk('5+1: 2' in txt('#fDS [data-apc-msg]'), 'aviso del 5+1 visible: %s' % txt('#fDS [data-apc-msg]'))
    p.fill('#fDS [name=aporte]', '40000'); p.wait_for_timeout(100)
    chk('voluntaria' in txt('#fDS [data-apc-msg]'), 'total cambiado a mano: aviso de donación voluntaria')
    p.fill('#fDS [name=cant]', '6'); p.wait_for_timeout(100)
    chk(val('#fDS [name=aporte]') == '40000', 'si el total se cambió a mano, no se pisa al cambiar la cantidad')
    p.click('#fDS [data-act=apc-reset]'); p.wait_for_timeout(100)
    chk(val('#fDS [name=aporte]') == '25000', '«Volver al sugerido» recalcula')

    # ---------- 3) efectivo con cambio ----------
    chk(p.locator('#fDS [data-cambio]').is_visible(), 'aparece el apartado Recibido / Cambio')
    p.select_option('#fDS [name=medio]', 'efectivo'); p.fill('#fDS [name=recibido]', '20000'); p.wait_for_timeout(100)
    chk('No alcanza' in txt('#fDS [data-cb-msg]'), 'recibido menor al total: avisa que no alcanza')
    submit('fDS')
    chk('no alcanza' in err(), 'no deja confirmar con recibido insuficiente: %s' % err())
    p.fill('#fDS [name=recibido]', '30000'); p.wait_for_timeout(100)
    chk(txt('#fDS [data-cb-out]') == ev("CM.fmtMoney(500000)"), 'cambio calculado: $ 5.000 (%s)' % txt('#fDS [data-cb-out]'))
    submit('fDS')
    chk(p.locator('#modalRoot .cambio-ok', has_text='5.000').count() == 1, 'confirmación: «Entregá $ 5.000 de cambio en efectivo»')
    a1 = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(a1['cent'] == 2500000 and a1['recibido'] == 3000000 and a1['cambio'] == 500000 and a1['cmMedio'] == 'efectivo', 'la donación guarda total, recibido y cambio')
    chk(a1.get('calc', {}).get('sug') == 500000 and a1['calc']['desc'] == 500000 and a1['calc']['sub'] == 3000000, 'la donación guarda el cálculo sugerido y el 5+1: %s' % a1.get('calc'))
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)
    movs = ev("CM.cajaMovs(CM.cajaAbierta()).filter(m=>m.ref===%s).map(m=>[m.id.slice(0,3),m.tipo,m.medio,m.cent])" % json.dumps(a1['id']))
    chk(movs == [['AP-', 'ingreso', 'efectivo', 3000000], ['CB-', 'egreso', 'efectivo', 500000]], 'caja: entra lo recibido y sale el cambio: %s' % movs)
    esp1 = ev("CM.totCaja(CM.cajaAbierta()).esperadoEf")
    chk(esp1 - esp0 == 2500000, 'el efectivo esperado sube sólo lo donado (%s)' % (esp1 - esp0))

    # ---------- 4) transferencia de más con cambio en efectivo ----------
    abrir_disp(); p.fill('#fDS [name=cant]', '2'); p.wait_for_timeout(100)
    p.select_option('#fDS [name=medio]', 'transferencia'); p.wait_for_timeout(80)
    chk('transferencia' in txt('#fDS [data-cb-lab]').lower(), 'con transferencia el rótulo dice «Recibido por transferencia»')
    p.fill('#fDS [name=recibido]', '15000'); submit('fDS')
    a2 = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(a2['cent'] == 1000000 and a2['cambio'] == 500000 and a2['cmMedio'] == 'transferencia', 'transfirió $ 15.000 por $ 10.000: cambio $ 5.000')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)
    movs2 = ev("CM.cajaMovs(CM.cajaAbierta()).filter(m=>m.ref===%s).map(m=>[m.tipo,m.medio,m.cent])" % json.dumps(a2['id']))
    chk(movs2 == [['ingreso', 'transferencia', 1500000], ['egreso', 'efectivo', 500000]], 'entra la transferencia completa y sale el cambio en efectivo: %s' % movs2)
    esp2 = ev("CM.totCaja(CM.cajaAbierta()).esperadoEf")
    chk(esp2 - esp1 == -500000, 'el efectivo esperado baja por el cambio entregado (%s)' % (esp2 - esp1))

    # ---------- 5) mixto: recibido es la parte en efectivo ----------
    abrir_disp(); p.fill('#fDS [name=cant]', '2'); p.wait_for_timeout(100)
    p.select_option('#fDS [name=medio]', 'mixto'); p.wait_for_timeout(80)
    p.fill('#fDS [name=mx_efectivo]', '4000'); p.fill('#fDS [name=mx_transferencia]', '6000'); p.fill('#fDS [name=recibido]', '5000'); submit('fDS')
    a3 = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(a3['medio'] == 'mixto' and a3['cambio'] == 100000 and a3['cmMedio'] == 'efectivo', 'mixto: entrega $ 5.000 por la parte de $ 4.000 → cambio $ 1.000')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)
    movs3 = ev("CM.cajaMovs(CM.cajaAbierta()).filter(m=>m.ref===%s).map(m=>[m.tipo,m.medio,m.cent])" % json.dumps(a3['id']))
    chk(sorted(movs3) == sorted([['ingreso', 'efectivo', 500000], ['ingreso', 'transferencia', 600000], ['egreso', 'efectivo', 100000]]), 'mixto en la caja: %s' % movs3)

    # ---------- 6) donación suelta con recibido / cambio ----------
    ir('#/aportes'); ev("CM.acts.aporte({getAttribute:()=>''})"); p.wait_for_timeout(200)
    p.fill('#fAP [name=importe]', '7.000'); p.select_option('#fAP [name=medio]', 'efectivo'); p.fill('#fAP [name=recibido]', '10.000'); p.wait_for_timeout(80)
    chk(txt('#fAP [data-cb-out]') == ev("CM.fmtMoney(300000)"), 'donación suelta: cambio $ 3.000')
    if p.locator('#fAP [name=fc]').count(): p.uncheck('#fAP [name=fc]')
    submit('fAP')
    a4 = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(a4['cent'] == 700000 and a4['cambio'] == 300000, 'la donación suelta guarda el cambio')

    # ---------- 7) caja principal, traspasos y consolidado ----------
    ir('#/cajas-tr')
    chk(p.locator('h1', has_text='Cajas y traspasos').count() == 1 and p.locator('#nav a', has_text='Cajas y traspasos').count() == 1, 'pantalla y menú «Cajas y traspasos»')
    p.click('[data-act=cp-abrir]'); p.wait_for_timeout(200); p.fill('#fCP [name=ini]', '0'); submit('fCP')
    cp = ev("CM.cajaPrincipal() && CM.cajaPrincipal().id")
    chk(cp == 'CJ-P-00001', 'caja principal abierta: %s' % cp)
    chk(ev("CM.cajaAbierta().id") == ab, 'la caja del equipo sigue siendo la misma (la principal no la reemplaza)')
    ing0 = ev("CM.totCaja(CM.cajaAbierta()).ingresos"); espA = ev("CM.totCaja(CM.cajaAbierta()).esperadoEf")
    ev("CM.acts['tr-nuevo']({getAttribute:()=>%s})" % json.dumps(ab)); p.wait_for_timeout(200)
    p.select_option('#fTR [name=a]', cp); p.fill('#fTR [name=importe]', '999999999'); p.fill('#fTR [name=motivo]', 'retiro del día'); submit('fTR')
    chk('no alcanza' in err(), 'traspaso mayor al efectivo esperado: no se permite')
    p.fill('#fTR [name=importe]', '20.000'); submit('fTR')
    tr = ev("CM.db.ctransf[CM.db.ctransf.length-1]")
    chk(tr['de'] == ab and tr['a'] == cp and tr['cent'] == 2000000, 'traspaso registrado de la caja del equipo a la principal')
    t1 = ev("[CM.totCaja(CM.cajaAbierta()).ingresos, CM.totCaja(CM.cajaAbierta()).esperadoEf, CM.totCaja(CM.cajaPrincipal()).ingresos, CM.totCaja(CM.cajaPrincipal()).esperadoEf]")
    chk(t1 == [ing0, espA - 2000000, 0, 2000000], 'sin doble conteo: no cambia ingresos, sólo el efectivo esperado de cada caja: %s' % t1)
    chk(p.locator('tr.tot', has_text='Total de cajas abiertas').count() == 1, 'consolidado con total de cajas abiertas')
    p.click('[data-act=tr-revertir][data-id="%s"]' % tr['id']); p.wait_for_timeout(200); p.fill('#fTRR [name=motivo]', 'era otro importe'); submit('fTRR')
    t2 = ev("[CM.totCaja(CM.cajaAbierta()).esperadoEf, CM.totCaja(CM.cajaPrincipal()).esperadoEf, CM.db.ctransf.length]")
    chk(t2[0] == espA and t2[1] == 0 and t2[2] == 2, 'revertir = traspaso inverso vinculado (el original no se borra): %s' % t2)
    chk(p.locator('.pill', has_text='Revertido').count() == 1, 'el original figura como «Revertido»')
    ev("CM.acts['tr-nuevo']({getAttribute:()=>%s})" % json.dumps(ab)); p.wait_for_timeout(200)
    p.select_option('#fTR [name=a]', cp); p.fill('#fTR [name=importe]', '10000'); p.fill('#fTR [name=motivo]', 'retiro del día'); submit('fTR')
    p.click('[data-act=cp-mov][data-tipo=egreso]'); p.wait_for_timeout(200); p.select_option('#fCPM [name=rubro]', 'R-08'); p.fill('#fCPM [name=importe]', '2.500'); p.fill('#fCPM [name=motivo]', 'pago de alquiler'); submit('fCPM')
    chk(ev("CM.totCaja(CM.cajaPrincipal()).esperadoEf") == 750000, 'egreso en la caja principal: esperado $ 7.500')

    # ---------- 8) corte X ----------
    ir('#/caja')
    for k in ['Corte X', 'Traspaso', 'Abrir cajón']:
        chk(p.locator('main button', has_text=k).count() >= 1, 'botón «%s» en Caja' % k)
    p.click('main [data-act=cx-corte]'); p.wait_for_timeout(250)
    x = ev("CM.db.cortesx[CM.db.cortesx.length-1]")
    chk(x['caja'] == ab and x['esperadoEf'] == ev("CM.totCaja(CM.cajaAbierta()).esperadoEf") and x['n'].startswith('X-'), 'corte X guardado con el efectivo esperado: %s' % x['n'])
    chk('CORTE X' in txt('#modalRoot pre') and 'Cambio entregado' in txt('#modalRoot pre'), 'el corte X muestra el cambio entregado')
    chk(ev("CM.cajaAbierta() && CM.cajaAbierta().id") == ab, 'el corte X no cierra la caja')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)
    chk(p.locator('h2', has_text='Cortes X de esta caja').count() == 1, 'lista de cortes X de la caja')

    # ---------- 9) cierre con número Z dentro del sello ----------
    ir('#/cierre')
    chk(p.locator('small', has_text='Se cierra como').count() == 1 and p.locator('small', has_text='Cambio entregado').count() == 1, 'arqueo: muestra el cambio entregado y el número Z')
    esp = ev("CM.totCaja(CM.cajaAbierta()).esperadoEf")
    p.fill('#arTot', str(esp / 100).replace('.', ',')); p.click('form[data-form=cierre] button[type=submit]'); p.wait_for_timeout(250)
    p.click('#modalRoot [data-act=cierre-ok]'); p.wait_for_timeout(400)
    c = ev("CM.db.cajas.find(x=>x.id===%s).cierre" % json.dumps(ab))
    chk(c['z'].startswith('Z-') and c['trOut'] == 3000000 and c['trIn'] == 2000000 and c['dif'] == 0, 'cierre con número %s y traspasos guardados: %s' % (c['z'], {k: c.get(k) for k in ['trIn','trOut','dif','esperadoEf','declaradoEf']}))
    chk(ev("CM.verificarCierre(CM.db.cajas.find(x=>x.id===%s).cierre)" % json.dumps(ab)), 'el sello del cierre nuevo es íntegro')
    chk(ev("(()=>{const c=CM.db.cajas.find(x=>x.id===%s).cierre;const z=c.z;c.z='Z-9-99';const r=CM.verificarCierre(c);c.z=z;return r;})()" % json.dumps(ab)) is False, 'cambiar el número Z rompe el sello')
    chk(ev("CM.totCaja(CM.db.cajas.find(x=>x.id===%s)).esperadoEf" % json.dumps(ab)) == esp, 'la caja cerrada recalcula igual desde su foto (con cambio y traspasos)')
    chk(p.locator('#modalRoot', has_text=c['z']).count() >= 1, 'el detalle del cierre muestra el número Z')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)
    chk(ev("CM.cajaPrincipal() && CM.cajaPrincipal().id") == cp, 'cerrar la caja del equipo no cierra la principal')
    ir('#/cajas-tr'); p.click('[data-act=cp-cerrar]'); p.wait_for_timeout(200); p.fill('#fCPC [name=tot]', '7.500'); submit('fCPC')
    cpc = ev("CM.db.cajas.find(x=>x.id==='CJ-P-00001').cierre")
    chk(cpc and cpc['z'] == 'Z-P-1' and cpc['principal'] and cpc['dif'] == 0 and ev("CM.verificarCierre(CM.db.cajas.find(x=>x.id==='CJ-P-00001').cierre)"), 'caja principal cerrada y sellada como Z-P-1')
    ir('#/caja')
    chk(p.locator('[data-act=caja-abrir]').count() == 1, 'después del cierre se puede abrir una caja nueva')
    p.click('[data-act=caja-abrir]'); p.wait_for_timeout(200); p.fill('#fCA [name=ini]', '1000'); submit('fCA')
    chk(ev("CM.cajaAbierta() && !CM.cajaAbierta().principal && CM.cajaAbierta().id!==%s" % json.dumps(ab)), 'caja nueva abierta (no es la principal)')

    # ---------- 10) impresora térmica: tarjeta y ajustes ----------
    ir('#/perifericos')
    chk(p.locator('h2', has_text='Impresora térmica directa').count() == 1, 'Periféricos: tarjeta de impresora térmica, corte y cajón')
    p.select_option('#tkCard [name=ancho]', '58'); p.select_option('#tkCard [name=corte]', 'total'); p.select_option('#tkCard [name=cajon]', 'no'); p.click('#tkCard button[type=submit]'); p.wait_for_timeout(200)
    chk(ev("JSON.stringify(CM.tkCfg())") == json.dumps({'ancho': 58, 'corte': 'total', 'cajon': 'no', 'pin': 2}, separators=(',', ':')), 'ajustes del ticket guardados: %s' % ev("JSON.stringify(CM.tkCfg())"))
    bts = ev("Array.from(CM.escposTexto('Ñandú ¿sí?'))")
    chk(bts[:5] == [0x1b, 0x40, 0x1b, 0x74, 2] and 0xA5 in bts and 0xA3 in bts and bts[-3:] == [0x1d, 0x56, 0x41][-3:] or bts[-4:-1] == [0x1d, 0x56, 0x41], 'ESC/POS: página PC850 con Ñ y ú, corte total al final')
    chk(ev("CM.tkConectada()") is False, 'sin impresora conectada se usa la impresión del navegador')

    # ---------- 11) regresiones y consola ----------
    for h in ['#/caja', '#/cierre', '#/cajas-cerradas', '#/dashboard', '#/aportes', '#/dispensaciones', '#/trazabilidad', '#/cajas-tr', '#/perifericos']:
        ir(h); chk(p.locator('main h1').count() >= 1, 'abre ' + h)
    chk(ev("CM.db.cajas.filter(c=>c.cierre).every(c=>CM.verificarCierre(c.cierre))"), 'todos los cierres (viejos y nuevos) íntegros')
    chk(not errs, 'consola sin errores %s' % errs[:3])
    b.close()
print('%d ok, %d fallas' % (oks[0], len(fallas)))
if fallas: print('FALLAS:', fallas); raise SystemExit(1)
