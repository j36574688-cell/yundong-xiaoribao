// Vercel Serverless Function: title translation plugin for 運動小日報.
// Uses Google Translate's public translate endpoint as a server-side relay so the browser
// does not need direct cross-origin access. No API key is stored in the app.

function cleanText(s){return String(s??'').replace(/\s+/g,' ').trim();}

async function translateOne(text){
  const q=cleanText(text);
  if(!q)return '';
  // Already predominantly Traditional/Chinese: preserve it and avoid unnecessary calls.
  const cjk=(q.match(/[\u3400-\u9fff]/g)||[]).length;
  if(cjk>=Math.max(2,Math.floor(q.length*0.22))) return q;
  const url=`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${encodeURIComponent(q)}`;
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok)throw new Error(`translation upstream HTTP ${r.status}`);
  const data=await r.json();
  const segs=Array.isArray(data?.[0])?data[0]:[];
  const out=segs.map(x=>Array.isArray(x)?String(x[0]||''): '').join('').trim();
  return out||q;
}

module.exports=async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  try{
    const raw=Array.isArray(req.body?.texts)?req.body.texts:[];
    const texts=[...new Set(raw.map(cleanText).filter(Boolean))].slice(0,30);
    const translations=[];
    for(const t of texts){
      try{translations.push(await translateOne(t));}
      catch(_){translations.push(t);}
    }
    return res.status(200).json({translations,requested:texts.length,translated:texts.length,version:'title-zh-tw-1'});
  }catch(e){
    return res.status(500).json({error:String(e),translations:[]});
  }
};
