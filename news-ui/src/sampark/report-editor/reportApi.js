import { fetchWithTimeout } from '../../shared/api/requestTimeout.js';
export async function reportRequest(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetchWithTimeout(`/reports${path}`, {method, headers: body === undefined ? {} : {'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)})}, ['/ask','/analysis','/impact'].includes(path) ? 420000 : path.startsWith('/export') ? 300000 : 60000);
  if (!response.ok) {
    const data = await response.json().catch(()=>({}));
    const detail = data.detail;
    const error = new Error(typeof detail === 'string' ? detail : detail?.message || `Report request failed (${response.status}).`);
    error.quota = detail?.quota;
    error.status = response.status;
    if(error.quota)error.quota.clock_offset=error.quota.server_now-Date.now()/1000;
    throw error;
  }
  if (path.startsWith('/export')) {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`Sampark-report.${path.split('/').pop()}`;
    document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 30000);
    return;
  }
  const data=await response.json();
  if(data.quota)data.quota.clock_offset=data.quota.server_now-Date.now()/1000;
  return data;
}
