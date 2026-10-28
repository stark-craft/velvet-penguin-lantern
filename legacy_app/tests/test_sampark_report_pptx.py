"""Regression tests for both Sampark PowerPoint exports (no proprietary PPTX)."""
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch

from bs4 import BeautifulSoup
from fastapi import HTTPException
from pptx import Presentation
from pptx.util import Inches

from news_scrapper.reports import exports, pptx_render


ARTICLE_HTML = """
<section data-kind="overview">
 <h1>Executive summary</h1><p>Opening analysis must not be a slide.</p>
</section>
<section data-kind="article">
 <h2>OpenAI launches an AI assistant</h2><p>TechCrunch · 2026-10-28</p>
 <div><h3>Summary</h3><div data-kind="article-summary">
  <p>First important summary sentence.</p><p>Second important summary sentence.</p>
 </div>
 <div data-kind="samsung-impact"><h3>Why this matters to Samsung</h3>
  <div data-kind="impact-body"><p>Samsung device teams may monitor the change.</p></div>
 </div>
 <h3>Relevant teams</h3><p>AI Research</p>
 <p><a href="https://example.org/first">Open original article</a></p>
 </div>
</section>
<section data-kind="article">
 <h2>Meta expands its AI research investment</h2><p>Reuters · 2026-10-27</p>
 <div><h3>Summary</h3><div data-kind="article-summary">
 <p>Second article summary.</p></div>
 <div data-kind="samsung-impact"><h3>Why this matters to Samsung</h3>
 <div data-kind="impact-body"><p>Samsung may assess competitive implications.</p></div>
 </div>
 <h3>Relevant teams</h3><p>Device Solutions</p>
 <p><a href="https://example.org/second">Open original article</a></p></div>
</section>
"""


def add_placeholder(layout, number, marker, *, x, y, width, height):
    """Create a layout placeholder using a safe clone of its existing BODY item."""
    node = deepcopy(layout.placeholders[1]._element)
    nv = node.xpath("./p:nvSpPr/p:cNvPr")[0]
    nv.set("id", str(80 + number))
    nv.set("name", "Regression placeholder " + str(number))
    ph = node.xpath("./p:nvSpPr/p:nvPr/p:ph")[0]
    ph.set("idx", str(number))
    layout._element.spTree.append(node)
    shape = next(p for p in layout.placeholders if p.placeholder_format.idx == number)
    shape.text = marker
    shape.left = Inches(x)
    shape.top = Inches(y)
    shape.width = Inches(width)
    shape.height = Inches(height)


def make_template(root, *, first=True, samples=3):
    deck = Presentation()
    first_layout, regular = deck.slide_layouts[1], deck.slide_layouts[2]
    first_layout.name = "NewsLayoutFirst" if first else "UnusedLayout"
    regular.name = "NewsLayout"
    for layout in (first_layout, regular):
        layout.placeholders[0].text = "#TITLE"
        layout.placeholders[0].left = Inches(1.75)
        layout.placeholders[0].top = Inches(1.1)
        layout.placeholders[0].width = Inches(9.5)
        layout.placeholders[0].height = Inches(.75)
        layout.placeholders[1].text = "#SUMMARY"
        layout.placeholders[1].left = Inches(1.75)
        layout.placeholders[1].top = Inches(1.95)
        layout.placeholders[1].width = Inches(7.48)
        layout.placeholders[1].height = Inches(2.15)
        for idx, token, y, height in (
            (13, "#INSIGHT", 4.4, .65),
            (14, "#Targated_SRID_Team", 5.15, .45),
            (15, "#LINK", 6.677, .293),
        ):
            add_placeholder(layout, idx, token, x=.86 if idx == 15 else 1.75,
                            y=y, width=11.99 if idx == 15 else 9.5, height=height)
    add_placeholder(first_layout, 16, "#DATE_HERE", x=8.3, y=1.22,
                    width=3.43, height=.35)
    for i in range(samples):
        deck.slides.add_slide(first_layout if i % 2 == 0 else regular)
    deck.save(root / "template.pptx")


