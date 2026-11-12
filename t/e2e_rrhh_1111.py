"""Etapa 3 · 2026-11-11 (Chromium real, modo local con datos FICTICIOS).
Recursos humanos: legajo (datos, jornada, privados, documentos), PIN y kiosco con bloqueo, NFC vinculado por número,
QR firmado con secreto, tardanzas/ausencias/horas extra, pedidos con 2 niveles de aprobación, saldo de vacaciones,
adelantos, liquidación interna cerrada con versión, portal, geocerca y permisos (los operadores no ven lo privado).
Uso: python3 t/e2e_rrhh_1111.py   (PAGINA=index.html para el paquete publicado)"""
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
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, geolocation={'latitude': -24.7859, 'longitude': -65.4116}, permissions=['geolocation'])
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.route('**/*supabase.co/**', lambda r: r.abort())
    p.goto(U); p.wait_for_timeout(700)
    ev = p.evaluate
    def como(rol, nombre):
        ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol=%s;u.nombre=%s;CM.ses.set(u.id);CM.db.cfg.rol=%s;CM.db.cfg.operador=%s;})()" % (json.dumps(rol), json.dumps(nombre), json.dumps(rol), json.dumps(nombre)))
    como('admin', 'Administración (ejemplo)')
    def ir(h): p.goto(U + '#/inicio'); p.wait_for_timeout(80); p.goto(U + h); p.wait_for_timeout(300)
    def submit(fid): p.click('#modalRoot button[type=submit][form=%s]' % fid); p.wait_for_timeout(300)
    def err(): return p.locator('#modalRoot [data-err]').first.inner_text() if p.locator('#modalRoot [data-err]').count() else ''
    def tab(v): ev("CM.per.tab=%s;CM.render()" % json.dumps(v)); p.wait_for_timeout(200)

    chk(ev("CM.MODS.some(m=>m[0]==='rrhh')") and ev("CM.permsDefault().supervisor.rrhh") == 'edit' and not ev("CM.permsDefault().operador.rrhh"), 'permiso nuevo «Recursos humanos»: supervisión edita, operador sin acceso')
    ir('#/personal')
    for t in ['Terminal de fichaje', 'Legajos', 'Planilla de horas', 'Calendario', 'Vacaciones y pedidos', 'Liquidación', 'Mi portal', 'Ajustes de RR. HH.']:
        chk(p.locator('main .tabs button', has_text=t).count() == 1, 'pestaña «%s»' % t)
    chk(p.locator('text=Los datos del personal son ficticios').count() == 0, 'ya no dice que los datos del personal son ficticios')

    # ---------- alta y legajo ----------
    tab('equipo'); p.click('[data-act=emp-nuevo]'); p.wait_for_timeout(200)
    p.fill('#fEM [name=nombre]', 'Laura Prueba'); p.fill('#fEM [name=dni]', '30111222'); p.fill('#fEM [name=cargo]', 'Cultivadora'); submit('fEM')
    e1 = ev("CM.db.staff.find(x=>x.dni==='30111222').id")
    p.click('#modalRoot [data-act=modal-close]') if p.locator('#modalRoot [data-act=modal-close]').count() else None
    p.click('[data-act=rh-legajo][data-id="%s"]' % e1); p.wait_for_timeout(250)
    p.fill('#fRL [name=correo]', 'laura@ejemplo.org'); p.fill('#fRL [name=ingreso]', '2019-03-01'); p.select_option('#fRL [name=modalidad]', 'Relación de dependencia')
    p.fill('#fRL [name=ent]', '09:00'); p.fill('#fRL [name=sal]', '08:00'); submit('fRL')
    chk('salida' in err().lower(), 'valida que la salida sea después de la entrada')
    p.fill('#fRL [name=sal]', '17:00'); p.fill('#fRL [name=cuil]', '27301112223'); p.select_option('#fRL [name=rtipo]', 'mensual'); p.fill('#fRL [name=rmonto]', '600.000'); submit('fRL')
    e = ev("CM.db.staff.find(x=>x.id===%s)" % json.dumps(e1)); pv = ev("CM.db.rhpriv.find(x=>x.id===%s)" % json.dumps(e1))
    chk(e['correo'] == 'laura@ejemplo.org' and e['hor']['ent'] == '09:00' and e['hor']['dias'] == [1, 2, 3, 4, 5] and e['ingreso'] == '2019-03-01', 'legajo: correo, ingreso y jornada guardados en la ficha')
    chk(pv['cuil'] == '27301112223' and pv['remun'] == {'tipo': 'mensual', 'monto': 60000000}, 'CUIL y remuneración van aparte (privados)')
    chk('cuil' not in e and 'remun' not in e, 'la ficha visible del personal no lleva datos privados')
    chk(ev("CM.rhVacSaldo(CM.db.staff.find(x=>x.id===%s)).anual" % json.dumps(e1)) == 21, 'vacaciones por antigüedad (más de 5 años → 21 días)')
    # documento con vencimiento → aviso
    p.click('[data-act=rh-legajo][data-id="%s"]' % e1); p.wait_for_timeout(200); p.click('#modalRoot [data-act=rh-doc]'); p.wait_for_timeout(200)
    p.fill('#fRD [name=tipo]', 'Apto médico'); p.fill('#fRD [name=url]', 'https://ejemplo.com/x'); submit('fRD')
    chk('drive' in err().lower(), 'el documento sólo acepta enlaces de Google Drive')
    venc = ev("CM.addDays(CM.hoy(),10)")
    p.fill('#fRD [name=url]', 'https://drive.google.com/file/d/abc/view'); p.fill('#fRD [name=vence]', venc); submit('fRD')
    chk(ev("CM.db.rhpriv.find(x=>x.id===%s).docs.length" % json.dumps(e1)) == 1, 'documento agregado al legajo privado')
    p.click('#modalRoot [data-act=modal-close]'); tab('terminal')
    chk(p.locator('.note.warn', has_text='Apto médico').count() == 1, 'aviso de documento por vencer en la terminal')

    # ---------- PIN y kiosco ----------
    tab('equipo'); p.click('[data-act=rh-legajo][data-id="%s"]' % e1); p.wait_for_timeout(200); p.click('#modalRoot [data-act=rh-pin]'); p.wait_for_timeout(200)
    p.fill('#fRP [name=pin]', '1234'); p.fill('#fRP [name=pin2]', '1234'); submit('fRP')
    chk('obvio' in err(), 'rechaza un PIN consecutivo')
    p.fill('#fRP [name=pin]', '4827'); p.fill('#fRP [name=pin2]', '4827'); submit('fRP')
    ph = ev("CM.db.staff.find(x=>x.id===%s).pinH" % json.dumps(e1))
    chk(bool(ph) and '4827' not in ph, 'el PIN se guarda sólo como hash')
    ir('#/kiosco')
    def teclas(s):
        for k in s: p.click('[data-act=kio-k][data-k="%s"]' % k); p.wait_for_timeout(30)
    teclas('30111222'); p.click('[data-act=kio-k][data-k=ok]'); teclas('9999'); p.click('[data-act=kio-k][data-k=ok]'); p.wait_for_timeout(150)
    chk(p.locator('.kiosco .note.bad', has_text='incorrectos').count() == 1, 'kiosco: PIN incorrecto rechazado')
    n0 = ev("CM.db.fichas.length")
    teclas('30111222'); p.click('[data-act=kio-k][data-k=ok]'); teclas('4827'); p.click('[data-act=kio-k][data-k=ok]'); p.wait_for_timeout(150)
    chk(ev("CM.db.fichas.length") == n0 + 1 and ev("CM.db.fichas[CM.db.fichas.length-1].metodo") == 'PIN (kiosco)', 'kiosco: DNI + PIN correcto registra la fichada')
    chk(p.locator('.kiosco .note.ok', has_text='Laura Prueba').count() == 1, 'kiosco: confirma con el nombre')
    for i in range(5): teclas('30111222'); p.click('[data-act=kio-k][data-k=ok]'); teclas('1111'); p.click('[data-act=kio-k][data-k=ok]')
    teclas('30111222'); p.click('[data-act=kio-k][data-k=ok]'); teclas('4827'); p.click('[data-act=kio-k][data-k=ok]'); p.wait_for_timeout(100)
    chk(p.locator('.kiosco .note.bad', has_text='Demasiados intentos').count() == 1, 'kiosco: 5 intentos fallidos bloquean aunque después pongan bien el PIN')

    # ---------- NFC por número y QR firmado ----------
    ir('#/personal'); tab('equipo'); p.click('[data-act=rh-legajo][data-id="%s"]' % e1); p.wait_for_timeout(200); p.click('#modalRoot [data-act=rh-nfc]'); p.wait_for_timeout(200)
    p.fill('#fRN [name=nfc]', '30111222'); submit('fRN'); chk('dni' in err().lower(), 'un DNI no se acepta como número de tarjeta')
    p.fill('#fRN [name=nfc]', '04:A2:5B:1C:9F'); submit('fRN')
    chk(ev("CM.db.staff.find(x=>x.id===%s).nfc" % json.dumps(e1)) == '04A25B1C9F', 'tarjeta NFC vinculada por su número')
    ev("CM.db.fichas=CM.db.fichas.filter(x=>x.emp!==%s);CM.save()" % json.dumps(e1))
    r = ev("(()=>{const r=CM.fichar('04a25b1c9f','Lector USB');return r.err||r.ok.metodo+'|'+r.emp.id})()")
    chk(r == 'Tarjeta NFC|' + e1, 'fichar con el número de la tarjeta (lector USB) identifica a la persona: %s' % r)
    tok_demo = ev("'EMP-'+%s+'-'+CM.sha256('cm-demo-firma|'+%s).slice(0,8)" % (json.dumps(e1), json.dumps(e1)))
    tab('rhcfg'); p.click('[data-act=rh-sec]'); p.wait_for_timeout(200)
    chk(bool(ev("CM.rhCfg().sec")) and not ev("CM.db.staff.find(x=>x.id===%s).pinH" % json.dumps(e1)), 'secreto de carnets generado; los PIN se borran para reasignarlos')
    ev("CM.db.fichas=CM.db.fichas.filter(x=>x.emp!==%s);CM.save()" % json.dumps(e1))
    r2 = ev("(()=>{const r=CM.fichar(%s,'QR');return r.err||'ok'})()" % json.dumps(tok_demo))
    chk('Firma inválida' in r2, 'un QR con la firma de la demo deja de valer')
    r3 = ev("(()=>{const r=CM.fichar(CM.tokenEmp(CM.db.staff.find(x=>x.id===%s)),'QR');return r.err||r.ok.metodo})()" % json.dumps(e1))
    chk(r3 == 'QR', 'el carnet nuevo (firmado con el secreto) ficha bien')

    # ---------- jornada: tardanza, horas extra y ausencias ----------
    res = ev("""(()=>{const e=CM.db.staff.find(x=>x.id===%s);CM.db.fichas=CM.db.fichas.filter(x=>x.emp!==e.id);
      const d=CM.addDays(CM.hoy(),-7);const wd=new Date(d+'T12:00:00Z').getUTCDay();
      const ts=(h)=>new Date(d+'T'+h+':00-03:00').toISOString();
      CM.db.fichas.push({id:'FI-T1',emp:e.id,fecha:d,ts:ts('09:25'),tipo:'entrada',metodo:'test'},{id:'FI-T2',emp:e.id,fecha:d,ts:ts('19:30'),tipo:'salida',metodo:'test'});
      const r=CM.rhDia(e,d);return [wd,r.tarde,r.extra,r.trab];})()""" % json.dumps(e1))
    if res[0] in (1, 2, 3, 4, 5):
        chk(res[1] == 25 and res[2] == 10 * 60 + 5 - 480 and res[3] == 605, 'tardanza de 25 min (tolerancia 10) y horas extra sobre 8 h: %s' % res)
    else:
        chk(res[1] == 0 and res[2] == res[3], 'en un día no laborable todo cuenta como extra y no hay tardanza: %s' % res)
    aus = ev("(()=>{const e=CM.db.staff.find(x=>x.id===%s);const d=CM.addDays(CM.hoy(),-14);const wd=new Date(d+'T12:00:00Z').getUTCDay();return [wd>=1&&wd<=5, CM.rhDia(e,d).ausente];})()" % json.dumps(e1))
    chk(aus[0] == aus[1], 'un día laborable sin fichadas ni pedido cuenta como ausencia: %s' % aus)

    # ---------- pedidos con 2 niveles ----------
    tab('rhcfg'); p.select_option('form[data-form=rh-cfg] [name=niveles]', '2'); p.fill('form[data-form=rh-cfg] [name=dn0]', 'Aporte jubilatorio'); p.fill('form[data-form=rh-cfg] [name=dp0]', '11')
    p.fill('form[data-form=rh-cfg] [name=feriados]', '2026-12-08\n2026-12-25'); p.check('form[data-form=rh-cfg] [name=geoOn]')
    p.fill('form[data-form=rh-cfg] [name=lat]', '-24.7859'); p.fill('form[data-form=rh-cfg] [name=lng]', '-65.4116'); p.fill('form[data-form=rh-cfg] [name=radio]', '150')
    p.click('form[data-form=rh-cfg] button[type=submit]'); p.wait_for_timeout(200)
    c = ev("CM.rhCfg()")
    chk(c['niveles'] == 2 and c['deducciones'] == [{'n': 'Aporte jubilatorio', 'pct': 11}] and c['feriados'] == ['2026-12-08', '2026-12-25'] and c['geo']['on'], 'ajustes de RR. HH. guardados')
    tab('pedidos'); p.click('[data-act=rh-ped-nuevo]'); p.wait_for_timeout(200)
    y = ev("CM.hoy().slice(0,4)")
    p.select_option('#fRS [name=emp]', e1); p.select_option('#fRS [name=tipo]', 'vacaciones'); p.fill('#fRS [name=desde]', y + '-12-01'); p.fill('#fRS [name=hasta]', y + '-12-31'); submit('fRS')
    chk('le quedan 21' in err(), 'no deja pedir más vacaciones que el saldo: %s' % err())
    p.fill('#fRS [name=hasta]', y + '-12-10'); submit('fRS')
    ped = ev("CM.db.rhsol[CM.db.rhsol.length-1]")
    chk(ped['estado'] == 'pendiente' and ev("CM.rhVacSaldo(CM.db.staff.find(x=>x.id===%s)).pendientes" % json.dumps(e1)) == 10, 'pedido de 10 días de vacaciones pendiente')
    p.click('[data-act=rh-ped-dec][data-id="%s"][data-d=aprobado]' % ped['id']); p.wait_for_timeout(200); submit('fRDc')
    chk(ev("CM.db.rhsol.find(x=>x.id===%s).estado" % json.dumps(ped['id'])) == 'pendiente-2', 'primer nivel aprobado → falta el segundo')
    chk(p.locator('[data-act=rh-ped-dec][data-id="%s"]' % ped['id']).count() == 0, 'quien aprobó el primer nivel no puede aprobar el segundo')
    como('admin', 'Directora (ejemplo)'); tab('pedidos')
    p.click('[data-act=rh-ped-dec][data-id="%s"][data-d=aprobado]' % ped['id']); p.wait_for_timeout(200); submit('fRDc')
    chk(ev("CM.db.rhsol.find(x=>x.id===%s).estado" % json.dumps(ped['id'])) == 'aprobado' and ev("CM.rhVacSaldo(CM.db.staff.find(x=>x.id===%s)).saldo" % json.dumps(e1)) == 11, 'aprobado en 2 niveles: el saldo baja a 11 días')
    chk(ev("CM.rhDia(CM.db.staff.find(x=>x.id===%s), %s).ausente" % (json.dumps(e1), json.dumps(y + '-12-03'))) is False, 'un día de vacaciones aprobadas no es ausencia')
    p.click('[data-act=rh-ped-nuevo]'); p.wait_for_timeout(200)
    p.select_option('#fRS [name=emp]', e1); p.select_option('#fRS [name=tipo]', 'permiso'); p.fill('#fRS [name=desde]', y + '-12-05'); submit('fRS')
    chk('Ya hay un pedido' in err(), 'no se superponen pedidos en las mismas fechas')
    p.select_option('#fRS [name=tipo]', 'adelanto'); p.wait_for_timeout(80); p.fill('#fRS [name=desde]', ev("CM.hoy()")); p.fill('#fRS [name=monto]', '50.000'); submit('fRS')
    ad = ev("CM.db.rhsol[CM.db.rhsol.length-1]")
    for nombre in ['Supervisión (ejemplo)', 'Directora (ejemplo)']:
        como('admin', nombre); tab('pedidos'); p.click('[data-act=rh-ped-dec][data-id="%s"][data-d=aprobado]' % ad['id']); p.wait_for_timeout(200); submit('fRDc')
    chk(ev("CM.db.rhsol.find(x=>x.id===%s).estado" % json.dumps(ad['id'])) == 'aprobado', 'adelanto de $ 50.000 aprobado')
    ir('#/personal'); tab('calendario')
    chk(p.locator('.cal-d small', has_text='Feriado').count() >= 0 and p.locator('h2', has_text=ev("['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][+CM.hoy().slice(5,7)-1]")).count() == 1, 'calendario del mes')
    p.click('[data-act=rh-mes]:last-of-type'); p.wait_for_timeout(150)
    if ev("CM.hoy().slice(5,7)") == '11':
        chk(p.locator('.cal-aus', has_text='Vacaciones').count() == 10 and p.locator('.cal-d small', has_text='Feriado').count() == 2, 'diciembre: 10 días de vacaciones y 2 feriados en el calendario')

    # ---------- liquidación ----------
    tab('liq')
    l = ev("CM.rhLiquidar(CM.db.staff.find(x=>x.id===%s), CM.mesActual())" % json.dumps(e1))
    chk(l['adelantos'] == 5000000 and any('Aporte jubilatorio' in d[0] for d in l['deducciones']) and l['neto'] == l['bruto'] - round(l['bruto'] * 0.11) - 5000000, 'liquidación: bruto, 11 %% de deducción y adelanto descontado (neto %s)' % l['neto'])
    p.click('[data-act=rh-liq-ver][data-id="%s"]' % e1); p.wait_for_timeout(200)
    chk(p.locator('#modalRoot', has_text='Neto a pagar').count() == 1, 'detalle de la liquidación')
    p.fill('#fRLq [name=ajuste]', '-1000'); submit('fRLq')
    lq = ev("CM.db.rhliq[CM.db.rhliq.length-1]")
    chk(lq['v'] == 1 and lq['ajuste'] == -100000 and bool(lq['hash']), 'liquidación cerrada (v1) con ajuste y sello')
    p.click('[data-act=rh-liq-ver][data-id="%s"]' % e1); p.wait_for_timeout(200); submit('fRLq')
    chk('motivo' in err(), 'una nueva versión pide motivo')
    p.fill('#fRLq [name=nota]', 'faltaba un ajuste'); submit('fRLq')
    chk(ev("CM.db.rhliq.filter(x=>x.emp===%s).map(x=>x.v)" % json.dumps(e1)) == [1, 2], 'la corrección es una versión nueva (la v1 no se borra)')
    chk(p.locator('.pill', has_text='Cerrada v2').count() == 1, 'la tabla muestra «Cerrada v2»')

    # ---------- portal y geocerca ----------
    como('admin', 'Laura Prueba')
    tab('portal')
    chk(p.locator('.kpi .l', has_text='Vacaciones').count() == 1 and p.locator('[data-act=rh-geo-fichar]').count() == 1, 'Mi portal: horas, vacaciones, pedidos y fichar desde el celular')
    ev("CM.db.fichas=CM.db.fichas.filter(x=>x.emp!==%s);CM.save()" % json.dumps(e1))
    p.click('[data-act=rh-geo-fichar]'); p.wait_for_timeout(800)
    fl = ev("CM.db.fichas.filter(x=>x.emp===%s).pop()" % json.dumps(e1))
    chk(fl and fl['metodo'] == 'Celular con ubicación' and fl['dist'] <= 5 and 'lat' not in fl, 'fichada desde el celular dentro de la zona (se guarda la distancia, no las coordenadas)')
    ctx.set_geolocation({'latitude': -24.80, 'longitude': -65.43})
    ev("CM.db.fichas=CM.db.fichas.filter(x=>x.emp!==%s);CM.save()" % json.dumps(e1))
    p.click('[data-act=rh-geo-fichar]'); p.wait_for_timeout(800)
    chk(ev("CM.db.fichas.filter(x=>x.emp===%s).length" % json.dumps(e1)) == 0 and ev("CM.db.audit.some(a=>a.accion==='Fichada rechazada (fuera de la zona)')"), 'fuera de la zona no ficha y queda en la auditoría')
    chk(p.locator('[data-act=rh-ped-dec]').count() == 0, 'en su portal no puede aprobar sus propios pedidos')

    # ---------- permisos: operador ----------
    como('operador', 'Operador (ejemplo)'); ir('#/personal')
    chk(p.locator('main .tabs button', has_text='Liquidación').count() == 0 and p.locator('main .tabs button', has_text='Ajustes de RR. HH.').count() == 0, 'el operador no ve Liquidación ni Ajustes de RR. HH.')
    tab('equipo'); p.click('[data-act=rh-legajo][data-id="%s"]' % e1); p.wait_for_timeout(200)
    chk(p.locator('#fRL [name=cuil]').count() == 0 and p.locator('#modalRoot', has_text='Documentos del legajo').count() == 0, 'el operador no ve CUIL, remuneración ni documentos')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(100)
    tab('liq'); chk(p.locator('h2', has_text='Liquidación interna').count() == 0, 'forzar la pestaña de liquidación no la muestra')

    como('admin', 'Administración (ejemplo)')
    for h in ['#/personal', '#/kiosco', '#/inicio', '#/usuarios']:
        ir(h); chk(p.locator('main h1').count() >= 1, 'abre ' + h)
    chk(not errs, 'consola sin errores %s' % errs[:3])
    b.close()
print('%d ok, %d fallas' % (oks[0], len(fallas)))
if fallas: print('FALLAS:', fallas); raise SystemExit(1)
