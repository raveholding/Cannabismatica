"""2026-11-21 (Chromium real, modo local con datos FICTICIOS). Promociones de la dispensa configurables por la administración:
5+1 por defecto, alta/edición/pausa/archivo, porcentaje, aporte especial, monto, condiciones (mínimo, preparado, genética, vigencia),
la que más descuenta, elegir otra o ninguna, descuento manual, guardado en la donación y permisos.
Uso: python3 t/e2e_promos_1121.py   (PAGINA=index.html para el paquete publicado)"""
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
    ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';CM.db.cfg.operador=u.nombre;CM.db.promos=[];})()")
    def ir(h): p.goto(U + '#/inicio'); p.wait_for_timeout(80); p.goto(U + h); p.wait_for_timeout(300)
    def submit(fid): p.click('#modalRoot button[type=submit][form=%s]' % fid); p.wait_for_timeout(300)
    def err(): return p.locator('#modalRoot [data-err]').first.inner_text() if p.locator('#modalRoot [data-err]').count() else ''
    val = p.input_value
    def txt(sel): return p.locator(sel).first.inner_text()
    # lote ficticio con sugerido $ 1.000 por gramo (flor) y otro de aceite
    L = ev("""(()=>{const h=CM.hoy();const mk=(id,nombre,prod,unidad)=>{const l={id,nombre,prod,quim:'—',unidad,ingreso:h,min:0,sug:100000,cu:'',gen:'',genVar:''};CM.db.lotes.push(l);CM.addMov(id,'ingreso',500,'','');return id;};
      return [mk('LT-PR1','Gelato prueba','flores','g'), mk('LT-PR2','Aceite prueba','aceite','frasco')];})()""")
    chk(ev("Object.keys(CM.PRODUCTOS).includes('flores') && Object.keys(CM.PRODUCTOS).includes('aceite')"), 'existen los preparados flor y aceite')
    dni = ev("Object.keys(CM.db.pacientes).find(k=>CM.reglasDispensar(CM.db.pacientes[k]).bloquea===false)")

    ir('#/dispensaciones')
    chk(p.locator('[data-act=promos]').count() == 1, 'Dispensaciones muestra el botón «Promociones»')
    p.click('[data-act=promos]'); p.wait_for_timeout(200)
    chk('5+1' in txt('#modalRoot') and 'Activa' in txt('#modalRoot'), 'sin promociones cargadas rige la 5+1 de siempre')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(100)

    def abrir(lote, cant):
        ev("CM.acts.dispensar({getAttribute:()=>%s})" % json.dumps(dni)); p.wait_for_timeout(250)
        p.select_option('#fDS [name=lote]', lote); p.wait_for_timeout(120); p.fill('#fDS [name=cant]', str(cant)); p.wait_for_timeout(120)
    abrir(L[0], 6)
    chk(val('#fDS [name=desc]') == '1000' and val('#fDS [name=aporte]') == '5000', '6 g con 5+1 por defecto: descuenta 1 g (%s / %s)' % (val('#fDS [name=desc]'), val('#fDS [name=aporte]')))
    chk(p.locator('#fDS [name=promo]').count() == 1, 'cada producto tiene el selector «Promoción»')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)

    # ---- nueva promoción: 15 % desde 10 g sólo flor ----
    ev("CM.acts.promos()"); p.wait_for_timeout(150)
    p.click('#modalRoot [data-act=promo-ed][data-id=""]'); p.wait_for_timeout(200)
    p.fill('#fPR [name=nombre]', 'x'); submit('fPR')
    chk('nombre' in err(), 'valida el nombre: %s' % err())
    p.fill('#fPR [name=nombre]', 'Diez por ciento'); p.select_option('#fPR [name=tipo]', 'pct'); p.wait_for_timeout(80)
    chk(p.locator('#fPR [data-pr-t=pct]').is_visible() and not p.locator('#fPR [data-pr-t=nm]').is_visible(), 'al cambiar el tipo se ven sólo sus campos')
    p.fill('#fPR [name=pct]', '150'); submit('fPR')
    chk('porcentaje' in err().lower(), 'porcentaje fuera de rango rechazado')
    p.fill('#fPR [name=pct]', '15'); p.fill('#fPR [name=min]', '10'); p.check('#fPR [name=prod][value=flores]'); p.wait_for_timeout(80)
    chk('descuenta' in txt('#fPR [data-pr-ej]'), 'muestra un ejemplo del cálculo: %s' % txt('#fPR [data-pr-ej]'))
    submit('fPR')
    pr = ev("CM.db.promos.map(p=>[p.id,p.nombre,p.tipo,p.pct||0,p.min||0,(p.prods||[]).join()])")
    chk(len(pr) == 2 and pr[0][0] == 'PR-5MAS1' and pr[1][1:] == ['Diez por ciento', 'pct', 15, 10, 'flores'], 'se guardan la 5+1 (materializada) y la nueva: %s' % pr)
    chk(ev("CM.db.audit.some(a=>a.accion==='Promoción creada')"), 'el alta queda en la auditoría')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(100)

    abrir(L[0], 12)
    # 12 g × $1.000 = 12.000; 5+1 → 2.000 ; 15 % → 1.800 → gana 5+1
    chk(val('#fDS [name=desc]') == '2000', '12 g: automática elige la que más descuenta (5+1 $ 2.000 > 15 %% $ 1.800): %s' % val('#fDS [name=desc]'))
    pid = ev("CM.db.promos[1].id")
    p.select_option('#fDS [name=promo]', pid); p.wait_for_timeout(120)
    chk(val('#fDS [name=desc]') == '1800' and val('#fDS [name=aporte]') == '10200', 'elegir «Diez por ciento» a mano: descuenta $ 1.800 (%s / %s)' % (val('#fDS [name=desc]'), val('#fDS [name=aporte]')))
    p.select_option('#fDS [name=promo]', '-'); p.wait_for_timeout(120)
    chk(val('#fDS [name=desc]') in ('', '0') and val('#fDS [name=aporte]') == '12000', '«Sin promoción»: sin descuento (%s / %s)' % (val('#fDS [name=desc]'), val('#fDS [name=aporte]')))
    p.select_option('#fDS [name=promo]', pid); p.wait_for_timeout(120)
    p.select_option('#fDS [name=medio]', 'efectivo'); submit('fDS')
    a = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(a['cent'] == 1020000 and a['calc']['desc'] == 180000 and a['calc']['promo']['nombre'] == 'Diez por ciento', 'la donación guarda la promoción aplicada: %s' % a.get('calc'))
    chk('Diez por ciento' in ev("CM.aporteDetalle(CM.db.aportes[CM.db.aportes.length-1])"), 'el detalle de la donación nombra la promoción')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)

    # condiciones: aceite no entra en la promo de flor; 9 g no llega al mínimo
    abrir(L[0], 9)
    opts = ev("[...document.querySelectorAll('#fDS [name=promo] option')].map(o=>o.textContent)")
    chk(not any('Diez' in o for o in opts), '9 g: la del 15 %% (desde 10) no se ofrece: %s' % opts)
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)
    abrir(L[1], 12)
    opts = ev("[...document.querySelectorAll('#fDS [name=promo] option')].map(o=>o.textContent)")
    chk(not any('Diez' in o for o in opts) and any('5+1' in o for o in opts), 'aceite: sólo la 5+1 (la otra es para flor): %s' % opts)
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)

    # descuento a mano
    abrir(L[0], 6); p.fill('#fDS [name=desc]', '500'); p.wait_for_timeout(120)
    chk(val('#fDS [name=aporte]') == '5500', 'descuento cambiado a mano recalcula el total')
    submit('fDS'); a = ev("CM.db.aportes[CM.db.aportes.length-1]")
    chk(a['calc']['desc'] == 50000 and 'mano' in a['calc']['promo']['nombre'], 'queda registrado como ajustado a mano: %s' % a['calc'].get('promo'))
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(150)

    # editar la 5+1 → 10+2 ; pausar; archivar; otros tipos
    ev("CM.acts.promos()"); p.wait_for_timeout(150)
    p.click('#modalRoot [data-act=promo-ed][data-id="PR-5MAS1"]'); p.wait_for_timeout(200)
    p.fill('#fPR [name=nombre]', '10+2'); p.fill('#fPR [name=base]', '10'); p.fill('#fPR [name=extra]', '2'); p.fill('#fPR [name=motivo]', 'cambio del dueño'); submit('fPR')
    q = ev("CM.promo('PR-5MAS1')")
    chk(q['nombre'] == '10+2' and q['base'] == 10 and q['extra'] == 2 and len(q['hist']) == 1 and q['hist'][0]['motivo'] == 'cambio del dueño', 'editar guarda el valor anterior y el motivo')
    chk(ev("CM.calcAporte(100000,12,CM.lote('LT-PR2'),'').desc") == 200000 and ev("CM.calcAporte(100000,11,CM.lote('LT-PR2'),'').desc") == 0, '10+2: 12 unidades → 2 sin aporte; 11 → ninguna')
    p.click('#modalRoot [data-act=promo-estado][data-id="PR-5MAS1"][data-e=pausar]'); p.wait_for_timeout(200)
    chk(ev("CM.calcAporte(100000,12,CM.lote('LT-PR2'),'').desc") == 0, 'pausada: deja de aplicarse')
    p.click('#modalRoot [data-act=promo-estado][data-id="PR-5MAS1"][data-e=archivar]'); p.wait_for_timeout(200)
    chk(p.locator('#modalRoot tbody tr').count() == 1 and p.locator('#modalRoot [data-act=promos-arch]').count() == 1, 'archivada: sale de la lista y se puede ver aparte')
    chk(ev("CM.db.promos.length") == 2, 'archivar no borra nada')
    # tipos
    ev("""(()=>{CM.db.promos.push({id:'PR-T1',nombre:'Especial',tipo:'precio',precio:80000,min:5,prods:[],gens:['Gelato prueba'],dias:[],desde:'',hasta:'',activo:true,archivada:false,hist:[]},
      {id:'PR-T2',nombre:'Menos 500',tipo:'monto',monto:50000,min:0,prods:[],gens:[],dias:[],desde:'',hasta:'',activo:true,archivada:false,hist:[]},
      {id:'PR-T3',nombre:'Vencida',tipo:'pct',pct:90,min:0,prods:[],gens:[],dias:[],desde:'2020-01-01',hasta:'2020-12-31',activo:true,archivada:false,hist:[]});})()""")
    chk(ev("CM.calcAporte(100000,10,CM.lote('LT-PR1'),'PR-T1').desc") == 200000, 'aporte especial $ 800 por unidad desde 5: 10 × (1.000 − 800) = $ 2.000')
    chk(ev("CM.calcAporte(100000,10,CM.lote('LT-PR2'),'PR-T1').desc") == 0, 'la del aporte especial no aplica a otra genética')
    chk(ev("CM.calcAporte(100000,1,CM.lote('LT-PR2'),'PR-T2').desc") == 50000 and ev("CM.calcAporte(30000,1,CM.lote('LT-PR2'),'PR-T2').desc") == 30000, 'monto fijo, nunca más que el subtotal')
    chk(ev("CM.calcAporte(100000,10,CM.lote('LT-PR1'),'PR-T3').desc") == 0, 'vencida no aplica')
    chk(ev("CM.calcAporte(100000,12,CM.lote('LT-PR1'),'').promo.nombre") == 'Especial', 'automática con varias: la que más descuenta (Especial $ 2.400)')
    # XSS en el nombre
    ev("CM.db.promos.push({id:'PR-X',nombre:'<img src=x onerror=window.__x=1>',tipo:'pct',pct:1,min:0,prods:[],gens:[],dias:[],activo:true,archivada:false,hist:[]})")
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(100); ev("CM.acts.promos()"); p.wait_for_timeout(200)
    chk(not ev("window.__x") and p.locator('#modalRoot img').count() == 0, 'el nombre de una promoción se muestra como texto (sin XSS)')
    p.click('#modalRoot [data-act=modal-close]'); p.wait_for_timeout(100)
    # permisos
    ev("CM.db.cfg.rol='mostrador'"); ev("CM.acts.promos()"); p.wait_for_timeout(200)
    chk(p.locator('#modalRoot [data-act=promo-ed]').count() == 0 and p.locator('#modalRoot [data-act=promo-estado]').count() == 0, 'mostrador ve las promociones pero no las cambia')
    n0 = ev("CM.db.promos.length"); ev("CM.acts['promo-ed']({getAttribute:()=>''})"); p.wait_for_timeout(150)
    chk(ev("CM.db.promos.length") == n0 and p.locator('#fPR').count() == 0, 'mostrador no puede abrir el alta aunque llame la acción')
    p.set_viewport_size({'width': 360, 'height': 800}); ev("CM.db.cfg.rol='admin'"); p.wait_for_timeout(100)
    ev("CM.modal.close(true);CM.acts.promos()"); p.wait_for_timeout(200)
    chk(ev("document.documentElement.scrollWidth<=360"), '360 px: sin desborde horizontal')
    chk(not [e for e in errs if 'supabase' not in e and 'Failed to load' not in e], 'consola sin errores: %s' % errs[:3])
    b.close()
print('\n%d ok · %d fallas' % (oks[0], len(fallas)))
if fallas: raise SystemExit(1)
