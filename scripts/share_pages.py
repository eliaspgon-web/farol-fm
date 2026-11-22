#!/usr/bin/env python3
"""Gera uma página de compartilhamento por notícia (site/n/<id>/index.html) com os
metadados da matéria (título, resumo, imagem), para o WhatsApp, Facebook, X e Google
mostrarem a prévia correta. O leitor que abre o link é levado à matéria (/#post-<id>).

Fontes das notícias: server/seed.json e, se a variável FAROL_API estiver definida,
as notícias publicadas no servidor (/api/bootstrap). Uso: python3 scripts/share_pages.py site
"""
import base64, html, io, json, os, sys, unicodedata, urllib.request
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'site')
URL = os.environ.get('SITE_URL', 'https://farolradiotv.com.br').rstrip('/')
API = os.environ.get('FAROL_API', '').rstrip('/')
W, H = 1200, 630
F_BOLD = os.path.join(ROOT, 'fonts', 'Poppins-Bold.ttf')
F_MED = os.path.join(ROOT, 'fonts', 'Poppins-Medium.ttf')
LOGO = Image.open(os.path.join(ROOT, 'logo-circle.png')).convert('RGBA')
e = lambda s: html.escape(str(s or ''), quote=True)


def carregar():
    posts = {}
    with open(os.path.join(ROOT, '..', 'server', 'seed.json'), encoding='utf-8') as f:
        for p in json.load(f).get('posts', []):
            posts[p['id']] = p
    if API:
        try:
            with urllib.request.urlopen(API + '/api/bootstrap', timeout=20) as r:
                for p in json.load(r).get('posts', []):
                    posts[p['id']] = p
        except Exception as ex:
            print('Aviso: não foi possível ler as notícias do servidor:', ex)
    pub = lambda p: p.get('status') == 'publicado' if p.get('status') else not p.get('rascunho')
    return [p for p in posts.values() if pub(p)]


def wrap(d, txt, font, maxw, maxl):
    linhas, cur = [], ''
    for w in str(txt).split():
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=font) <= maxw: cur = t
        else:
            linhas.append(cur); cur = w
    linhas.append(cur)
    if len(linhas) > maxl:
        linhas = linhas[:maxl]
        while d.textlength(linhas[-1] + '…', font=font) > maxw: linhas[-1] = linhas[-1].rsplit(' ', 1)[0]
        linhas[-1] += '…'
    return linhas


GRAD = [('#F39A30', '#B5162E'), ('#0B3D6B', '#2E86C1'), ('#6D1A36', '#C0392B'), ('#3E5B2E', '#8DB255'), ('#1F7AB8', '#76D7EA'),
        ('#7D3C98', '#E59866'), ('#B9770E', '#F4D03F'), ('#145A32', '#45B39D'), ('#1B2631', '#5D6D7E')]  # mesmas cores do site
CAT_EMOJI = {'igreja': '⛪', 'fefamilia': '🏡', 'missoes': '🌍', 'mundocristao': '🕊', 'musicagospel': '🎶', 'sociedade': '🤝', 'alagoas': '🌴', 'eventos': '📅'}
EMOJI_FONTS = ['/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', '/usr/share/fonts/noto/NotoColorEmoji.ttf']
slug = lambda t: ''.join(c for c in unicodedata.normalize('NFD', str(t)).lower() if c.isalnum() and ord(c) < 128)
hexrgb = lambda h: tuple(int(h[k:k + 2], 16) for k in (1, 3, 5))


def selo(im):
    """Selo discreto da Farol FM no canto da imagem."""
    im = im.convert('RGBA'); ov = Image.new('RGBA', im.size); d = ImageDraw.Draw(ov)
    f = ImageFont.truetype(F_BOLD, 30); tw = d.textlength('Farol FM', font=f)
    d.rounded_rectangle((28, H - 96, 28 + 76 + tw + 26, H - 28), radius=34, fill=(20, 8, 12, 150)); im.alpha_composite(ov)
    im.alpha_composite(LOGO.resize((56, 56), Image.LANCZOS), (34, H - 90)); ImageDraw.Draw(im).text((100, H - 84), 'Farol FM', font=f, fill='white')
    return im.convert('RGB')


def emoji_img(ch, size):
    for fp in EMOJI_FONTS:
        if os.path.exists(fp):
            try:
                f = ImageFont.truetype(fp, 109); t = Image.new('RGBA', (160, 160)); ImageDraw.Draw(t).text((80, 80), ch, font=f, embedded_color=True, anchor='mm')
                bb = t.getbbox(); return t.crop(bb).resize((size, round(size * (bb[3] - bb[1]) / (bb[2] - bb[0]))), Image.LANCZOS) if bb else None
            except Exception: return None
    return None


