import http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(ROOT)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
s = socketserver.TCPServer(('127.0.0.1', 0), Q); threading.Thread(target=s.serve_forever, daemon=True).start()
U = 'http://127.0.0.1:%d/index.html' % s.server_address[1]
oks, fallas, red = [0], [], []
def chk(c, n):
    if c: oks[0] += 1; print('ok  ' + n)
    else: fallas.append(n); print('FALLA ' + n)
with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900}, locale='es-AR'); p = ctx.new_page()
    errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    p.on('console', lambda m: errs.append('csp:' + m.text) if 'Content Security' in m.text else None)
    p.route('**/js/config.js*', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.CM_CFG={url:'',key:'',inactividadMin:15};"))
    p.route('**/*supabase.co/**', lambda r: (red.append(r.request.url), r.abort()))
    ctx.route('https://wa.me/**', lambda r: r.fulfill(status=200, content_type='text/html', body='wa'))
    p.route('https://www.google.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<p>mapa</p>'))
    p.goto(U); p.wait_for_timeout(800)
    p.evaluate("(()=>{const u=CM.db.users[0];u.activo=true;u.rol='admin';CM.ses.set(u.id);CM.db.cfg.rol='admin';})()")
    # publicar con defaults
    p.goto(U + '#/menu-publico'); p.wait_for_timeout(300)
    p.evaluate("CM.menuFill(CM.db.menu.draft); CM.menuFill(CM.db.menu.pub)")
    p.goto(U + '#/m'); p.wait_for_timeout(500)
    chk(p.locator('.pubx-card').count() == 1 and p.locator('.pubx-stamps i').count() >= 3, 'tarjeta de ejemplo del Club visible')
    chk('ejemplo' in p.locator('.pubx-card').inner_text().lower(), 'la tarjeta dice «ejemplo»')
    chk(p.locator('.pubx-map iframe').count() == 1, 'mapa embebido')
    chk(p.locator('#pub-legal details.pubx-legal').count() >= 4, 'información legal con documentos plegables')
    chk(p.locator('.pubx-arrep').count() == 0, 'arrepentimiento apagado por defecto')
    # admin: encender arrepentimiento, reseña, handle
    p.goto(U + '#/menu-publico'); p.wait_for_timeout(200)
    p.evaluate("CM.mp.tab='legal'; location.hash='#/menu-publico'; CM.render && CM.render()"); p.wait_for_timeout(300)
    if p.locator('form[data-form=mp-legal]').count() == 0:
        p.click('text=Información legal'); p.wait_for_timeout(300)
    chk(p.locator('form[data-form=mp-legal]').count() == 1, 'pestaña Información legal en la administración')
    p.check('form[data-form=mp-legal] input[name=arrep]'); p.click('form[data-form=mp-legal] button[type=submit]'); p.wait_for_timeout(300)
    chk(p.evaluate("CM.db.menu.draft.legal.arrep") is True and p.evaluate("CM.db.menu.pub.legal.arrep") is False, 'arrepentimiento queda en borrador hasta publicar')
    p.evaluate("CM.mp.tab='red'"); p.goto(U + '#/menu-publico'); p.wait_for_timeout(300)
    if p.locator('form[data-form=mp-red]').count() == 0: p.click('text=Ubicación y redes'); p.wait_for_timeout(300)
    p.fill('form[data-form=mp-red] input[name=resena]', 'javascript:alert(1)'); p.click('form[data-form=mp-red] button[type=submit]'); p.wait_for_timeout(200)
    chk(p.evaluate("CM.db.menu.draft.ubic.resena") != 'javascript:alert(1)', 'enlace de reseña no https rechazado')
    p.fill('form[data-form=mp-red] input[name=resena]', 'https://g.page/r/ejemplo/review'); p.click('form[data-form=mp-red] button[type=submit]'); p.wait_for_timeout(300)
    chk(p.evaluate("CM.db.menu.draft.ubic.resena") == 'https://g.page/r/ejemplo/review', 'enlace de reseña guardado')
    p.evaluate("CM.mp.tab='club'"); p.goto(U + '#/menu-publico'); p.wait_for_timeout(300)
    if p.locator('form[data-form=mp-club]').count() == 0: p.click('text=Club y altas'); p.wait_for_timeout(300)
    p.fill('form[data-form=mp-club] input[name=meta]', '50'); p.click('form[data-form=mp-club] button[type=submit]'); p.wait_for_timeout(200)
    chk(p.evaluate("CM.db.menu.draft.club.meta") != 50, 'meta fuera de rango rechazada')
    p.fill('form[data-form=mp-club] input[name=meta]', '10'); p.fill('form[data-form=mp-club] input[name=pes]', 'Un taller gratis <b>x</b>'); p.click('form[data-form=mp-club] button[type=submit]'); p.wait_for_timeout(200)
    chk(p.evaluate("CM.db.menu.draft.club.meta") == 10, 'meta del Club guardada')
    # publicar
    p.evaluate("CM.db.menu.pub = JSON.parse(JSON.stringify(CM.db.menu.draft)); CM.save()")
    p.goto(U + '#/m'); p.wait_for_timeout(500)
    chk(p.locator('.pubx-stamps i').count() == 10, 'la tarjeta usa la meta configurada (10)')
    chk(p.locator('.pubx-reward b').count() == 0 and '<b>x</b>' in p.locator('.pubx-reward').inner_text(), 'premio escapado (sin HTML)')
    chk(p.locator('.pubx-review a').count() >= 1, 'panel de reseñas con botón')
    chk(p.locator('.pubx-arrep').count() == 1, 'botón de arrepentimiento visible al encenderlo')
    with ctx.expect_page() as np:
        p.click('.pubx-arrep')
    pg = np.value; pg.wait_for_load_state(); chk('wa.me' in pg.url and 'arrepentimiento' in __import__('urllib.parse').parse.unquote(pg.url).lower(), 'arrepentimiento abre WhatsApp con el pedido'); pg.close()
    for w in (360, 320):
        p.set_viewport_size({'width': w, 'height': 800}); p.wait_for_timeout(200)
        ov = p.evaluate("document.documentElement.scrollWidth - innerWidth")
        chk(ov <= 0, '%d px sin desborde (%d)' % (w, ov))
    small = p.evaluate("[...document.querySelectorAll('.pubx-arrep,.pubx-btn,.pubx-legal summary,.pubx-social a')].filter(e=>e.offsetParent).map(e=>e.getBoundingClientRect().height).filter(h=>h<44).length")
    chk(small == 0, 'áreas táctiles >= 44 px')
    p.goto(U + '#/m?lang=en'); p.evaluate("CM.setLang && CM.setLang('en')"); p.wait_for_timeout(300)
    txt = p.locator('#main').inner_text().lower()
    chk('demo' not in txt, 'el menú no dice «demo»')
    chk(not red, 'no se tocó la nube')
    chk(not errs, 'consola sin errores ' + ' | '.join(errs[:3]))
    b.close()
print('%d correctas, %d fallas' % (oks[0], len(fallas)))
