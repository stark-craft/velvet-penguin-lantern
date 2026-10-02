import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Undo2, Redo2, Bold, Italic, Underline, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, ImagePlus, Scissors, Sparkles, History, Save, X } from 'lucide-react';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';
import { reportRequest } from './reportApi.js';
import { seedReport, escapeHtml, paragraphs } from './reportModel.js';
import AskAiPanel from './AskAiPanel.jsx';
import SamsungImpactPanel from './SamsungImpactPanel.jsx';
import AutomaticAnalysisStatus from './AutomaticAnalysisStatus.jsx';
import AutomaticImpactStatus from './AutomaticImpactStatus.jsx';
import useAutomaticImpact from './useAutomaticImpact.js';
import { startReportIntelligence } from './reportStartup.js';
import { currentAnalysisInputs, analysisSignature, canApplyAnalysis } from './reportAnalysis.js';
import { prepareImpactSections, reportImpactArticles, canApplyImpact, canApplyAutomaticImpact } from './reportImpact.js';
import { IMAGE_ACCEPT, readReportImage } from './reportImages.js';
import './report-editor.css';

function documentHtml(element) {
  if(!element)return '';
  const clone=element.cloneNode(true);
  clone.querySelectorAll('[data-kind=page-break]').forEach(b=>{b.style.removeProperty('height');if(!b.getAttribute('style'))b.removeAttribute('style');});
  clone.querySelectorAll('img').forEach(image=>{
    ['data-report-selected','tabindex','role','aria-label','title'].forEach(attribute=>image.removeAttribute(attribute));
  });
  return clone.innerHTML;
}

function UnsavedPrompt({pending,busy,onContinue,onCancel}) {
  const ref=useRef(null);
  useEffect(()=>{
    const previous=document.activeElement;
    const dialog=ref.current;
    const overlay=dialog.parentElement;
    const siblings=[...overlay.parentElement.children].filter(node=>node!==overlay);
    const before=siblings.map(node=>({node,inert:node.hasAttribute('inert')}));
    siblings.forEach(node=>node.setAttribute('inert',''));
    dialog.querySelector('button')?.focus();
    const keydown=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onCancel();}
      if(e.key==='Tab'){
        const buttons=[...dialog.querySelectorAll('button:not([disabled])')];
        if(!buttons.length){e.preventDefault();dialog.focus();return;}
        if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1).focus();}
        else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0].focus();}
      }
    };
    document.addEventListener('keydown',keydown,true);
    return ()=>{document.removeEventListener('keydown',keydown,true);before.forEach(({node,inert})=>{if(!inert)node.removeAttribute('inert');});previous?.focus?.();};
  },[onCancel]);
  return <div className="sampark-report-confirm"><div ref={ref} role="alertdialog" aria-modal="true" aria-label="Unsaved changes" tabIndex={-1}><h2>Save your changes?</h2><p>{pending.kind==='export'?'Export will include your current edits either way.':'Save this private draft before continuing.'}</p><button className="sampark-report-primary" onClick={()=>onContinue(true)} autoFocus disabled={busy}>Save and continue</button><button onClick={()=>onContinue(false)} disabled={busy}>{pending.kind==='export'?'Export without saving':'Discard and continue'}</button><button onClick={onCancel} disabled={busy}>Cancel</button></div></div>;
}