def capa_padrao(p):
    """A mesma arte de capa que a matéria mostra no site quando não tem foto (degradê, ícone da editoria e nome)."""
    n = sum(ord(c) for c in str(p.get('id', ''))); c0, c1 = map(hexrgb, GRAD[n % len(GRAD)])
    im = Image.new('RGB', (W, H)); px = im.load()
    for y in range(H):
        for x in range(0, W, 2):
            t = (x / W + y / H) / 2; col = tuple(int(c0[k] + (c1[k] - c0[k]) * t) for k in range(3)); px[x, y] = col; px[min(x + 1, W - 1), y] = col
    im = im.convert('RGBA'); ov = Image.new('RGBA', (W, H)); od = ImageDraw.Draw(ov)
    od.ellipse((W * .82 - H * .45, H * .2 - H * .45, W * .82 + H * .45, H * .2 + H * .45), fill=(255, 255, 255, 18))
    od.ellipse((W * .1 - H * .35, H * .95 - H * .35, W * .1 + H * .35, H * .95 + H * .35), fill=(255, 255, 255, 15)); im.alpha_composite(ov)
    e_ = emoji_img(CAT_EMOJI.get(slug(p.get('categoria', '')), '📰'), int(H * .3))
    if e_: im.alpha_composite(e_, ((W - e_.width) // 2, int(H * .47 - e_.height / 2)))
    lab = str(p.get('categoria') or 'Notícias').upper(); f = ImageFont.truetype(F_BOLD, int(H * .06)); d = ImageDraw.Draw(im)
    lw = sum(d.textlength(ch, font=f) + 4 for ch in lab); x = (W - lw) / 2
    for ch in lab: d.text((x, H * .8), ch, font=f, fill=(255, 255, 255, 230), anchor='lm'); x += d.textlength(ch, font=f) + 4
    return selo(im)


def foto(raw):
    im = Image.open(io.BytesIO(raw)).convert('RGB'); s = max(W / im.width, H / im.height)
    im = im.resize((max(W, round(im.width * s)), max(H, round(im.height * s))), Image.LANCZOS)
    l, t = (im.width - W) // 2, (im.height - H) // 2
    return selo(im.crop((l, t, l + W, t + H)))


def bytes_da_imagem(src):
    if src.startswith('data:image'): return base64.b64decode(src.split(',', 1)[1])
    if src.startswith('http'):
        with urllib.request.urlopen(urllib.request.Request(src, headers={'User-Agent': 'FarolFM-share/1.0'}), timeout=20) as r: return r.read()
    return None


def pagina(p, img):
    pid = p['id']; alvo = f'/#post-{pid}'; t = p.get('titulo', 'Farol FM'); r = p.get('resumo') or str(p.get('corpo', ''))[:180]
    data = e(p.get('data', ''))
    return f'''<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(t)} — Farol FM</title><meta name="description" content="{e(r)}">
<link rel="canonical" href="{URL}/n/{e(pid)}/"><link rel="icon" type="image/png" href="/assets/favicon-32.png">
<meta property="og:site_name" content="Farol FM"><meta property="og:locale" content="pt_BR"><meta property="og:type" content="article">
<meta property="og:title" content="{e(t)}"><meta property="og:description" content="{e(r)}"><meta property="og:url" content="{URL}/n/{e(pid)}/">
<meta property="og:image" content="{e(img)}"><meta property="og:image:secure_url" content="{e(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="{e(t)}">
<meta property="article:published_time" content="{data}"><meta property="article:section" content="{e(p.get('categoria', ''))}"><meta property="article:author" content="{e(p.get('autor', 'Redação Farol'))}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{e(t)}"><meta name="twitter:description" content="{e(r)}"><meta name="twitter:image" content="{e(img)}">
<script type="application/ld+json">{json.dumps({"@context": "https://schema.org", "@type": "NewsArticle", "headline": t[:110], "description": r, "image": [img], "datePublished": p.get('data', ''), "articleSection": p.get('categoria', ''), "author": {"@type": "Person", "name": p.get('autor') or 'Redação Farol'}, "publisher": {"@type": "Organization", "name": "Farol FM", "logo": {"@type": "ImageObject", "url": URL + "/assets/icon-512.png"}}, "mainEntityOfPage": URL + "/n/" + pid + "/"}, ensure_ascii=False).replace('</', '<\\/')}</script>
<meta http-equiv="refresh" content="0;url={e(alvo)}"><script>location.replace({json.dumps(alvo)})</script>
<style>body{{font-family:system-ui,sans-serif;background:#FBF7F5;color:#23141A;display:grid;place-items:center;min-height:90vh;text-align:center;padding:20px}}a{{color:#B5162E;font-weight:700}}</style>
</head><body><div><img src="/assets/icon-192.png" width="72" height="72" alt="Farol FM"><h1 style="font-size:20px">{e(t)}</h1><p><a href="{e(alvo)}">Abrir a notícia na Farol FM →</a></p></div></body></html>
'''


def main():
    posts = carregar(); base = os.path.join(SITE, 'n'); n = 0
    for p in posts:
        pid = str(p.get('id', ''))
        if not pid or '/' in pid or '..' in pid: continue
        pasta = os.path.join(base, pid); os.makedirs(pasta, exist_ok=True)
        img_src = str(p.get('imagem') or ''); img = f'{URL}/n/{pid}/capa.jpg'
        try:
            raw = bytes_da_imagem(img_src); im = foto(raw) if raw else capa_padrao(p)   # a foto da matéria; sem foto, a capa do site
        except Exception as ex:
            print(f'Aviso ({pid}): imagem da matéria indisponível ({ex}); usando a capa padrão')
            if img_src.startswith('http'): im = None; img = img_src
            else: im = capa_padrao(p)
        if im: im.save(os.path.join(pasta, 'capa.jpg'), quality=86, optimize=True)
        with open(os.path.join(pasta, 'index.html'), 'w', encoding='utf-8') as f: f.write(pagina(p, img))
        n += 1
    print(f'{n} páginas de compartilhamento geradas em {base}')


if __name__ == '__main__':
    main()
