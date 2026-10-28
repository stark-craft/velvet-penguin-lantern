"""Exports of the current edited snapshot; no AI calls on export."""
import base64
from io import BytesIO
from html import escape
from pathlib import Path
import os
from bs4 import BeautifulSoup
from fastapi import HTTPException
from core.settings import PROJECT_ROOT
from .document import sanitize_html, export_html, safe_url


def image_data(url):
    if url.startswith('data:image/'):
        try:
            raw = base64.b64decode(url.split(',', 1)[1], validate=True)
            from PIL import Image
            image = Image.open(BytesIO(raw))
            if image.width * image.height > 40000000:
                return None
            out = BytesIO()
            image.convert('RGB').save(out, format='PNG')
            out.seek(0)
            return out
        except Exception:
            return None
    # Reuse the established public-URL, redirect, TLS and size protections.
    from news_scrapper.application import download_image_for_export
    return download_image_for_export(url) if url else None


def blocks(soup):
    for node in soup.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'blockquote', 'img', 'hr', 'div']):
        if node.name == 'div' and node.find(['h1','h2','h3','h4','p','li','blockquote','img','hr','div']):
            continue
        if node.name in {'p', 'div'} and node.find_parent(['li','blockquote']):
            continue
        yield node


def text_of(node):
    return node.get_text(' ', strip=True)


def pdf_inline(node):
    if isinstance(node, str):
        return escape(node)
    contents = ''.join(pdf_inline(child) for child in node.children)
    name = {'strong':'b','em':'i'}.get(node.name, node.name)
    if name in {'b','i','u','s'}:
        return f'<{name}>{contents}</{name}>'
    if name == 'br':
        return '<br/>'
    if name == 'a' and node.get('href'):
        return f'<a href="{escape(node["href"], quote=True)}">{contents}</a>'
    return contents


def pdf_fonts(styles):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    paths = [Path(os.getenv('WINDIR', 'C:/Windows'))/'Fonts'/'malgun.ttf', Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]
    font = next((p for p in paths if p.exists()), None)
    if font:
        if 'SamparkReport' not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont('SamparkReport', str(font)))
            pdfmetrics.registerFontFamily('SamparkReport', normal='SamparkReport', bold='SamparkReport', italic='SamparkReport', boldItalic='SamparkReport')
        for style in styles.byName.values():
            style.fontName = 'SamparkReport'


