import { useRef, useState } from 'react';
import { reportRequest } from './reportApi.js';
import { automaticImpactTarget } from './reportImpact.js';

// Queue fixed report sections so large selections do not burst the Chat adapter.
export default function useAutomaticImpact(getArticles, onApply) {
  const token=useRef(0);
  const completed=useRef(new Set());
  const apply=useRef(onApply);
  apply.current=onApply;
  const [state,setState]=useState(null);

  function cancel(clear=true) {
    token.current++;
    completed.current.clear();
    if(clear)setState(null);
  }

  async function generate() {
    const generation=++token.current;
    const articles=getArticles();
    if(articles.length>100) {
      setState({pending:null,issues:[{message:'Automatic Samsung impact supports up to 100 selected articles.',status:'error'}]});return;
    }
    const targets=articles.filter(item=>!completed.current.has(item.body)).map(automaticImpactTarget);
    const proposals=state?.issues.filter(issue=>issue.status==='proposal') || [];
    if(!targets.length){setState(proposals.length?{pending:null,issues:proposals}:null);return;}
    setState({pending:{index:1,total:targets.length,title:targets[0].title},issues:proposals});
    for(let index=0;index<targets.length;index++) {
      if(generation!==token.current)return;
      const target=targets[index];
      setState(current=>({...current,pending:{index:index+1,total:targets.length,title:target.title}}));
      try {
        const result=await reportRequest('/impact',target.input);
        if(generation!==token.current)return;
        const outcome=apply.current(result,target);
        if(outcome.status!=='error')completed.current.add(target.body);
        if(outcome.status!=='applied')setState(current=>({...current,issues:[...current.issues,{...outcome,target,result}]}));
      } catch(error) {
        if(generation!==token.current)return;
        // A missing summary skips that article; connection failures pause the queue.
        setState(current=>({...current,pending:error.status===422?current.pending:null,issues:[...current.issues,{status:'error',target,message:error.message}]}));
        if(error.status!==422)return;
      }
    }
    setState(current=>current.issues.length?{...current,pending:null}:null);
  }

  function useProposal(issue) {
    const outcome=apply.current(issue.result,issue.target,true);
    if(outcome.status==='applied') {
      completed.current.add(issue.target.body);
      dismiss(issue);
    } else {
      if(outcome.status==='error')completed.current.delete(issue.target.body);
      setState(current=>({...current,issues:current.issues.map(row=>row===issue?{...issue,...outcome}:row)}));
    }
  }

  function dismiss(issue) {
    if(issue.target)completed.current.add(issue.target.body);
    setState(current=>{
      const issues=current.issues.filter(row=>row!==issue);
      return issues.length || current.pending ? {...current,issues} : null;
    });
  }

  return {state,generate,cancel,useProposal,dismiss};
}
