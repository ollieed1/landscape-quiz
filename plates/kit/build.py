# Builds the quiz: UI (../quiz.template.html) + layered compositor + embedded layer images.
# Writes the repo's index.html and the local copy at ~/Desktop/landscape-quiz.html.
import base64, os, glob
here = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(here, '..', 'quiz.template.html')).read()
cut = tpl.index('/* ============================================================\n   PLATES')
head = tpl[:cut]
comp = open(os.path.join(here, 'compositor.js')).read()
assets = []
for f in sorted(glob.glob(os.path.join(here, '*.jpg'))):
    name = os.path.basename(f)[:-4]
    assets.append(f"'{name}': 'data:image/jpeg;base64,{base64.b64encode(open(f,'rb').read()).decode()}'")
comp = comp.replace('/*%%ASSETS%%*/', ',\n  '.join(assets))
html = head + comp + '</script>\n</body>\n</html>\n'
for out in (os.path.join(here, '..', '..', 'index.html'), os.path.expanduser('~/Desktop/landscape-quiz.html')):
    out = os.path.abspath(out)
    open(out, 'w').write(html)
    print(out, os.path.getsize(out) // 1024, 'KB')
