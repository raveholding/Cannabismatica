"""Etapa 4 · 2026-11-11 (Chromium real, modo local con datos FICTICIOS).
Tema claro/oscuro/sistema (sin elección = claro), menú «Gestión de caja» con pestañas, buscador Ctrl+K tolerante a errores,
avisos en la barra, mini gráficos, tablas ordenables y regresión de todas las pantallas en los dos temas.
Uso: python3 t/e2e_ux_1111.py   (PAGINA=index.html para el paquete publicado)"""
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
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}, color_scheme='dark')
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.route('**/*supabase.co/**', lambda r: r.abort())
    p.goto(U); p.wait_for_timeout(700)
    ev = p.evaluate
    ev("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';})()")
    def ir(h): p.goto(U + '#/inicio'); p.wait_for_timeout(80); p.goto(U + h); p.wait_for_timeout(350)
    ir('#/inicio')

    # ---------- tema ----------
    chk(ev("document.documentElement.dataset.tema") == 'claro', 'sin elección queda en claro (aunque el equipo esté en oscuro): no cambia lo de hoy')
    chk(p.locator('#btnTema').count() == 1 and p.locator('[data-act=ux-buscar]').count() == 1, 'barra: botón de tema y «Buscar»')
    p.click('#btnTema'); p.wait_for_timeout(150)
    chk(ev("document.documentElement.dataset.tema") == 'oscuro' and ev("localStorage.getItem('cmv3_tema')") == 'oscuro', 'botón → oscuro, guardado en el equipo')
    bg = ev("getComputedStyle(document.querySelector('.card')).backgroundColor")
    chk(bg in ('rgb(18, 23, 15)',), 'en oscuro las tarjetas son oscuras: %s' % bg)
    p.reload(); p.wait_for_timeout(600)
    chk(ev("document.documentElement.dataset.tema") == 'oscuro', 'al recargar sigue en oscuro (sin destello)')
    p.click('#btnTema'); p.wait_for_timeout(150)
    chk(ev("localStorage.getItem('cmv3_tema')") == 'sistema' and ev("document.documentElement.dataset.tema") == 'oscuro', '«Sistema» sigue el modo del equipo (oscuro)')
    ctx.pages[0].emulate_media(color_scheme='light'); p.wait_for_timeout(150)
    chk(ev("document.documentElement.dataset.tema") == 'claro', '«Sistema» cambia solo si el equipo pasa a claro')
    ir('#/ajustes')
    chk(p.locator('#uxApar h2', has_text='Apariencia').count() == 1, 'Configuración → Apariencia')
    p.click('#uxApar [data-act=tema-set][data-v=claro]'); p.wait_for_timeout(150)
    chk(ev("localStorage.getItem('cmv3_tema')") == 'claro' and p.locator('#uxApar [data-v=claro][aria-pressed=true]').count() == 1, 'Apariencia → Claro')

    # ---------- menú agrupado ----------
    navs = ev("Array.from(document.querySelectorAll('#nav a')).map(a=>a.textContent.trim())")
    chk('Gestión de caja' in navs and 'Arqueo y cierre' not in navs and 'Cajas cerradas' not in navs and 'Cajas y traspasos' not in navs, 'una sola entrada «Gestión de caja» en el menú')
    for h, t in [('#/caja', 'Caja actual'), ('#/cajas-tr', 'Cajas y traspasos'), ('#/cierre', 'Arqueo y cierre'), ('#/cajas-cerradas', 'Cajas cerradas')]:
        ir(h)
        chk(p.locator('.ux-grp a[aria-selected=true]', has_text=t).count() == 1 and p.locator('#nav a[href="#/caja"][aria-current=page]').count() == 1, '%s: pestaña «%s» activa y menú marcado' % (h, t))
    p.locator('.ux-grp a', has_text='Arqueo y cierre').click(); p.wait_for_timeout(300)
    chk(ev("location.hash") == '#/cierre', 'las pestañas navegan entre las pantallas de caja')

    # ---------- Ctrl+K ----------
    ir('#/inicio')
    pac = ev("(()=>{const k=Object.keys(CM.db.pacientes)[3];return [k, CM.db.pacientes[k].nombre]})()")
    p.keyboard.press('Control+k'); p.wait_for_timeout(200)
    chk(p.locator('#uxQ').count() == 1 and ev("document.activeElement.id") == 'uxQ', 'Ctrl+K abre el buscador con el cursor listo')
    pal = pac[1].split()[0]; typo = pal[0] + pal[2] + pal[1] + pal[3:] if len(pal) > 4 else pal
    p.fill('#uxQ', typo); p.wait_for_timeout(150)
    chk(p.locator('#uxRes li', has_text=pac[1]).count() >= 1, 'encuentra «%s» escribiendo «%s» (letras invertidas)' % (pac[1], typo))
    p.fill('#uxQ', pac[1]); p.wait_for_timeout(120); p.keyboard.press('Enter'); p.wait_for_timeout(350)
    chk(ev("location.hash") == '#/paciente/' + pac[0], 'Enter abre la ficha del paciente')
    p.keyboard.press('Control+k'); p.wait_for_timeout(150); p.fill('#uxQ', 'arqeo'); p.wait_for_timeout(120)
    chk(p.locator('#uxRes li', has_text='Arqueo y cierre').count() == 1, '«arqeo» encuentra la pantalla «Arqueo y cierre»')
    p.fill('#uxQ', 'liquidacion'); p.wait_for_timeout(120)
    chk(p.locator('#uxRes li', has_text='Liquidación interna').count() == 1, 'encuentra pestañas internas (Liquidación interna)')
    p.fill('#uxQ', 'nueva dispensacion'); p.wait_for_timeout(120); p.keyboard.press('ArrowDown'); p.keyboard.press('ArrowUp'); p.keyboard.press('Enter'); p.wait_for_timeout(300)
    chk(p.locator('#fDS').count() == 1, 'acción rápida: «Nueva dispensación» abre el formulario')
    p.keyboard.press('Escape'); p.wait_for_timeout(150)
    if p.locator('#modalRoot [data-act=modal-close]').count(): p.click('#modalRoot [data-act=modal-close]')
    lote = ev("CM.db.lotes[0]")
    p.keyboard.press('Control+k'); p.wait_for_timeout(150); p.fill('#uxQ', lote['id']); p.wait_for_timeout(120)
    chk(p.locator('#uxRes li', has_text=lote['id']).count() >= 1, 'busca lotes por código')
    p.keyboard.press('Escape'); p.wait_for_timeout(100)

    # ---------- avisos ----------
    ir('#/inicio')
    av = ev("CM.uxAvisos().map(a=>a.k)")
    chk(p.locator('#uxAvisos .ux-av').count() == len(av) and len(av) >= 1, 'avisos en la barra: %s' % av)
    if 'repp' in av or 'rep' in av:
        p.click('#uxAvisos [data-k=%s]' % ('rep' if 'rep' in av else 'repp')); p.wait_for_timeout(300)
        chk(ev("location.hash") == '#/reprocann', 'tocar el aviso de REPROCANN lleva a REPROCANN')
    ev("(()=>{const u=CM.db.users[0];u.rol='operador';CM.db.cfg.rol='operador';})()"); ir('#/inicio')
    chk(not any(k in ev("CM.uxAvisos().map(a=>a.k)") for k in ['caja', 'rh']), 'el operador no ve avisos de caja ni de RR. HH.')
    ev("(()=>{const u=CM.db.users[0];u.rol='admin';CM.db.cfg.rol='admin';})()"); ir('#/inicio')

    # ---------- mini gráficos y tablas ordenables ----------
    chk(p.locator('.kpi .ux-spark').count() == 2, 'mini gráficos de 14 días en Dispensaciones y Donaciones')
    ir('#/trazabilidad')
    th = p.locator('main table th.ux-th', has_text='Disponible').first
    chk(th.count() == 1, 'la tabla de stock se puede ordenar')
    th.click(); p.wait_for_timeout(100)
    col = ev("(()=>{const t=document.querySelector('main table');const i=[...t.tHead.rows[0].cells].findIndex(c=>c.textContent.includes('Disponible'));return [...t.tBodies[0].rows].map(r=>parseFloat(r.cells[i].textContent.replace(/[^\\d,]/g,'').replace(',','.')))})()")
    chk(col == sorted(col), 'ordena de menor a mayor: %s' % col[:6])
    th.click(); p.wait_for_timeout(100)
    col2 = ev("(()=>{const t=document.querySelector('main table');const i=[...t.tHead.rows[0].cells].findIndex(c=>c.textContent.includes('Disponible'));return [...t.tBodies[0].rows].map(r=>parseFloat(r.cells[i].textContent.replace(/[^\\d,]/g,'').replace(',','.')))})()")
    chk(col2 == sorted(col2, reverse=True) and th.get_attribute('aria-sort') == 'descending', 'segundo toque: de mayor a menor (aria-sort)')

    # ---------- todas las pantallas en los dos temas ----------
    rutas = ['#/inicio', '#/pacientes', '#/dispensaciones', '#/aportes', '#/reprocann', '#/trazabilidad', '#/cultivo', '#/dashboard', '#/caja', '#/cajas-tr', '#/cierre', '#/cajas-cerradas', '#/inventario', '#/fidelizacion', '#/personal', '#/tareas', '#/solicitudes', '#/menu-publico', '#/perifericos', '#/importexport', '#/usuarios', '#/auditoria', '#/ajustes', '#/kiosco']
    for tema in ['oscuro', 'claro']:
        ev("CM.temaPoner(%s)" % json.dumps(tema))
        malas = []
        for h in rutas:
            ir(h)
            if p.locator('main h1').count() < 1: malas.append(h)
        chk(not malas, 'tema %s: abren las %d pantallas %s' % (tema, len(rutas), malas))
    p.set_viewport_size({'width': 390, 'height': 844}); ir('#/caja')
    chk(ev("document.documentElement.scrollWidth <= window.innerWidth + 1"), 'celular: la caja no se sale de la pantalla')
    chk(not errs, 'consola sin errores %s' % errs[:3])
    b.close()
print('%d ok, %d fallas' % (oks[0], len(fallas)))
if fallas: print('FALLAS:', fallas); raise SystemExit(1)