class SamparkPowerPointTests(TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        make_template(self.root)
        root_patch = patch.object(exports, "PROJECT_ROOT", self.root)
        image_patch = patch.object(exports, "image_data", return_value=None)
        root_patch.start()
        image_patch.start()
        self.addCleanup(root_patch.stop)
        self.addCleanup(image_patch.stop)

    def get_deck(self, html=ARTICLE_HTML):
        binary, mime, ext = exports.export_snapshot("pptx", "Selected news", html)
        self.assertEqual(mime, pptx_render.PPTX_MIME)
        self.assertEqual(ext, "pptx")
        return Presentation(BytesIO(binary))

    def test_removes_three_sample_slides_and_no_cover_or_overview(self):
        self.assertEqual(len(Presentation(self.root / "template.pptx").slides), 3)
        deck = self.get_deck()
        self.assertEqual(len(deck.slides), 2)
        self.assertEqual(
            [s.slide_layout.name for s in deck.slides],
            ["NewsLayoutFirst", "NewsLayout"],
        )
        self.assertIn("OpenAI launches", deck.slides[0].placeholders[0].text)
        self.assertIn("Meta expands", deck.slides[1].placeholders[0].text)
        self.assertNotIn("Executive summary", " ".join(
            shape.text for slide in deck.slides for shape in slide.shapes if shape.has_text_frame
        ))
        self.assertEqual(len(Presentation(self.root / "template.pptx").slides), 3)
        self.assertIn("article-first", deck.core_properties.subject)

    def test_entire_headline_blue_bold_linked_black_byline_unlinked(self):
        slide = self.get_deck().slides[0]
        paragraph = slide.placeholders[0].text_frame.paragraphs[0]
        self.assertEqual(len(paragraph.runs), 2)
        headline, byline = paragraph.runs
        self.assertEqual(headline.text, "OpenAI launches an AI assistant")
        self.assertEqual(headline.hyperlink.address, "https://example.org/first")
        self.assertEqual(str(headline.font.color.rgb), "0070C0")
        self.assertTrue(headline.font.bold)
        self.assertFalse(headline.font.underline)
        self.assertEqual(headline.font.name, "Calibri")
        self.assertEqual(byline.text, " By TechCrunch")
        self.assertEqual(str(byline.font.color.rgb), "000000")
        self.assertFalse(byline.font.bold)
        self.assertIsNone(byline.hyperlink.address)
        self.assertEqual(slide.placeholders[15].text, "https://example.org/first")
        self.assertEqual(
            slide.placeholders[15].text_frame.paragraphs[0].runs[0].hyperlink.address,
            "https://example.org/first",
        )

    def test_two_long_summary_bullets_remain_inside_container(self):
        long = "A very long paragraph about technology and future devices. " * 100
        html = ARTICLE_HTML.replace("First important summary sentence.", long).replace(
            "Second important summary sentence.", long
        )
        slide = self.get_deck(html).slides[0]
        shape = slide.placeholders[1]
        paras = shape.text_frame.paragraphs
        self.assertEqual(len(paras), 2)
        self.assertTrue(all(p.text.startswith("• ") for p in paras))
        self.assertEqual(shape.width, Inches(7.48))
        pt = paras[0].runs[0].font.size.pt
        self.assertGreaterEqual(pt, 10)
        self.assertTrue(pptx_render._fits("\n".join(p.text for p in paras), shape, pt))
        self.assertIn("…", shape.text)


    def test_four_short_summary_bullets_are_preserved(self):
        four = (
            "<p>GPUs are becoming more efficient.</p>"
            "<p>New designs improve memory bandwidth.</p>"
            "<p>Training costs are decreasing.</p>"
            "<p>Research groups are evaluating deployment.</p>"
        )
        html = ARTICLE_HTML.replace(
            "<p>First important summary sentence.</p><p>Second important summary sentence.</p>",
            four,
        )
        slide = self.get_deck(html).slides[0]
        shape = slide.placeholders[1]
        paragraphs = shape.text_frame.paragraphs
        self.assertEqual(len(paragraphs), 4)
        self.assertTrue(all(para.text.startswith("• ") for para in paragraphs))
        self.assertIn("Research groups are evaluating deployment.", paragraphs[3].text)
        pt = paragraphs[0].runs[0].font.size.pt
        self.assertTrue(pptx_render._fits("\n".join(para.text for para in paragraphs),
                                           shape, pt))

    def test_long_summary_can_create_up_to_four_sentence_bullets(self):
        prose = (
            "GPUs enable new training approaches. "
            "Compute clusters require faster interconnects. "
            "Memory bandwidth is also changing. "
            "Teams are measuring performance at scale. "
            "This fifth sentence should not become another bullet."
        )
        html = ARTICLE_HTML.replace(
            "<p>First important summary sentence.</p><p>Second important summary sentence.</p>",
            "<p>" + prose + "</p>",
        )
        slide = self.get_deck(html).slides[0]
        self.assertEqual(len(slide.placeholders[1].text_frame.paragraphs), 4)

    def test_link_displays_full_url_and_keeps_clickable_target_when_wrapped(self):
        url = "https://example.org/technology/" + ("new-data-center-ai-research-" * 10)
        html = ARTICLE_HTML.replace("https://example.org/first", url)
        slide = self.get_deck(html).slides[0]
        shape = slide.placeholders[15]
        paragraph = shape.text_frame.paragraphs[0]
        self.assertEqual(shape.text.replace("\v", ""), url)
        self.assertTrue(all(run.hyperlink.address == url for run in paragraph.runs))
        layout_link = slide.slide_layout.placeholders[15]
        self.assertEqual((shape.left, shape.top, shape.width),
                         (layout_link.left, layout_link.top, layout_link.width))
        self.assertGreater(shape.height, Inches(.293))
        self.assertLess(shape.top + shape.height, Inches(7.5))
        self.assertIn("\v", paragraph.text)

    def test_short_link_stays_in_layout_link_position(self):
        deck = self.get_deck()
        for slide in deck.slides:
            link = slide.placeholders[15]
            layout_link = slide.slide_layout.placeholders[15]
            self.assertEqual((link.left, link.top, link.width),
                             (layout_link.left, layout_link.top, layout_link.width))
            self.assertGreater(link.width, Inches(10))
            self.assertGreater(link.left, 0)

    def test_insight_has_one_prefix_even_for_already_labeled_input(self):
        slide = self.get_deck().slides[0]
        self.assertEqual(slide.placeholders[13].text,
                         "Insight : Samsung device teams may monitor the change.")
        html = ARTICLE_HTML.replace(
            "Samsung device teams may monitor the change.",
            "Insight : Samsung device teams may monitor the change.",
        )
        slide = self.get_deck(html).slides[0]
        self.assertEqual(slide.placeholders[13].text,
                         "Insight : Samsung device teams may monitor the change.")

    def test_first_slide_date_is_abbreviated_month_and_year(self):
        slide = self.get_deck().slides[0]
        self.assertEqual(slide.placeholders[16].text, "Oct’ 26")
        self.assertEqual(pptx_render._format_slide_date("2026-10-27"), "Oct’ 26")
        self.assertEqual(pptx_render._format_slide_date("2026-10-27T10:30:00Z"), "Oct’ 26")

    def test_existing_team_marker_displays_key_technology_not_team_name(self):
        slide = self.get_deck().slides[0]
        self.assertEqual(slide.placeholders[14].text,
                         "Key Technology: Artificial Intelligence")
        self.assertNotIn("AI Research", slide.placeholders[14].text)
        self.assertEqual(pptx_render._key_technology({
            "title": "GPU breakthrough",
            "keywords_found": ["GPU", "Nvidia"],
            "category": "Tech News",
        }), "GPUs")
        self.assertEqual(pptx_render._key_technology({
            "title": "A partnership announcement",
            "category": "Tech News",
        }), "Not specified")

    def test_long_titles_fit_with_blue_link_on_whole_headline(self):
        long_title = "Nvidia and Meta deepen AI partnership with long-term commitments " * 9
        html = ARTICLE_HTML.replace("OpenAI launches an AI assistant", long_title)
        slide = self.get_deck(html).slides[0]
        shape = slide.placeholders[0]
        runs = shape.text_frame.paragraphs[0].runs
        self.assertEqual(len(runs), 2)
        self.assertIn("…", runs[0].text)
        self.assertTrue(runs[0].text.startswith("Nvidia and Meta"))
        self.assertTrue(runs[0].font.bold)
        self.assertEqual(str(runs[0].font.color.rgb), "0070C0")
        self.assertEqual(runs[0].hyperlink.address, "https://example.org/first")
        self.assertTrue(pptx_render._fits(shape.text, shape, runs[0].font.size.pt, True))

    def test_standard_placeholder_preserves_master_color_and_font(self):
        from pptx.dml.color import RGBColor
        deck = Presentation(self.root / "template.pptx")
        for layout in (deck.slide_layouts[1], deck.slide_layouts[2]):
            marker = layout.placeholders[1].text_frame.paragraphs[0].runs[0]
            marker.font.name = "Malgun Gothic"
            marker.font.color.rgb = RGBColor(45, 62, 91)
            marker.font.size = None
        deck.save(self.root / "template.pptx")
        slide = self.get_deck().slides[0]
        run = slide.placeholders[1].text_frame.paragraphs[0].runs[0]
        self.assertEqual(run.font.name, "Malgun Gothic")
        self.assertEqual(str(run.font.color.rgb), "2D3E5B")

    def test_missing_insight_calls_samsung_provider_not_a_failure_string(self):
        html = ARTICLE_HTML.replace(
            "Samsung device teams may monitor the change.",
            "Insight generation unavailable.",
        )
        with patch.object(pptx_render, "_samsung_slide_insight",
                          return_value="Samsung could evaluate potential device AI implications.") as chat:
            slide = self.get_deck(html).slides[0]
        self.assertEqual(chat.call_count, 1)
        self.assertIn("Samsung could evaluate", slide.placeholders[13].text)
        self.assertNotIn("unavailable", slide.placeholders[13].text)

    def test_missing_samsung_chat_fails_visibly_not_silently(self):
        html = ARTICLE_HTML.replace(
            "Samsung device teams may monitor the change.", "Insight generation unavailable."
        )
        with patch.object(pptx_render, "_samsung_slide_insight",
                          side_effect=HTTPException(503, "Configure Samsung Chat")):
            with self.assertRaises(HTTPException) as raised:
                self.get_deck(html)
        self.assertEqual(raised.exception.status_code, 503)

    def test_missing_required_layout_fails_clearly(self):
        make_template(self.root, first=False)
        with self.assertRaises(HTTPException) as raised:
            self.get_deck()
        self.assertEqual(raised.exception.status_code, 409)

    def test_draft_export_accepts_newsitems_via_common_renderer(self):
        news = [
            dict(title="Nvidia and Meta deepen AI partnership",
                 source="TechCrunch", link="https://example.org/a",
                 summary="Partnership includes data center work.",
                 insight="Samsung may monitor AI hardware demand.",
                 team="Hardware Team", date="2026-10-28", image=""),
        ]
        result = pptx_render.render_articles_pptx(
            news, self.root / "template.pptx", lambda _: None
        )
        deck = Presentation(BytesIO(result))
        self.assertEqual(len(deck.slides), 1)
        self.assertEqual(deck.slides[0].slide_layout.name, "NewsLayoutFirst")
        self.assertEqual(deck.slides[0].placeholders[0].text_frame.paragraphs[0].runs[0].text,
                         news[0]["title"])


if __name__ == "__main__":
    main()
