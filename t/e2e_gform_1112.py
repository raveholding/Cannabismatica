"""Formularios de Google del sistema anterior → sistema (2026-11-12). Nube y función SIMULADAS, datos FICTICIOS.
Caso real: un paciente llenó el «Formulario de Ingreso» de Google y no aparecía en el sistema. Uso: python3 t/e2e_gform_1112.py (PAGINA=index.html)"""
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
ING = [['Marca temporal', 'Motivo de Consulta / Porque motivo utiliza cannabis', 'Nombre y Apellido', 'Fecha de Nacimiento\n', 'DNI\n(Sin espacios ni puntos)', 'Dirección \n(Provincia, Localidad, Barrio, Calle, N°)', 'Código Postal', 'Teléfono \n(sin espacios)', 'Email ', 'Obra Social / N°', 'Cod. de Seguimiento - \nPaciente REPROCANN', 'Labor - Ocupación -Trabajo', 'DUDAS - CONSULTAS - COMENTARIOS', 'Deseas inscribirte en el programa?'],
       ['18/03/2026', 'insomnio', 'Persona Vieja', '11/05/1990', '99100009', 'calle 1', '4400', '3875000000', 'vieja@example.com', 'no', '', 'medico', '', ''],
       ['12/11/2026 14:54:56', 'Ansiedad - Estres', 'Francisco Ficticio ', '10/10/1997', '99100001', 'Salta Capital Barrio X manzana 1 casa 17', '4400', '3875000001', 'ficticio@example.com', '- ', '369220', 'Administración ', '', ''],
       ['10/11/2026 16:36:58', 'Dolor', 'Ana Sin Documento', '01/02/1985', '12', 'Calle 2', '4400', '5493875000002', 'ana@example.com', '', 'En proceso', 'Docente', '', ''],
       ['11/11/2026 10:00:00', 'Dolor', 'Ya Existe Paciente', '01/02/1985', 'DNI_EXISTE', '', '4400', '3875000003', 'existe@example.com', '', '', '', '', '']]
SEG = [['Marca temporal', 'Nombre Completo\n(como figura en el DNI)', 'DNI\n(sin espacios ni puntos)', 'Sintoma o Patología a mejorar', 'Vias de Admninistración', 'Productos Indicados', 'Sabe que Quimiotipo esta consumiendo? (Q)', 'Siente alguna de las siguientes mejoras?', 'Siente alguno de estos efectos NO deseados?', 'Dejo de realizar alguna actividad desde el consumo del cannabis?', 'Mejoro o comenzó con alguna actividad nueva desde el consumo de cannabis?', 'Que tipo de actividad comenzo o mejoro?', 'Reconoce o tiene la necesidad de mejorar habitos y estilos de vida saludables? ', 'Algun comentario que nos quieras compartir :)', 'Dirección de correo electrónico', 'Inflorescencias o Flores Secas Terapéuticas Seleccione la genética'],
       ['09/11/2026 15:31:58', 'Ya Existe Paciente', 'DNI_EXISTE', 'Insomnio, Ansiedad', 'Inhalatoria Combustion', 'Flores Secas', 'Quimitipo 1 (THC)', 'Mejora del Sueño', 'No siento efectos adversos', 'No', 'Si', 'Gym', 'Si, Actividad Fisica', '', 'x@example.com', ''],
       ['09/11/2026 16:00:00', 'Nadie', '99199199', 'Insomnio', '', '', '', '', '', '', '', '', '', '', '', '']]
