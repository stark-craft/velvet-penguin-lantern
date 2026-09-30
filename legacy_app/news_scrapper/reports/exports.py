"""Exports of the current edited snapshot; no AI calls on export."""
import base64
from io import BytesIO
from html import escape
from pathlib import Path
import os
from bs4 import BeautifulSoup
from fastapi import HTTPException
from core.settings import PROJECT_ROOT
from .document import sanitize_html, export_html


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


def export_ppt(title, soup):
    from pptx import Presentation
    from pptx.util import Inches, Pt
    path = PROJECT_ROOT / 'template.pptx'
    if not path.exists():
        raise HTTPException(409, 'Add template.pptx to the legacy_app folder to export PowerPoint.')
    deck = Presentation(str(path))
    layout = next((l for l in deck.slide_layouts if l.name == 'NewsLayout'), None)
    if layout is None:
        raise HTTPException(409, 'template.pptx needs a NewsLayout with #TITLE, #SUMMARY and #INSIGHT placeholders.')
    # Existing template slides are design samples, not report contents.
    while deck.slides:
        slide_id = deck.slides._sldIdLst[0]
        deck.part.drop_rel(slide_id.rId)
        deck.slides._sldIdLst.remove(slide_id)
    for section in soup.find_all('section', recursive=False) or [soup]:
        if section.get('data-kind') == 'article':
            heading = section.find(['h1','h2'])
            groups = {'summary': [], 'insight': [], 'team': [], 'link': [], 'date': []}
            current = 'date'
            for node in section.find_all(['h3','p','li']):
                if node.name == 'h3':
                    label = text_of(node).lower()
                    current = 'insight' if 'samsung' in label or 'matter' in label else 'team' if 'team' in label else 'summary'
                else:
                    groups[current].append(text_of(node))
            groups['link'] = [a.get('href', '') for a in section.find_all('a')]
            slide = deck.slides.add_slide(layout)
            replacements = {'#TITLE': text_of(heading) if heading else title, '#SUMMARY': '\n'.join(groups['summary']), '#INSIGHT': '\n'.join(groups['insight']), '#DATE_HERE': '\n'.join(groups['date']), '#LINK': '\n'.join(groups['link']), '#Targated_SRID_Team': '\n'.join(groups['team'])}
            for shape in slide.placeholders:
                if shape.has_text_frame:
                    original = layout.placeholders.get(shape.placeholder_format.idx)
                    marker = shape.text.strip() or (original.text.strip() if original is not None and original.has_text_frame else '')
                    for token, value in replacements.items():
                        if token in marker:
                            shape.text = value
                            shape.text_frame.word_wrap = True
                            for paragraph in shape.text_frame.paragraphs:
                                paragraph.font.size = Pt(16 if token != '#TITLE' else 24)
                elif shape.placeholder_format.type == 18:  # PICTURE
                    img = section.find('img')
                    data = image_data(img.get('src','')) if img else None
                    if data and hasattr(shape, 'insert_picture'):
                        shape.insert_picture(data)
        else:
            # Paginate opening text by content; overview and analysis are not fixed slides.
            heading = section.find(['h1','h2'])
            paragraphs = [text_of(n) for n in blocks(section) if n is not heading and n.name not in {'img','hr'}]
            chunks, current = [], ''
            for paragraph in paragraphs:
                for start in range(0, len(paragraph) or 1, 1600):
                    piece = paragraph[start:start+1600]
                    if len(current) + len(piece) > 1600:
                        chunks.append(current)
                        current = ''
                    current += piece + '\n\n'
            chunks.append(current)
            for index, chunk in enumerate(chunks):
                slide = deck.slides.add_slide(deck.slide_layouts[6] if len(deck.slide_layouts)>6 else deck.slide_layouts[0])
                box = slide.shapes.add_textbox(Inches(.6), Inches(.4), deck.slide_width-Inches(1.2), Inches(.8))
                box.text = (text_of(heading) if heading else title) + (' (continued)' if index else '')
                box.text_frame.paragraphs[0].font.size = Pt(26)
                body = slide.shapes.add_textbox(Inches(.6), Inches(1.3), deck.slide_width-Inches(1.2), deck.slide_height-Inches(1.8))
                body.text_frame.word_wrap = True
                body.text = chunk
                for p in body.text_frame.paragraphs:
                    p.font.size = Pt(17)
    out = BytesIO()
    deck.save(out)
    return out.getvalue(), 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'
