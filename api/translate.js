// Vercel Serverless Function: robust title translation plugin for 運動小日報.
// Never exposes provider error text as a translation.

function cleanText(s){return String(s??'').replace(/\s+/g,' ').trim();}

function detectLang(q){
  if(/[\uac00-\ud7af]/.test(q)) return 'ko';
  if(/[\u3040-\u30ff]/.test(q)) return 'ja';
  if(/[A-Za-z]/.test(q)) return 'en';
  return 'und';
}

function looksChinese(q){
  const han=(q.match(/[\u3400-\u9fff]/g)||[]).length;
  const kana=(q.match(/[\u3040-\u30ff]/g)||[]).length;
  const hangul=(q.match(/[\uac00-\ud7af]/g)||[]).length;
  const latin=(q.match(/[A-Za-z]/g)||[]).length;
  if(kana>0 || hangul>0) return false;
  return han>=2 && han>=Math.max(2,Math.floor(q.length*0.22)) && latin<Math.max(3,Math.floor(q.length*0.12));
}

function looksProviderError(s){
  const t=String(s||'').toLowerCase();
  return !t || /invalid source language|example:\s*langpair|almost all languages supported|translation error|response error|quota|rate limit|\bhttp\s*4\d\d\b/.test(t);
}

async function fetchJson(url,headers={},ms=12000){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),ms);
  try{
    const r=await fetch(url,{headers,signal:c.signal});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{clearTimeout(timer);}
}

async function googleTranslate(q){
  const url=`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${encodeURIComponent(q)}`;
  const data=await fetchJson(url,{'User-Agent':'Mozilla/5.0'});
  const segs=Array.isArray(data?.[0])?data[0]:[];
  const out=cleanText(segs.map(x=>Array.isArray(x)?String(x[0]||''):'').join(''));
  if(looksProviderError(out)) throw new Error('Google translation unavailable');
  return out;
}

async function myMemoryTranslate(q){
  const lang=detectLang(q);
  if(lang==='und') return q;
  // MyMemory does not accept auto as the source language.
  const url=`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${lang}|zh-TW`;
  const data=await fetchJson(url,{'Accept':'application/json','User-Agent':'Mozilla/5.0'});
  if(String(data?.responseStatus||'')!=='200') throw new Error(`MyMemory status ${data?.responseStatus||'unknown'}`);
  const out=cleanText(data?.responseData?.translatedText||'');
  if(looksProviderError(out)) throw new Error('MyMemory translation unavailable');
  return out;
}

async function translateOne(text){
  const q=cleanText(text);
  if(!q) return '';
  if(looksChinese(q)) return q;
  try{
    const out=cleanText(await googleTranslate(q));
    if(out && out!==q && !looksProviderError(out)) return out;
  }catch(_){}
  try{
    const out=cleanText(await myMemoryTranslate(q));
    if(out && out!==q && !looksProviderError(out)) return out;
  }catch(_){}
  // Safe fallback: keep the original headline rather than exposing provider errors.
  return q;
}

module.exports=async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const raw=Array.isArray(req.body?.texts)?req.body.texts:[];
    const texts=[...new Set(raw.map(cleanText).filter(Boolean))].slice(0,30);
    const translations=[];
    let translatedCount=0;
    for(const t of texts){
      const out=await translateOne(t);
      translations.push(out);
      if(out && out!==t) translatedCount++;
    }
    return res.status(200).json({translations,requested:texts.length,translated:translatedCount,version:'title-zh-tw-3'});
  }catch(e){
    return res.status(200).json({error:'translation_unavailable',translations:[],requested:0,translated:0,version:'title-zh-tw-3'});
  }
};