with sync_playwright() as pw:
    b = pw.chromium.launch(); p = b.new_page(viewport={'width': 1366, 'height': 900}); errs = []
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.goto(U); p.wait_for_timeout(700); ev = p.evaluate
    ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';CM.db.cfg.operador=u.nombre;})()")
    dniEx = ev("Object.keys(CM.db.pacientes).find(k=>/^\\d{7,8}$/.test(k))")
    ex0 = ev("JSON.parse(JSON.stringify(CM.db.pacientes[%s]))" % json.dumps(dniEx))
    ev("CM.db.pacientes[%s].email=''; CM.db.pacientes[%s].nombre='Ya Existe Paciente'" % (json.dumps(dniEx), json.dumps(dniEx)))
    ing = json.loads(json.dumps(ING).replace('DNI_EXISTE', dniEx)); seg = json.loads(json.dumps(SEG).replace('DNI_EXISTE', dniEx))
    ev("""(()=>{const N=CM.nube;N.activa=true;N.ses={at:'jwt',me:{rol:'admin',nombre:'Prueba'}};window.__calls=[];
      CM.driveSrv=CM.driveSrv||{};CM.driveSrv.conectado=true;
      CM.pickerElegir=function(o){window.__pick=o;return Promise.resolve([{id:'HOJA00000000001',name:'CANNABISMATICA'}]);};
      N._fn=function(fn,b){window.__calls.push(b.accion);if(b.accion==='formularios'){if(b.archivo!=='HOJA00000000001')return Promise.reject(new Error('sin acceso'));
        return Promise.resolve({ok:true,titulo:'CANNABISMATICA',hojas:[{titulo:'Respuestas de formulario 2',filas:%s},{titulo:'Respuestas de formulario 1',filas:%s}]});}
        if(b.accion==='estado')return Promise.resolve({ok:true,configurado:true,conectado:true});return Promise.reject(new Error('?'));};})()""" % (json.dumps(seg), json.dumps(ing)))
    p.goto(U + '#/inicio'); p.wait_for_timeout(100); p.goto(U + '#/solicitudes'); p.wait_for_timeout(500)
    chk(p.locator('main', has_text='Formularios de Google').count() == 1 and p.locator('[data-act=gf-elegir]').count() == 1, 'Solicitudes: tarjeta «Formularios de Google» con «Elegir la planilla»')
    n0 = ev("Object.keys(CM.db.pacientes).length")
    p.click('[data-act=gf-elegir]'); p.wait_for_timeout(800)
    chk(ev("window.__pick.hojas && window.__pick.uno") and ev("CM.db.ong.gform.archivo") == 'HOJA00000000001', 'se elige una sola planilla (de hojas de cálculo) y queda vinculada')
    pf = ev("Object.values(CM.db.pacientes).find(x=>x.nombre==='Francisco Ficticio')")
    chk(pf is not None and pf['dni'] == '99100001' and pf['revisar'] and pf['origen'] == 'Formulario de Google', 'el paciente del formulario aparece en el sistema (legajo nuevo, por verificar)')
    chk(pf and pf['tel'] == '3875000001' and pf['nac'] == '1997-10-10' and pf['email'] == 'ficticio@example.com' and pf['cp'] == '4400' and pf['ocupacion'] == 'Administración', 'datos bien leídos (teléfono, nacimiento, correo, CP, ocupación)')
    chk(pf and pf['reprocann']['estado'] == 'tramite' and pf.get('codSeg') == '369220', 'código de seguimiento REPROCANN → en trámite, con el código')
    pa = ev("Object.values(CM.db.pacientes).find(x=>x.nombre==='Ana Sin Documento')")
    chk(pa and pa['doc'] is None and pa.get('docDeclarado') == '12' and pa['tel'] == '3875000002', 'documento inválido: se crea igual, sin documento y con lo declarado para revisar; teléfono 549… normalizado')
    chk(ev("Object.values(CM.db.pacientes).some(x=>x.nombre==='Persona Vieja')") is False, 'respuestas anteriores a la fecha «desde» no se cargan (ya vinieron en la migración)')
    chk(ev("Object.keys(CM.db.pacientes).length") - n0 == 2, 'sólo 2 pacientes nuevos')
    chk(ev("CM.db.pacientes[%s].email" % json.dumps(dniEx)) == 'existe@example.com' and ev("CM.db.pacientes[%s].nombre" % json.dumps(dniEx)) == 'Ya Existe Paciente', 'ya tenía ficha: no se pisa, sólo se completa el correo vacío')
    chk(ev("CM.db.seg.filter(s=>s.dni===%s && s.origen==='Formulario de Google').length" % json.dumps(dniEx)) == 1 and ev("CM.db.seg.find(s=>s.origen==='Formulario de Google').objetivos") == ['Insomnio', 'Ansiedad'], 'seguimiento del formulario agregado a la ficha')
    chk(p.locator('.note', has_text='sin ficha').count() == 1, 'seguimiento de alguien sin ficha: aviso para revisar')
    chk(ev("CM.solicitudesPendientes()") >= 2 and p.locator('tr', has_text='Francisco Ficticio').locator('.pill', has_text='Pendiente').count() == 1, 'aparecen como solicitudes pendientes (campana y bandeja)')
    chk(p.locator('tr', has_text='Ya Existe').locator('.pill', has_text='Ya tenía ficha').count() == 1, 'la respuesta de quien ya tenía ficha queda anotada')
    # idempotente
    n1 = ev("Object.keys(CM.db.pacientes).length"); s1 = ev("CM.db.seg.length"); h1 = ev("CM.db.menu.hcs.length")
    p.click('[data-act=gf-leer]'); p.wait_for_timeout(600)
    chk([ev("Object.keys(CM.db.pacientes).length"), ev("CM.db.seg.length"), ev("CM.db.menu.hcs.length")] == [n1, s1, h1], 'leer de nuevo no duplica nada')
    chk('Sin respuestas nuevas' in p.inner_text('main'), 'informa «Sin respuestas nuevas»')
    # aprobar
    p.locator('tr', has_text='Francisco Ficticio').locator('[data-act=hc-ok]').click(); p.wait_for_timeout(300)
    chk(not ev("CM.db.pacientes['99100001'].revisar"), 'se aprueba como cualquier solicitud')
    # rol sin permiso: no lee
    ev("CM.nube.ses.me.rol='operador'; window.__calls=[]"); p.click('[data-act=gf-leer]') if p.locator('[data-act=gf-leer]').count() else None; p.wait_for_timeout(300)
    chk('formularios' not in ev("window.__calls"), 'operador: no lee los formularios')
    chk(not errs, 'sin errores en la consola: %s' % errs[:3])
    b.close()
print('\n%d ok · %d fallas' % (oks[0], len(fallas)))
if fallas: print('\n'.join(fallas)); raise SystemExit(1)