def export_snapshot(fmt, title, html):
    soup = BeautifulSoup(sanitize_html(html), 'html.parser')
    out = BytesIO()
    if fmt == 'html':
        return export_html(str(soup), title).encode(), 'text/html', 'html'
    if fmt == 'pdf':
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.pagesizes import A4, landscape
        styles = getSampleStyleSheet()
        pdf_fonts(styles)
        flow = []
        for node in blocks(soup):
            if node.name == 'hr' and node.get('data-kind') == 'page-break':
                flow.append(PageBreak())
            elif node.name == 'img':
                data = image_data(node.get('src', ''))
                if data:
                    img = Image(data)
                    factor = min(280 / img.imageWidth, 190 / img.imageHeight)
                    img.drawWidth, img.drawHeight = img.imageWidth * factor, img.imageHeight * factor
                    flow.extend([img, Spacer(1, 10)])
            else:
                txt = pdf_inline(node) or '<br/>'
                if node.name == 'li':
                    txt = '• ' + txt
                style = styles[{'h1':'Title', 'h2':'Heading1', 'h3':'Heading2', 'h4':'Heading3'}.get(node.name, 'BodyText')]
                flow.extend([Paragraph(txt, style), Spacer(1, 8)])
        SimpleDocTemplate(out, pagesize=landscape(A4), title=title, leftMargin=40, rightMargin=40, topMargin=36, bottomMargin=36).build(flow)
        return out.getvalue(), 'application/pdf', 'pdf'
    if fmt == 'docx':
        from docx import Document
        from docx.shared import Inches
        doc = Document()
        section = doc.sections[0]
        section.page_width, section.page_height = Inches(11.7), Inches(8.3)
        for node in blocks(soup):
            if node.name == 'hr' and node.get('data-kind') == 'page-break':
                doc.add_page_break()
            elif node.name == 'img':
                data = image_data(node.get('src', ''))
                if data:
                    doc.add_picture(data, width=Inches(3.5))
            elif node.name.startswith('h'):
                doc.add_heading(text_of(node), level=min(int(node.name[1]), 4))
            else:
                para = doc.add_paragraph(style='List Bullet' if node.name == 'li' else None)
                for child in node.descendants:
                    if isinstance(child, str):
                        run = para.add_run(child)
                        parents = [p.name for p in child.parents if p is not node]
                        run.bold = bool({'b','strong'} & set(parents))
                        run.italic = bool({'i','em'} & set(parents))
                        run.underline = 'u' in parents
        doc.save(out)
        return out.getvalue(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'
    if fmt == 'xlsx':
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font
        book = Workbook()
        sheet = book.active
        sheet.title = 'Edited report'
        sheet.append(['Section', 'Content', 'Source URL'])
        for node in blocks(soup):
            if node.name in {'img', 'hr'}:
                continue
            parent = node.find_parent('section')
            link = node.find('a')
            values = [(parent or {}).get('data-kind', 'report'), text_of(node), link.get('href','') if link else '']
            # Untrusted article text must not become spreadsheet formulas.
            sheet.append(["'"+v if v.startswith(('=', '+', '-', '@')) else v for v in values])
        sheet.column_dimensions['A'].width = 18
        sheet.column_dimensions['B'].width = 100
        sheet.column_dimensions['C'].width = 55
        for row in sheet:
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical='top')
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        book.save(out)
        return out.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'
    if fmt == 'pptx':
        return export_ppt(title, soup)
    raise HTTPException(422, 'Unsupported export format.')

def _pptx_article(section):
    """Extract one article from the editor's current (sanitized) HTML snapshot."""
    heading = section.find(["h1", "h2"])
    metadata = heading.find_next_sibling("p") if heading else None
    meta = text_of(metadata) if metadata else ""
    source, separator, date = meta.rpartition(" · ")
    if not separator:
        source, date = meta, ""

    def region(kind):
        area = section.find(attrs={"data-kind": kind})
        return [
            text_of(node) for node in area.find_all(["p", "li"])
            if not node.find_parent("li")
        ] if area else []

    def after(label):
        h3 = next(
            (node for node in section.find_all("h3") if label in text_of(node).casefold()),
            None,
        )
        if h3 is None:
            return []
        result = []
        for node in h3.next_siblings:
            if getattr(node, "name", None) in ("h1", "h2", "h3", "h4"):
                break
            if getattr(node, "name", None) in ("p", "li") and not node.find("a", href=True):
                result.append(text_of(node))
        return result

    links = [a for a in section.find_all("a", href=True) if safe_url(a.get("href"))]
    preferred = next(
        (a for a in links if "original article" in text_of(a).casefold()),
        links[0] if links else None,
    )
    return {
        "title": text_of(heading) if heading else "Untitled article",
        "source": source.strip(),
        "date": date.strip(),
        "summary": " ".join(region("article-summary") or after("summary")),
        "summary_points": region("article-summary") or after("summary"),
        "insight": " ".join(region("impact-body") or after("samsung")),
        "team": " ".join(after("team")),
        "link": safe_url(preferred.get("href")) if preferred else "",
        "image": section.find("img").get("src", "") if section.find("img") else "",
    }


def export_ppt(title, soup):
    from .pptx_render import render_articles_pptx, PPTX_MIME

    articles = [_pptx_article(s) for s in soup.select('section[data-kind="article"]')]
    output = render_articles_pptx(
        articles, PROJECT_ROOT / "template.pptx", image_loader=image_data
    )
    return output, PPTX_MIME, "pptx"
