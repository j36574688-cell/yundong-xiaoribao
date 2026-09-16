// Optional Upstash Redis REST adapter.
// Falls back safely when credentials are absent or Redis is unavailable.
const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const ENABLED = Boolean(URL && TOKEN);

function safeKey(key){ return String(key).replace(/[^A-Za-z0-9:_./@-]/g,'_').slice(0,500); }

async function command(parts, timeoutMs=3500){
  if(!ENABLED) return {ok:false,disabled:true};
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),timeoutMs);
  try{
    const r=await fetch(URL,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(parts),signal:ac.signal});
    const d=await r.json().catch(()=>({}));
    if(!r.ok || d.error) return {ok:false,error:d.error||`HTTP ${r.status}`};
    return {ok:true,result:d.result};
  }catch(e){
    return {ok:false,error:String(e?.message||e)};
  }finally{ clearTimeout(timer); }
}

async function get(key){
  const r=await command(['GET',safeKey(key)]);
  return r.ok ? r.result : null;
}

async function set(key,value,ttlMs){
  const k=safeKey(key);
  const seconds=Math.max(1,Math.ceil(Number(ttlMs||0)/1000));
  return command(seconds>0?['SET',k,String(value),'EX',seconds]:['SET',k,String(value)]);
}

async function incr(key,ttlMs){
  const k=safeKey(key);
  const r=await command(['INCR',k]);
  if(r.ok && Number(r.result)===1 && ttlMs) await command(['EXPIRE',k,Math.max(1,Math.ceil(ttlMs/1000))]);
  return r.ok?Number(r.result):null;
}

async function hgetall(key){
  const r=await command(['HGETALL',safeKey(key)]);
  return r.ok ? (r.result||[]) : null;
}

async function hset(key,field,value){
  return command(['HSET',safeKey(key),String(field),String(value)]);
}

module.exports={ENABLED,get,set,incr,hgetall,hset};
