"""2026-11-12 (Chromium real, modo local con datos FICTICIOS).
· Ficha: «Documentos y escaneos» al final.  · Dispensa con varios productos (5+1 por producto, una sola donación).
· REPROCANN desde los documentos del legajo (fecha del nombre, «a verificar», «falta fecha») y acceso a la carpeta.
Uso: python3 t/e2e_rep_disp_1112.py   (PAGINA=index.html para el paquete publicado)"""
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
    ctx = b.new_context(viewport={'width': 1366, 'height': 900})
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.route('**/*supabase.co/**', lambda r: r.abort())
    p.goto(U); p.wait_for_timeout(700)
    ev = p.evaluate
    ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';CM.db.cfg.operador=u.nombre;})()")
    def ir(h): p.goto(U + '#/inicio'); p.wait_for_timeout(80); p.goto(U + h); p.wait_for_timeout(350)
    def submit(fid): p.click('#modalRoot button[type=submit][form=%s]' % fid); p.wait_for_timeout(300)
    def err(): return p.locator('#modalRoot [data-err]').first.inner_text() if p.locator('#modalRoot [data-err]').count() else ''
    def val(sel): return p.input_value(sel)
    def txt(sel): return p.locator(sel).first.inner_text()

    # ---------- 1) fechas desde el nombre ----------
    casos = [('Reprocann activo 2029/03', '2029-03-31'), ('repro barto credencial enero 2027', '2027-01-31'), ('activo 2029', '2029-12-31'),
             ('Reprocann 29', '2029-12-31'), ('Activo ✅ 2028', '2028-12-31'), ('vence 15/08/2027', '2027-08-15'), ('REPROCANN 03/2028', '2028-03-31'),
             ('credencial sept. 2027', '2027-09-30'), ('Reprocann', None), ('DNI frente', None), ('reprocann 1999', None)]
    for n, esp in casos:
        r = ev("(CM.repFechaDeNombre(%s)||{}).vence||null" % json.dumps(n))
        chk(r == esp, 'fecha de «%s» → %s (%s)' % (n, esp, r))
    chk(ev("CM.repFechaDeNombre('activo 2025','2026-03-01')") is None, 'una fecha anterior a la del documento no se toma como vencimiento')

    # ---------- 2) preparar pacientes ficticios con documentos ----------
    ks = ev("Object.keys(CM.db.pacientes)")
    A, B, C, D = ks[0], ks[1], ks[2], ks[3]
    ev("""(()=>{const P=CM.db.pacientes; [%s,%s,%s].forEach(k=>{P[k].reprocann={estado:'sin',vence:null,carnet:false};});
      P[%s].reprocann={estado:'valido',vence:'2030-01-31',carnet:true};
      P[%s].drive1='https://drive.google.com/drive/folders/CARPETA_A';
      CM.db.legDocs=(CM.db.legDocs||[]).filter(d=>[%s,%s,%s,%s].indexOf(d.dni)<0);
      const add=(dni,n,ts,x)=>CM.db.legDocs.push(Object.assign({id:'DOC-T'+CM.db.legDocs.length,dni:dni,nombre:n,tipo:'REPROCANN',ts:ts,estado:'subido',driveFileId:'F'+CM.db.legDocs.length},x||{}));
      add(%s,'Reprocann activo 2029/03','2025-05-02T12:00:00Z'); add(%s,'reprocann viejo 2026','2024-01-02T12:00:00Z');
      add(%s,'Reprocann','2025-07-02T12:00:00Z');
      add(%s,'Consentimiento','2025-07-02T12:00:00Z',{tipo:'Consentimiento informado'});
      add(%s,'activo 2031','2025-07-02T12:00:00Z');
      CM.save();})()""" % tuple(json.dumps(x) for x in (A, B, C, D, A, A, B, C, D, A, A, B, C, D)))
    plan = ev("CM.repDocsPlan().map(x=>[x.dni,x.vence,x.prec])")
    chk([A, '2029-03-31', 'mes'] in plan and [B, None, ''] in plan, 'plan: A con fecha del nombre (la más nueva), B sin fecha: %s' % plan)
    chk(all(x[0] != C for x in plan), 'C sólo tiene consentimiento: no entra')
    chk(all(x[0] != D for x in plan), 'D ya tiene REPROCANN vigente: no se toca')

    # ---------- 3) herramienta en la pantalla REPROCANN ----------
    ir('#/reprocann')
    chk(p.locator('button[data-act=rep-docs]').count() == 1, 'REPROCANN: aparece «Completar desde los documentos»')
    p.click('button[data-act=rep-docs]'); p.wait_for_timeout(250)
    chk(p.locator('#modalRoot tbody tr').count() == len(plan) and p.locator('#modalRoot', has_text='Falta fecha').count() == 1, 'vista previa con la lista antes de aplicar')
    chk(p.locator('#modalRoot a[href*="drive.google.com/file/d/"]').count() >= 1, 'cada documento se puede abrir desde la vista previa')
    p.click('#modalRoot [data-act=rep-docs-ok]'); p.wait_for_timeout(300)
    ra, rb = ev("CM.db.pacientes[%s].reprocann" % json.dumps(A)), ev("CM.db.pacientes[%s].reprocann" % json.dumps(B))
    chk(ra['estado'] == 'valido' and ra['vence'] == '2029-03-31' and ra['aVerif'] is True, 'A: Válido hasta 31/03/2029, «a verificar»: %s' % ra)
    chk(rb['estado'] == 'valido' and rb['vence'] is None and rb['aVerif'] is True, 'B: Válido sin fecha: %s' % rb)
    chk(ev("CM.db.pacientes[%s].repHist.length" % json.dumps(A)) == 1, 'queda el historial del paciente')
    chk(ev("CM.db.audit.some(a=>a.accion==='REPROCANN completado desde documentos')"), 'queda en la auditoría')
    chk(ev("CM.db.pacientes[%s].reprocann.estado" % json.dumps(D)) == 'valido' and ev("CM.db.pacientes[%s].reprocann.vence" % json.dumps(D)) == '2030-01-31', 'D no se modificó')
    chk(ev("CM.repDocsPlan().length") == 0, 'aplicar dos veces no hace nada: la herramienta ya no tiene pendientes')
    chk(p.locator('.pill', has_text='falta fecha').count() >= 1 and p.locator('.pill', has_text='a verificar').count() >= 1, 'la lista muestra «falta fecha» y «a verificar»')
    chk(ev("CM.reglasDispensar(CM.db.pacientes[%s]).msgs.some(m=>/falta la fecha/.test(m.m))" % json.dumps(B)), 'al dispensar avisa que falta la fecha')

    # ---------- 4) ficha: carpeta al final, tarjeta REPROCANN con documentos ----------
    ir('#/paciente/' + A)
    orden = ev("(()=>{const m=document.getElementById('main'); const d=m.querySelector('#pacDocs'); const secs=[...m.querySelectorAll('section.card')].filter(s=>!d.contains(s)); return d && m.lastElementChild===d && d.textContent.includes('Documentos y escaneos') && secs.every(s=>s.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING)})()")
    chk(bool(orden), 'la carpeta del legajo y los documentos quedan al final de la ficha')
    tarj = p.locator('section.card', has_text='REPROCANN del paciente').first
    chk(tarj.locator('.rep-docs').count() == 1 and tarj.locator('a[href*="CARPETA_A"]').count() == 1, 'tarjeta REPROCANN: documentos y «Abrir carpeta del legajo»')
    chk(tarj.locator('a[href*="drive.google.com/file/d/"]').count() == 2, 'tarjeta REPROCANN: los dos documentos con «Abrir»')
    chk(tarj.locator('.note.warn', has_text='verificala').count() == 1, 'tarjeta REPROCANN: aviso para verificar la fecha')
    tarj.locator('[data-act=rep-edit]').first.click(); p.wait_for_timeout(250)
    chk(p.locator('#fRP .rep-docs').count() == 1 and p.locator('#fRP a[href*="CARPETA_A"]').count() == 1, 'formulario REPROCANN: acceso a la carpeta de documentos')
    chk(p.locator('#fRP [data-act=rep-usar-fecha]').count() == 2, 'formulario REPROCANN: «Usar esta fecha» por documento con fecha')
    p.locator('#fRP [data-act=rep-usar-fecha][data-v="2026-12-31"]').click(); p.wait_for_timeout(100)
    chk(val('#fRP [name=vence]') == '2026-12-31', '«Usar esta fecha» completa el vencimiento')
    p.fill('#fRP [name=vence]', '2029-03-20'); submit('fRP')
    ra = ev("CM.db.pacientes[%s].reprocann" % json.dumps(A))
    chk(ra['vence'] == '2029-03-20' and not ra.get('aVerif'), 'guardar a mano fija la fecha y quita «a verificar»: %s' % ra)
    chk(ev("CM.db.pacientes[%s].repHist.length" % json.dumps(A)) == 2, 'el cambio a mano también queda en el historial')
    ir('#/paciente/' + A)
    chk(p.locator('section.card', has_text='REPROCANN del paciente').first.locator('.note.warn').count() == 0, 'ya verificado: sin aviso')
    ir('#/paciente/' + B)
    p.locator('section.card', has_text='REPROCANN del paciente').first.locator('[data-act=rep-edit]').first.click(); p.wait_for_timeout(250)
    submit('fRP')
    chk('fecha' in err().lower(), 'sin fecha no deja guardar «Válido» (pide la fecha): %s' % err())
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(100)
    p.locator('section.card', has_text='REPROCANN del paciente').first.locator('[data-act=rep-ir-docs]').click(); p.wait_for_timeout(500)
    chk(ev("document.activeElement && document.activeElement.id") == 'pacDocs', '«Ver todos los documentos» lleva a «Documentos y escaneos»')

    # ---------- 5) subir documento REPROCANN con vencimiento ----------
    ev("CM.db.pacientes[%s].reprocann={estado:'sin',vence:null,carnet:false}; CM.save()" % json.dumps(C))
    ir('#/paciente/' + C)
    p.set_input_files('#docFile', files=[{'name': 'rep.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4 prueba'}]); p.wait_for_timeout(300)
    p.select_option('#fDC [name=tipo]', 'REPROCANN'); p.wait_for_timeout(100)
    chk(p.locator('#fDC [name=vence]').count() == 1, 'al elegir REPROCANN se pide el vencimiento')
    p.select_option('#fDC [name=tipo]', 'DNI'); p.wait_for_timeout(100)
    chk(p.locator('#fDC [name=vence]').count() == 0, 'otro tipo: no se pide')
    p.select_option('#fDC [name=tipo]', 'REPROCANN'); p.wait_for_timeout(100)
    p.fill('#fDC [name=vence]', '2028-06-30'); submit('fDC'); p.wait_for_timeout(500)
    rc = ev("CM.db.pacientes[%s].reprocann" % json.dumps(C))
    chk(rc['estado'] == 'valido' and rc['vence'] == '2028-06-30' and not rc.get('aVerif'), 'subir REPROCANN con fecha: queda Válido hasta esa fecha: %s' % rc)

    # ---------- 6) dispensa con varios productos ----------
    ir('#/caja')
    lotes = ev("CM.db.lotes.filter(l=>CM.stockLote(l.id)>=20&&l.unidad==='g').slice(0,2).map(l=>l.id)")
    ev("(()=>{CM.db.lotes.find(l=>l.id===%s).sug=500000; CM.db.lotes.find(l=>l.id===%s).sug=300000; CM.save();})()" % (json.dumps(lotes[0]), json.dumps(lotes[1])))
    dni = D
    ev("CM.db.cfg.topeMensual=0")
    n_disp0, n_ap0 = ev("CM.db.disp.length"), ev("CM.db.aportes.length")
    ev("CM.acts.dispensar({getAttribute:()=>%s})" % json.dumps(dni)); p.wait_for_timeout(250)
    p.select_option('#fDS [name=lote]', lotes[0]); p.fill('#fDS [name=cant]', '6'); p.wait_for_timeout(100)
    p.click('#fDS [data-act=ds-agregar]'); p.wait_for_timeout(150)
    chk(p.locator('#fDS [data-dsr]').count() == 2 and p.locator('#fDS [name=lote_2]').count() == 1, '«Agregar otro producto» suma un renglón')
    p.select_option('#fDS [name=lote_2]', lotes[0]); p.fill('#fDS [name=cant_2]', '1'); p.wait_for_timeout(100)
    submit('fDS')
    chk('otro renglón' in err().lower() or 'mismo lote' in err().lower() or 'repet' in err().lower() or 'dos veces' in err().lower(), 'mismo lote dos veces: avisa (%s)' % err())
    p.select_option('#fDS [name=lote_2]', lotes[1]); p.fill('#fDS [name=cant_2]', '7'); p.wait_for_timeout(150)
    chk(val('#fDS [name=desc]') == '5000' and val('#fDS [name=desc_2]') == '3000', '5+1 por producto: 6 g → 1 libre; 7 g → 1 libre (%s / %s)' % (val('#fDS [name=desc]'), val('#fDS [name=desc_2]')))
    chk(val('#fDS [name=aporte]') == str(25000 + 18000), 'total = suma de los productos (%s)' % val('#fDS [name=aporte]'))
    p.click('#fDS [data-act=ds-agregar]'); p.wait_for_timeout(100)
    chk(p.locator('#fDS [data-dsr]').count() == 3, 'tercer renglón')
    p.locator('#fDS [data-act=ds-quitar]').last.click(); p.wait_for_timeout(100)
    chk(p.locator('#fDS [data-dsr]').count() == 2 and val('#fDS [name=aporte]') == '43000', '«Quitar» saca el renglón y el total no cambia')
    p.fill('#fDS [name=cant_2]', '99999'); p.wait_for_timeout(80); submit('fDS')
    chk('stock' in err().lower() or 'quedan' in err().lower(), 'controla el stock de cada lote (%s)' % err())
    p.fill('#fDS [name=cant_2]', '7'); p.wait_for_timeout(100)
    if p.locator('#fDS [name=medio]').count(): p.select_option('#fDS [name=medio]', 'efectivo')
    if p.locator('#fDS [name=recibido]').count(): p.fill('#fDS [name=recibido]', '50000')
    if p.locator('#fDS [name=obs]').count() and p.locator('#fDS [name=obs]').is_visible(): p.fill('#fDS [name=obs]', 'prueba')
    submit('fDS'); p.wait_for_timeout(300)
    chk(ev("CM.db.disp.length") - n_disp0 == 2 and ev("CM.db.aportes.length") - n_ap0 == 1, 'se registran 2 dispensaciones y UNA sola donación (%s)' % err())
    ds = ev("CM.db.disp.slice(-2)"); ap = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(ds[0].get('grupo') == ds[0]['id'] and ds[1].get('grupo') == ds[0]['id'], 'las dos quedan agrupadas en la misma dispensa')
    chk(ap.get('disps') == [ds[0]['id'], ds[1]['id']] and all(d.get('aporte') == ap['id'] for d in ds), 'la donación apunta a las dos dispensaciones')
    chk(ap['cent'] == 4300000 and len(ap.get('calcs') or []) == 2, 'la donación guarda el total y el detalle por producto')
    chk(ap.get('cambio') == 700000, 'un solo cambio: $ 7.000 (%s)' % ap.get('cambio'))
    chk(p.locator('#modalRoot [data-act=etiqueta]').count() == 2, 'confirmación: una etiqueta por producto')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)

    # móvil
    p.set_viewport_size({'width': 390, 'height': 800})
    ev("CM.acts.dispensar({getAttribute:()=>%s})" % json.dumps(dni)); p.wait_for_timeout(250)
    p.click('#fDS [data-act=ds-agregar]'); p.wait_for_timeout(150)
    ancho = ev("Math.max(...[...document.querySelectorAll('#fDS [data-dsr]')].map(e=>e.scrollWidth-e.clientWidth))")
    chk(ancho <= 1, 'en el celular los renglones no desbordan (%s px)' % ancho)
    p.screenshot(path='/tmp/disp_movil.png')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(100)
    p.set_viewport_size({'width': 1366, 'height': 900})
    ir('#/paciente/' + B); p.screenshot(path='/tmp/ficha_rep.png', full_page=True)
    p.locator('section.card', has_text='REPROCANN del paciente').first.locator('[data-act=rep-edit]').first.click(); p.wait_for_timeout(250)
    p.screenshot(path='/tmp/form_rep.png')

    chk(not errs, 'sin errores en la consola: %s' % errs[:3])
    b.close()
print('\n%d ok · %d fallas' % (oks[0], len(fallas)))
if fallas: print('\n'.join(fallas)); raise SystemExit(1)
