"""Documentos del sistema anterior → legajos con el selector de Google (Chromium real). Nube, función y Google SIMULADOS; datos ficticios.
Uso: python3 t/e2e_anteriores.py"""
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
MOCK = r"""
(function(){var N=CM.nube;N.activa=true;N.ses={at:'jwt',me:{rol:'admin',nombre:'Prueba'}};window.__calls=[];
N._fn=function(fn,b){window.__calls.push(b);if(b.accion==='estado')return Promise.resolve({ok:true,configurado:true,conectado:true,cuenta:'ong@gmail.com',raiz:''});
 if(b.accion==='picker')return Promise.resolve({ok:true,clientId:'cid.apps.googleusercontent.com',apiKey:'AIza-x',appId:'123456789',cuenta:'ong@gmail.com'});
 if(b.accion==='vincular')return Promise.resolve({ok:true,items:b.items.map(function(x){return x.fileId==='MALO000000001'?{fileId:x.fileId,ok:false,error:'sin acceso'}:{fileId:x.fileId,ok:true,url:'https://drive.google.com/file/d/'+x.fileId+'/view'}})});
 return Promise.reject(new Error('?'));};})();
"""
GSI = "window.google=window.google||{};google.accounts={oauth2:{initTokenClient:function(o){return {requestAccessToken:function(){window.__hint=o.hint;setTimeout(function(){o.callback({access_token:'tok-corto'})},10)}}}}};"
GAPI = r"""window.gapi={load:function(n,o){var P={ViewId:{DOCS:'d'},DocsViewMode:{LIST:'l'},Feature:{MULTISELECT_ENABLED:'m'},Response:{ACTION:'action',DOCUMENTS:'docs'},Action:{PICKED:'picked',CANCEL:'cancel'},Document:{ID:'id',NAME:'name'}};
function V(){} V.prototype.setIncludeFolders=V.prototype.setSelectFolderEnabled=V.prototype.setMode=function(){return this};P.DocsView=V;
function B(){} ['setOAuthToken','setDeveloperKey','setAppId','addView','enableFeature','setMaxItems','setLocale','setTitle'].forEach(function(k){B.prototype[k]=function(v){(window.__pk=window.__pk||{})[k]=v;return this}});
B.prototype.setCallback=function(f){this.cb=f;return this};B.prototype.build=function(){var s=this;return {setVisible:function(){setTimeout(function(){s.cb({action:'picked',docs:window.__ELEGIDOS})},10)}}};P.PickerBuilder=B;
window.google=window.google||{};google.picker=P;o.callback();}};"""
with sync_playwright() as pw:
    b = pw.chromium.launch()
    p = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.route('**/*supabase.co/**', lambda r: r.abort())
    p.route('https://accounts.google.com/gsi/client', lambda r: r.fulfill(status=200, content_type='application/javascript', body=GSI))
    p.route('https://apis.google.com/js/api.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=GAPI))
    p.route('**/js/m-drivesrv.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK + open(os.path.join(RAIZ, 'js/m-drivesrv.js')).read()))
    p.goto(U); p.wait_for_timeout(700); ev = p.evaluate
    ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';})()")
    ev("CM.driveSrvEstado(true)"); p.wait_for_timeout(200)
    D = ev("Object.keys(CM.db.pacientes).filter(k=>CM.db.pacientes[k].leg).slice(0,2)")
    ev("""(()=>{CM.db.legDocs=[{id:'LD1',dni:'%s',nombre:'Certificado',estado:'anterior',legacyId:'aaa111.Archivo_PDF.1.pdf'},{id:'LD2',dni:'%s',nombre:'DNI',estado:'anterior',legacyId:'bbb222.Archivo_PDF.2.jpg'},{id:'LD3',dni:'%s',nombre:'Receta',estado:'anterior',legacyId:'ccc333.Archivo_PDF.3.pdf'}];CM.save();})()""" % (D[0], D[1], D[1]))
    ev("window.__ELEGIDOS=[{id:'FILE000000001',name:'aaa111.Archivo_PDF.1.pdf'},{id:'FILE000000002',name:'bbb222.Archivo_PDF.2.jpg'},{id:'MALO000000001',name:'ccc333.Archivo_PDF.3.pdf'},{id:'OTRO000000001',name:'foto-vacaciones.jpg'}]")
    p.goto(U + '#/pacientes'); p.wait_for_timeout(400)
    chk(p.locator('text=Documentos del sistema anterior').count() == 1 and p.locator('text=3 por vincular').count() == 1, 'tarjeta con 3 documentos por vincular (admin)')
    p.click('[data-act=anteriores-vincular]'); p.wait_for_timeout(800)
    docs = ev("CM.db.legDocs.map(d=>[d.id,d.estado,d.driveFileId||''])")
    chk(docs == [['LD1', 'vinculado', 'FILE000000001'], ['LD2', 'vinculado', 'FILE000000002'], ['LD3', 'anterior', '']], 'emparejados por nombre: 2 vinculados, el que falló queda pendiente %s' % docs)
    v = [c for c in ev("window.__calls") if c.get('accion') == 'vincular'][0]
    chk(len(v['items']) == 3 and all(set(x.keys()) == {'fileId', 'nombre', 'legajo', 'dni'} for x in v['items']), 'al servidor van sólo id, nombre, legajo y DNI (sin el archivo elegido de más)')
    t = p.locator('#main').inner_text()
    chk('2 documento(s) vinculado(s)' in t and '1 archivo(s) elegido(s) no coinciden' in t and 'Con error' in t, 'resumen: vinculados, sin coincidencia y con error')
    chk(ev("window.__hint") == 'ong@gmail.com' and ev("window.__pk.setDeveloperKey") == 'AIza-x' and ev("window.__pk.setAppId") == '123456789', 'el selector usa la cuenta conectada, la clave de API y el proyecto')
    chk('Vinculaste' in ev("CM.db.audit[0].accion") or 'vinculados' in ev("CM.db.audit[0].detalle"), 'queda en la auditoría')
    p.click('[data-act=ver-pac], a[href^="#/paciente/%s"]' % D[0]) if False else None
    p.goto(U + '#/paciente/' + D[0]); p.wait_for_timeout(400)
    chk(p.locator('a[href="https://drive.google.com/file/d/FILE000000001/view"]').count() >= 1, 'en el legajo el documento abre el archivo en Drive')
    ev("CM.db.cfg.rol='operador'"); p.goto(U + '#/pacientes'); p.wait_for_timeout(300)
    chk(p.locator('[data-act=anteriores-vincular]').count() == 0, 'sin rol de administración no aparece el botón')
    chk(not errs, 'consola sin errores %s' % errs[:3])
    b.close()
print('\n%d ok, %d fallas' % (oks[0], len(fallas)))
import sys; sys.exit(1 if fallas else 0)
