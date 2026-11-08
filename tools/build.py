"""Arma la versión rápida del sistema: dev.html (fuente, un archivo por módulo) → index.html (un solo JS y un solo CSS minificados).
Uso: python3 tools/build.py   (necesita esbuild: /opt/npm-tools/node_modules/.bin/esbuild o en el PATH)
- js/config.js y js/pre.js quedan aparte y primero: config del cliente y pedido anticipado del menú.
- El nombre lleva la huella del contenido (?v=<hash>): cada cambio llega solo, sin caché vieja.
- Las pruebas usan dev.html (pueden reemplazar módulos sueltos); t/_bundle_smoke.py prueba index.html."""
import hashlib, os, re, shutil, subprocess, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(R)
ESB = shutil.which('esbuild') or '/opt/npm-tools/node_modules/.bin/esbuild'
dev = open('dev.html', encoding='utf-8').read()
js = re.findall(r'<script src="(js/[^"?]+)\?v=[^"]*"></script>', dev)
css = re.findall(r'<link rel="stylesheet" href="(css/[^"?]+)\?v=[^"]*">', dev)
aparte = ['js/config.js', 'js/pre.js']
bun = [f for f in js if f not in aparte]
src = '\n;\n'.join('/* ' + f + ' */\n' + open(f, encoding='utf-8').read() for f in bun)
open('js/.bundle.tmp.js', 'w', encoding='utf-8').write(src)
subprocess.run([ESB, 'js/.bundle.tmp.js', '--minify', '--target=es2017', '--charset=utf8', '--legal-comments=none', '--outfile=js/app.min.js', '--log-level=warning'], check=True)
os.remove('js/.bundle.tmp.js')
open('css/.bundle.tmp.css', 'w', encoding='utf-8').write('\n'.join(open(f, encoding='utf-8').read() for f in css))
subprocess.run([ESB, 'css/.bundle.tmp.css', '--minify', '--charset=utf8', '--outfile=css/app.min.css', '--log-level=warning'], check=True)
os.remove('css/.bundle.tmp.css')
h = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()[:10]
hj, hc = h('js/app.min.js'), h('css/app.min.css')
out = dev
# CSS: los tres archivos → uno
links = re.findall(r'<link rel="stylesheet" href="css/[^"]+">\n?', out)
out = out.replace(links[0], '<link rel="stylesheet" href="css/app.min.css?v=%s">\n' % hc, 1)
for l in links[1:]: out = out.replace(l, '', 1)
# JS: config y pre siguen; el resto → app.min.js
tags = re.findall(r'<script src="js/[^"]+"></script>\n?', out)
primero = True
for t in tags:
    f = re.search(r'src="(js/[^"?]+)', t).group(1)
    if f in aparte: continue
    out = out.replace(t, ('<script src="js/app.min.js?v=%s"></script>\n' % hj) if primero else '', 1); primero = False
for f in aparte:
    out = re.sub(r'src="%s\?v=[^"]*"' % re.escape(f), 'src="%s?v=%s"' % (f, h(f)), out)
out = out.replace('<!doctype html>', '<!doctype html>\n<!-- GENERADO por tools/build.py desde dev.html: no editar a mano -->', 1)
open('index.html', 'w', encoding='utf-8').write(out)
tam = lambda p: os.path.getsize(p) // 1024
print('index.html listo · js %d KB (antes %d KB en %d archivos) · css %d KB' % (tam('js/app.min.js'), sum(os.path.getsize(f) for f in bun) // 1024, len(bun), tam('css/app.min.css')))
