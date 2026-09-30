"""Self-contained integration boundary: mount /reports before the SPA fallback."""
from typing import Literal
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from news_scrapper.recommendation.identity import resolve_viewer
from news_scrapper.access_control.service import require_capability
from . import service
from .document import template_layout
from .exports import export_snapshot

router = APIRouter(prefix='/reports', tags=['private reports'])


def owner(request, response):
    require_capability(request, 'review.news.submit')
    response.headers['Cache-Control'] = 'no-store'
    return resolve_viewer(request, response)[0]


class Snapshot(BaseModel):
    title: str = Field(default='Technology report', min_length=1, max_length=160)
    html: str = Field(min_length=1, max_length=2_000_000)
    id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')
    revision: int = Field(default=0, ge=0)


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    context: str = Field(default='', max_length=30000)
    request_id: str = Field(pattern=r'^[a-zA-Z0-9-]{16,64}$')
    purpose: Literal['general', 'samsung-impact'] = 'general'


class AnalysisArticle(BaseModel):
    title: str = Field(min_length=1, max_length=1000)
    summary: str = Field(default='', max_length=20000)
    summary_truncated: bool = False
    source: str = Field(default='', max_length=500)
    date: str = Field(default='', max_length=80)
    url: str = Field(default='', max_length=2048)


class AnalysisRequest(BaseModel):
    articles: list[AnalysisArticle] = Field(min_length=2, max_length=100)


@router.get('/status')
def status(request: Request, response: Response):
    key = owner(request, response)
    return {'quota': service.quota(key), 'template': template_layout()}


@router.get('/history')
def history(request: Request, response: Response):
    return service.history(owner(request, response))


@router.get('/drafts/{identifier}')
def get_draft(identifier: str, request: Request, response: Response):
    return service.get_draft(owner(request, response), identifier)


@router.post('/drafts')
def save(payload: Snapshot, request: Request, response: Response):
    return service.save(owner(request, response), payload.title, payload.html, payload.id, payload.revision)


@router.delete('/drafts/{identifier}')
def delete(identifier: str, request: Request, response: Response):
    service.delete(owner(request, response), identifier)
    return {'ok': True}


@router.post('/ask')
def ask(payload: Question, request: Request, response: Response):
    return service.ask(owner(request, response), payload.question, payload.context, payload.request_id, payload.purpose)


@router.post('/analysis')
def analysis(payload: AnalysisRequest, request: Request, response: Response):
    from .analysis import generate
    return generate(owner(request, response), [a.model_dump() for a in payload.articles])


@router.post('/impact')
def impact(payload: AnalysisArticle, request: Request, response: Response):
    from .impact import generate
    return generate(owner(request, response), payload.model_dump())


@router.post('/export/{fmt}')
def export(fmt: Literal['html','pdf','docx','xlsx','pptx'], payload: Snapshot, request: Request, response: Response):
    key = owner(request, response)
    binary, mime, extension = export_snapshot(fmt, payload.title, payload.html)
    service.record_export(key, payload.title, fmt)
    headers = {'Content-Disposition': f'attachment; filename="Sampark-report.{extension}"', 'Cache-Control': 'no-store'}
    if response.headers.get('set-cookie'):
        headers['set-cookie'] = response.headers['set-cookie']
    return Response(binary, media_type=mime, headers=headers)