export default function ReportEditor({items, onClose}) {
  const editor = useRef(null);
  const range = useRef(null);
  const imageInput = useRef(null);
  const imageTarget = useRef(null);
  const analysisToken = useRef(0);
  const analysisApply = useRef(null);
  const reportStartup = useRef(null);
  const [initial] = useState(()=>seedReport(items));
  const savedHtml = useRef('');
  const savedTitle = useRef('');
  const aiRange = useRef(null);
  const aiSelection = useRef('');
  const draft = useRef({id:null, revision:0});
  const [title,setTitle] = useState('Technology report');
  const [dirty,setDirty] = useState(true);
  const [busy,setBusy] = useState(false);
  const [imageBusy,setImageBusy] = useState(false);
  const [selectedImage,setSelectedImage] = useState(null);
  const [aiBusy,setAiBusy] = useState(false);
  const [ai,setAi] = useState(false);
  const [impact,setImpact] = useState(false);
  const [automaticAnalysis,setAutomaticAnalysis] = useState(null);
  const [selection,setSelection] = useState('');
  const [quota,setQuota] = useState(null);
  const [template,setTemplate] = useState(null);
  const [history,setHistory] = useState(null);
  const [pending,setPending] = useState(null);
  const [message,setMessage] = useState('');
  const [pageCount,setPageCount] = useState(1);
  const [pageHeight,setPageHeight] = useState(630);
  const automaticImpact=useAutomaticImpact(()=>reportImpactArticles(editor.current),applyAutomaticImpact);
  const requestClose = useCallback(()=>{if(busy || aiBusy || imageBusy) return; if(dirty) setPending({kind:'close'}); else onClose();},[busy,aiBusy,imageBusy,dirty,onClose]);
  const modal = useModalFocus(true, requestClose);
  const change = ()=>{setDirty(documentHtml(editor.current) !== savedHtml.current || title !== savedTitle.current);};
  const snapshot = ()=>({title,html:documentHtml(editor.current) || initial,...draft.current});
  useEffect(()=>{
    const startup=startReportIntelligence({
      analysis:generateAnalysis,
      impacts:automaticImpact.generate,
      cancelPending:()=>{analysisToken.current++;automaticImpact.cancel(false);},
    });
    reportStartup.current=startup;
    startup.done.catch(error=>{if(!startup.cancelled)setMessage(error.message);});
    return ()=>startup.cancel();
  },[]);
  useEffect(()=>{
    reportRequest('/status').then(data=>{setQuota(data.quota);setTemplate(data.template);}).catch(e=>setMessage(e.message));
    const beforeUnload = e=>{if(documentHtml(editor.current) !== savedHtml.current || document.querySelector('.sampark-report-meta input')?.value !== savedTitle.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',beforeUnload);
    return ()=>window.removeEventListener('beforeunload',beforeUnload);
  },[]);
  useEffect(()=>{
    if(!message) return; const timer=setTimeout(()=>setMessage(''),10000);return ()=>clearTimeout(timer);
  },[message]);
  useEffect(()=>{
    const element=editor.current;
    prepareImpactSections(element);
    const decorate=()=>{
      element.querySelectorAll('img').forEach(image=>{
        image.tabIndex=0;
        image.setAttribute('role','button');
        image.setAttribute('aria-label','Replace article image');
        image.title='Click to replace this image from your computer';
      });
      setSelectedImage(current=>current && element.contains(current) ? current : null);
    };
    decorate();
    const observer=new MutationObserver(decorate);
    observer.observe(element,{childList:true,subtree:true});
    return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const element=editor.current; if(!element) return;
    let measuring=false;
    const measure=()=>{
      if(measuring)return;measuring=true;
      const height=Math.max(400, element.clientWidth*(template?.height || 7.5)/(template?.width || 13.333));
      element.querySelectorAll('[data-kind=page-break]').forEach(b=>{
        b.style.height='0px';const offset=b.getBoundingClientRect().top-element.getBoundingClientRect().top;
        b.style.height=`${Math.max(0,height-(offset%height)-48)}px`;
      });
      setPageHeight(height);setPageCount(Math.max(1,Math.ceil(element.scrollHeight/height)));measuring=false;
    };
    const observer=new ResizeObserver(measure);observer.observe(element);measure();return ()=>observer.disconnect();
  },[template]);
  function rememberSelection() {
    const selected=window.getSelection();
    if(selected?.rangeCount && editor.current?.contains(selected.anchorNode) && editor.current?.contains(selected.focusNode)) {
      range.current=selected.getRangeAt(0).cloneRange();setSelection(selected.toString());
    }
  }
  function restoreSelection() {
    editor.current?.focus();const selected=window.getSelection();
    if(range.current && editor.current.contains(range.current.commonAncestorContainer)) {selected.removeAllRanges();selected.addRange(range.current);}
  }
  function command(name,value) {restoreSelection();document.execCommand(name,false,value);rememberSelection();change();}
  function selectImage(image) {
    editor.current.querySelectorAll('[data-report-selected]').forEach(node=>node.removeAttribute('data-report-selected'));
    if(image && editor.current.contains(image)) {
      image.setAttribute('data-report-selected','true');
      const selectionRange=document.createRange();selectionRange.selectNode(image);
      range.current=selectionRange;
      setSelectedImage(image);
    } else setSelectedImage(null);
  }
  function chooseImage() {
    if(busy || imageBusy)return;
    const image=selectedImage && editor.current.contains(selectedImage) ? selectedImage : null;
    imageTarget.current={image,src:image?.getAttribute('src'),range:range.current?.cloneRange()};
    imageInput.current.value='';
    imageInput.current.click();
  }
  async function save() {
    if(busy || imageBusy) return false;if(!title.trim()){setMessage('Enter a report filename before saving.');return false;}setBusy(true);
    const current=snapshot();
    try {const result=await reportRequest('/drafts',current);draft.current={id:result.id,revision:result.revision};savedHtml.current=current.html;savedTitle.current=current.title;setDirty(documentHtml(editor.current)!==current.html);setMessage('Private draft saved.');return true;}
    catch(e){setMessage(e.message);return false;}finally{setBusy(false);}
  }
  useEffect(()=>{
    const shortcut=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!busy) save();}};
    document.addEventListener('keydown',shortcut);return ()=>document.removeEventListener('keydown',shortcut);
  });
  async function exportFile(fmt) {
    setBusy(true);try{await reportRequest(`/export/${fmt}`,snapshot());setMessage(`${fmt.toUpperCase()} downloaded.`);}catch(e){setMessage(e.message);}finally{setBusy(false);}
  }
  function requestExport(fmt) {if(dirty) setPending({kind:'export',fmt});else exportFile(fmt);}
  async function continuePending(shouldSave) {
    const action=pending;if(shouldSave && !await save()) return;
    setPending(null);
    if(action.kind==='close') onClose();
    else if(action.kind==='open') openDraft(action.id);
    else exportFile(action.fmt);
  }
  async function openDraft(id) {
    reportStartup.current?.cancel();
    analysisToken.current++;setAutomaticAnalysis(null);automaticImpact.cancel();
    setBusy(true);try{const doc=await reportRequest(`/drafts/${id}`);selectImage(null);editor.current.innerHTML=doc.html;prepareImpactSections(editor.current);savedHtml.current=documentHtml(editor.current);savedTitle.current=doc.title;draft.current={id:doc.id,revision:doc.revision};setTitle(doc.title);setDirty(false);range.current=null;setHistory(null);setImpact(false);}catch(e){setMessage(e.message);}finally{setBusy(false);}
  }
  async function openHistory() {try{setHistory(await reportRequest('/history'));setAi(false);setImpact(false);}catch(e){setMessage(e.message);}}
  async function generateAnalysis() {
    const token=++analysisToken.current;
    const body=editor.current.querySelector('[data-kind=cross-analysis]');
    const articles=currentAnalysisInputs(editor.current,items);
    if(!body || articles.length<2){setAutomaticAnalysis(null);return;}
    if(articles.length>100){setAutomaticAnalysis({status:'error',message:'Automatic analysis supports up to 100 selected articles.'});return;}
    const target={body,before:body.innerHTML,signature:analysisSignature(articles)};
    setAutomaticAnalysis({status:'loading'});
    try {
      const result=await reportRequest('/analysis',{articles});
      if(token!==analysisToken.current)return;
      analysisApply.current(result,target);
    } catch(error) {
      if(token===analysisToken.current)setAutomaticAnalysis({status:'error',message:error.message});
    }
  }
  function applyAutomaticAnalysis(result,target,replaceEdited=false) {
    const articles=currentAnalysisInputs(editor.current,items);
    if(!canApplyAnalysis(editor.current,target,articles,true)) {
      setAutomaticAnalysis({status:'error',message:'The articles changed while analysis was generating. Retry to compare the current summaries.'});return;
    }
    if(busy || imageBusy || aiBusy || (!replaceEdited && !canApplyAnalysis(editor.current,target,articles))) {
      setAutomaticAnalysis({status:'proposal',result,target,message:'Your edits were kept. Review the generated analysis before adding it.'});return;
    }
    insertAutomaticText(target.body,result.analysis);
    setAutomaticAnalysis(null);
    setMessage('Cross-article analysis added. Your Ask AI allowance is unchanged.');
  }
  function insertAutomaticText(body,text) {
    const previousFocus=document.activeElement;
    const selected=window.getSelection();
    const previousRange=selected?.rangeCount?selected.getRangeAt(0).cloneRange():null;
    const scroll=editor.current.parentElement;
    const scrollTop=scroll.scrollTop;
    const replacement=document.createRange();replacement.selectNodeContents(body);range.current=replacement;
    command('insertHTML',paragraphs(text));
    if(previousRange && editor.current.contains(previousRange.commonAncestorContainer)) {
      selected.removeAllRanges();selected.addRange(previousRange);range.current=previousRange;
    }
    previousFocus?.focus?.({preventScroll:true});scroll.scrollTop=scrollTop;
    rememberSelection();
  }
  analysisApply.current=applyAutomaticAnalysis;
  function applyAutomaticImpact(result,target,replaceEdited=false) {
    if(!canApplyAutomaticImpact(editor.current,target,true)) {
      return {status:'error',message:'The article changed while Samsung impact was generating. Retry to use its current summary.'};
    }
    if(busy || imageBusy || aiBusy || (!replaceEdited && !canApplyAutomaticImpact(editor.current,target))) {
      return {status:'proposal',message:'Your edits were kept. Review the generated Samsung impact before adding it.'};
    }
    insertAutomaticText(target.body,result.impact);
    return {status:'applied'};
  }
  function applyImpact(text,target) {
    if(!canApplyImpact(editor.current,target)) {
      setMessage('This article changed while AI was writing. Generate again to keep your edits safe.');return false;
    }
    const replacement=document.createRange();replacement.selectNodeContents(target.body);range.current=replacement;
    command('insertHTML',paragraphs(text));
    setMessage('Samsung impact analysis applied. You can edit it or undo this change.');
    return true;
  }
  function applyPassage(text,replace) {
    const target=aiRange.current;
    if(target && editor.current.contains(target.commonAncestorContainer) && (!replace || target.toString()===aiSelection.current)) {
      range.current=target;restoreSelection();if(!replace)window.getSelection().collapseToEnd();
      document.execCommand('insertHTML',false,`<p>${escapeHtml(text).replace(/\n/g,'<br>')}</p>`);change();setMessage('AI passage applied. Undo is available.');
    } else setMessage('Select a passage or place the cursor in the report, then apply again.');
  }
  function paste(event) {
    // Plain-text paste prevents clipboard HTML injecting scripts or editor chrome.
    event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));change();
  }
  async function insertImage(event) {
    const file=event.target.files?.[0];if(!file)return;
    const target=imageTarget.current;
    setImageBusy(true);
    try {
      const data=await readReportImage(file);
      if(target?.image) {
        if(!editor.current.contains(target.image) || target.image.getAttribute('src')!==target.src) {
          setMessage('That image changed while the file was opening. Select it again to replace it.');return;
        }
        const replacement=document.createRange();replacement.selectNode(target.image);range.current=replacement;
        command('insertHTML',`<img src="${escapeHtml(data)}" alt="${escapeHtml(target.image.getAttribute('alt') || 'Article image')}" referrerpolicy="no-referrer">`);
        selectImage(null);
        setMessage('Article image replaced. You can undo this change.');
      } else {
        if(target?.range && editor.current.contains(target.range.commonAncestorContainer))range.current=target.range;
        command('insertHTML',`<img src="${escapeHtml(data)}" alt="Imported image"><p><br></p>`);
        setMessage('Image imported into the report.');
      }
    } catch(error) {setMessage(error.message);}
    finally {setImageBusy(false);event.target.value='';imageTarget.current=null;}
  }
  const tools=[['Undo','undo',Undo2],['Redo','redo',Redo2],['Bold','bold',Bold],['Italic','italic',Italic],['Underline','underline',Underline],['Bulleted list','insertUnorderedList',List],['Numbered list','insertOrderedList',ListOrdered],['Align left','justifyLeft',AlignLeft],['Align center','justifyCenter',AlignCenter],['Align right','justifyRight',AlignRight]];
  return createPortal(<div className="sampark-report-overlay"><section ref={modal} className="sampark-report-workspace" role="dialog" aria-modal="true" aria-label="Editable selected-news report" tabIndex={-1}>
    <header className="sampark-report-toolbar">
      <div className="sampark-report-tools" role="toolbar" aria-label="Document formatting">
        {tools.map(([label,cmd,Glyph])=><button key={cmd} aria-label={label} title={label} onMouseDown={e=>e.preventDefault()} onClick={()=>command(cmd)} disabled={busy}><Glyph size={17}/></button>)}
        <select aria-label="Text style" defaultValue="p" onChange={e=>command('formatBlock',e.target.value)}><option value="p">Body</option><option value="h1">Title</option><option value="h2">Heading</option><option value="h3">Subheading</option></select>
        <select aria-label="Font" defaultValue="Arial" onChange={e=>command('fontName',e.target.value)}>{['Arial','Calibri','Georgia'].map(f=><option key={f}>{f}</option>)}</select>
        <select aria-label="Font size" defaultValue="3" onChange={e=>command('fontSize',e.target.value)}>{[['2','Small'],['3','Regular'],['4','Large'],['5','Extra large']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <button title={selectedImage ? 'Replace selected image' : 'Insert image from computer'} aria-label={selectedImage ? 'Replace selected image' : 'Insert image from computer'} onMouseDown={e=>e.preventDefault()} onClick={chooseImage} disabled={busy||imageBusy}><ImagePlus size={17}/></button>
        <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} aria-label="Choose image from computer" hidden onChange={insertImage}/>
        <button aria-label="Insert page break" title="Page break" onMouseDown={e=>e.preventDefault()} onClick={()=>command('insertHTML','<hr data-kind="page-break"><p><br></p>')}><Scissors size={17}/></button>
      </div>
      <div className="sampark-report-tools"><button className="sampark-report-ai-button" onClick={()=>{setImpact(!impact);setAi(false);setHistory(null);selectImage(null);}} disabled={busy||aiBusy||imageBusy}><Sparkles size={16}/> Samsung impact</button><button className="sampark-report-ai-button" onClick={()=>{rememberSelection();aiRange.current=range.current?.cloneRange();aiSelection.current=selection;setAi(!ai);setImpact(false);setHistory(null);}} disabled={busy||aiBusy||imageBusy}><Sparkles size={16}/> Ask AI</button><button aria-label="Draft and export history" title="History" onClick={openHistory} disabled={aiBusy||imageBusy}><History size={18}/></button><button onClick={save} disabled={busy||imageBusy}><Save size={16}/>Save</button><button aria-label="Close report editor" onClick={requestClose} disabled={busy||aiBusy||imageBusy}><X size={19}/></button></div>
    </header>
    <div className="sampark-report-meta"><input aria-label="Report filename" disabled={busy} value={title} maxLength={160} onChange={e=>{setTitle(e.target.value);setDirty(true);}}/><span>{busy ? 'Working…' : dirty ? 'Unsaved changes' : 'Saved privately'} · ~{pageCount} flow page{pageCount===1?'':'s'}</span></div>
    {message && <div className="sampark-report-notice" role="status">{message}<button onClick={()=>setMessage('')} aria-label="Dismiss message">×</button></div>}
    <AutomaticAnalysisStatus state={automaticAnalysis} busy={busy||imageBusy||aiBusy} onRetry={generateAnalysis} onApply={applyAutomaticAnalysis}/>
    <AutomaticImpactStatus state={automaticImpact.state} busy={busy||imageBusy||aiBusy} onRetry={automaticImpact.generate} onApply={automaticImpact.useProposal} onKeep={automaticImpact.dismiss}/>
    {selectedImage && <div className="sampark-report-image-actions" role="group" aria-label="Selected image"><span>Article image</span><button className="sampark-report-primary" onClick={chooseImage} disabled={busy||imageBusy}><ImagePlus size={16}/>{imageBusy?'Opening image…':'Replace from computer'}</button><small>PNG, JPEG or WebP · up to 1 MB</small><button aria-label="Deselect image" onClick={()=>selectImage(null)} disabled={imageBusy}><X size={16}/></button></div>}
    <div className="sampark-report-body"><div className="sampark-report-scroll"><div className="sampark-report-document" style={{'--report-page-height':`${pageHeight}px`}} ref={editor} contentEditable={!busy} suppressContentEditableWarning tabIndex={0} role="textbox" aria-label="Report document" aria-multiline="true" onInput={change} onClick={event=>selectImage(event.target.tagName==='IMG'?event.target:null)} onKeyDown={event=>{if(event.target.tagName==='IMG' && ['Enter',' '].includes(event.key)){event.preventDefault();selectImage(event.target);}}} onMouseUp={rememberSelection} onKeyUp={rememberSelection} onPaste={paste} onDrop={e=>e.preventDefault()} dangerouslySetInnerHTML={{__html:initial}}/></div>
      {impact && <SamsungImpactPanel getArticles={()=>reportImpactArticles(editor.current)} quota={quota} setQuota={setQuota} onApply={applyImpact} onClose={()=>setImpact(false)} onBusy={setAiBusy}/>}
      {ai && <AskAiPanel quota={quota} setQuota={setQuota} selection={aiSelection.current} getContext={()=>{const sections=[...editor.current.querySelectorAll('section')];const articles=sections.filter(s=>s.dataset.kind==='article').length;const budget=Math.max(1,Math.floor((20000-sections.length*2)/Math.max(1,articles)));return sections.length?sections.map(s=>s.innerText.slice(0,s.dataset.kind==='article'?budget:5000)).join('\n\n').slice(0,30000):editor.current.innerText.slice(0,30000);}} onApply={applyPassage} onClose={()=>setAi(false)} onBusy={setAiBusy}/>}
      {history && <aside className="sampark-report-panel" aria-label="Private history"><div className="sampark-report-panel-head"><strong>Your history</strong><button onClick={()=>setHistory(null)} aria-label="Close history">×</button></div><h3>Saved drafts</h3>{!history.drafts.length&&<p>No saved drafts yet.</p>}{history.drafts.map(d=><div className="sampark-report-history-row" key={d.id}><button onClick={()=>dirty?setPending({kind:'open',id:d.id}):openDraft(d.id)}>{d.title}<small>{new Date(d.updated_at*1000).toLocaleString()}</small></button><button aria-label={`Delete ${d.title}`} onClick={async()=>{try{await reportRequest(`/drafts/${d.id}`,undefined,'DELETE');openHistory();}catch(e){setMessage(e.message);}}}>×</button></div>)}<h3>Exports</h3>{!history.exports.length&&<p>No exports yet.</p>}{history.exports.map((x,i)=><p key={i}>{x.title} · {x.format.toUpperCase()}<small>{new Date(x.at*1000).toLocaleString()}</small></p>)}</aside>}
    </div>
    <footer className="sampark-report-footer"><span>{automaticAnalysis?.status==='loading'||automaticImpact.state?.pending?'Preparing report analysis…':'Export current edits'}{template && !template.available ? ' · PPTX needs template.pptx' : ''}</span><div>{[['pdf','PDF'],['html','HTML'],['pptx','PowerPoint'],['docx','Word'],['xlsx','Excel']].map(([fmt,label])=><button key={fmt} disabled={busy||imageBusy||automaticAnalysis?.status==='loading'||!!automaticImpact.state?.pending||!title.trim()||(fmt==='pptx' && !template?.available)} onClick={()=>requestExport(fmt)}>{label}</button>)}</div></footer>
    {pending && <UnsavedPrompt pending={pending} busy={busy} onContinue={continuePending} onCancel={()=>setPending(null)} />}
  </section></div>,document.body);
}
