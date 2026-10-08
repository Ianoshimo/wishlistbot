#!/usr/bin/env python3
"""Собирает Продукт/гид-печать.html из презентации: тёмная тема, страница 390x844,
каждый слайд - отдельная страница, длинные - разбиты по SPLIT.
После правок презентации: python3 гид-печать-сборка.py, затем проверить высоты страниц
(<= 844px) в браузере на 390x844 и напечатать PDF (команда - в комментарии гид-печать.html)."""
import json, re, sys
from html.parser import HTMLParser

import os
ROOT = os.path.dirname(os.path.abspath(__file__)) + "/"
SRC = ROOT + "презентация-для-пользователей.html"
OUT = ROOT + "гид-печать.html"

# Разбивка: id слайда -> список страниц. Страница: {"text": [индексы детей .text] | "all" | None,
# "faq": [индексы <details>] (только для FAQ), "phone": bool}. Нет в словаре - одна страница целиком.
DEFAULT_SPLIT = '''{"start": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "create": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "manage": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "payout": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "money-own": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "book": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "money-give": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "together": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "calendar": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "thanks": [{"text": "all", "phone": false}, {"text": null, "phone": true}], "faq": [{"text": [0, 1, 2], "faq": [0, 1, 2, 3]}, {"text": [2], "faq": [4, 5, 6]}, {"text": [2], "faq": [7, 8, 9]}]}'''
SPLIT = json.loads(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SPLIT)

src = open(SRC, encoding="utf-8").read()
head_css = re.search(r"<style>\n(.*?)</style>", src, re.S).group(1)
sections = re.findall(r'(<section class="slide" id="([^"]+)"[^>]*>.*?</section>)', src, re.S)


def top_children(fragment):
    """Делит HTML-фрагмент на прямых детей верхнего уровня."""
    out, depth, start, i = [], 0, None, 0
    tag_re = re.compile(r"<(/?)([a-zA-Z0-9]+)[^>]*?(/?)>")
    void = {"br", "img", "input", "meta", "link", "hr"}
    for m in tag_re.finditer(fragment):
        closing, name, selfclose = m.group(1), m.group(2).lower(), m.group(3)
        if name in void or selfclose:
            continue
        if not closing:
            if depth == 0:
                start = m.start()
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                out.append(fragment[start:m.end()])
    return out


def inner_of(html, cls):
    """Содержимое первого элемента с данным классом (div), с учётом вложенности."""
    m = re.search(r'<div class="%s"[^>]*>' % cls, html)
    if not m:
        return None, None
    depth, pos = 1, m.end()
    for t in re.finditer(r"<(/?)div\b[^>]*>", html[pos:]):
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return m.group(0), html[pos:pos + t.start()]
    raise ValueError(cls)


pages = []
for sec, sid in sections:
    _, text_inner = inner_of(sec, "text")
    phone_open, phone_inner = inner_of(sec, "phone")
    kids = top_children(text_inner)
    spec = SPLIT.get(sid, [{"text": "all", "phone": True}])
    for n, pg in enumerate(spec):
        parts = []
        t = pg.get("text")
        if t == "all":
            chosen = list(range(len(kids)))
        else:
            chosen = t or []
        if n > 0 and 0 not in chosen:
            # Продолжение: повторяем строку-счётчик с пометкой.
            cnt = kids[0].replace("</span>", " · продолжение</span>", 1)
            parts.append(cnt)
        for i in chosen:
            k = kids[i]
            if "faq" in pg and 'class="faq"' in k:
                dets = re.findall(r"<details>.*?</details>", k, re.S)
                k = '<div class="faq">' + "".join(dets[j] for j in pg["faq"]) + "</div>"
            parts.append(k)
        body = '<div class="text">' + "\n".join(parts) + "</div>" if parts else ""
        if pg.get("phone") and phone_inner is not None:
            body += "\n" + phone_open + phone_inner + "</div>"
        pages.append('<section class="page" data-id="%s-%d">\n%s\n</section>' % (sid, n + 1, body))

print_css = """
@page { size: 390px 844px; margin: 0; }
html, body { width: 390px; margin: 0; background: var(--bg); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-size: 15.5px; line-height: 1.5; }
.page { box-sizing: border-box; width: 390px; height: 844px; overflow: hidden; padding: 30px 18px 26px; display: flex; flex-direction: column; justify-content: center; gap: 22px; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.page .text { gap: 13px; }
h1 { font-size: 34px; }
h2 { font-size: 25px; }
.lead { font-size: 16.5px; margin-top: 10px; }
.note, .warnnote { font-size: 14px; }
.steps { gap: 11px; }
.points { gap: 10px; }
.phone { box-shadow: none; max-width: 354px; }
.faq { gap: 8px; }
.faq details { padding: 11px 14px; }
.faq details p { margin-top: 6px; font-size: 14px; }
.faq summary::after, .faq details[open] summary::after { content: ""; }
.cta { padding: 13px 20px; font-size: 16px; }
"""

doc = """<!doctype html>
<html lang="ru" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=390">
<title>Гид по Whish Helper — печать</title>
<!-- Печатная версия презентации-для-пользователей.html (PDF под экран телефона).
     Собрана скриптом из презентации; печать:
     "Google Chrome for Testing" --headless --disable-gpu --no-pdf-header-footer
       --virtual-time-budget=8000 --print-to-pdf=гид-whish-helper-тёмный-моб.pdf file://.../гид-печать.html -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700&family=Golos+Text:wght@400;500;600;700&display=swap">
<style>
%s
%s
</style>
</head>
<body>
%s
</body>
</html>
""" % (head_css, print_css, "\n\n".join(pages))
doc = doc.replace("<details>", "<details open>")
open(OUT, "w", encoding="utf-8").write(doc)
print("pages:", len(pages))
