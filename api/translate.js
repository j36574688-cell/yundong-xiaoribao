// Vercel Serverless Function: robust title translation for 運動小日報.
// Design goals: never expose provider errors, use explicit source languages,
// reuse warm-instance cache, and translate several titles concurrently.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const memoryCache = globalThis.__SD_TRANSLATION_CACHE || new Map();
globalThis.__SD_TRANSLATION_CACHE = memoryCache;

function cleanText(s){
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function detectLang(q){
  const s=String(q||'');
  const hangul=(s.match(/[\uac00-\ud7af]/g)||[]).length;
  const kana=(s.match(/[\u3040-\u30ff]/g)||[]).length;
  const cjk=(s.match(/[\u3400-\u9fff]/g)||[]).length;
  const latin=(s.match(/[A-Za-z]/g)||[]).length;
  if(hangul>=1) return 'ko';
  if(kana>=1) return 'ja';
  if(latin>=2) return 'en';
  if(cjk>=2) return 'zh';
  return 'und';
}

function looksChinese(q){
  const s=String(q||'');
  if(/[\uac00-\ud7af\u3040-\u30ff]/.test(s)) return false;
  const han=(s.match(/[\u3400-\u9fff]/g)||[]).length;
  const latin=(s.match(/[A-Za-z]/g)||[]).length;
  const digits=(s.match(/[0-9]/g)||[]).length;
  const letters=han+latin+digits;
  return han>=3 && han >= Math.max(3, Math.ceil(letters*0.45));
}

const ERROR_PATTERNS=[
  /invalid source language/i,
  /example:\s*langpair/i,
  /almost all languages supported/i,
  /translation error/i,
  /response error/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /rate limit/i,
  /too many requests/i,
  /quota/i,
  /\bhttp\s*4\d\d\b/i,
  /\bhttp\s*5\d\d\b/i
];

function looksProviderError(s){
  const t=String(s||'').trim();
  return !t || ERROR_PATTERNS.some(r=>r.test(t));
}

function cleanTranslation(original, candidate, lang){
  const q=cleanText(original);
  const out=cleanText(candidate);
  if(!out || looksProviderError(out)) return '';
  if(out===q) return '';
  // Avoid malformed responses that are wildly longer than a headline.
  if(out.length > Math.max(220, q.length * 3.2)) return '';
  // For foreign-source titles, a real zh-TW result normally contains CJK.
  if(lang!=='zh' && !/[\u3400-\u9fff]/.test(out)) return '';
  return out;
}

async function fetchJson(url,headers={},ms=9000){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),ms);
  try{
    const r=await fetch(url,{headers,signal:c.signal});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{
    clearTimeout(timer);
  }
}

async function googleTranslate(q,lang){
  const sl=lang==='en'||lang==='ja'||lang==='ko' ? lang : 'auto';
  const hosts=[
    'https://translate.googleapis.com',
    'https://translate.google.com'
  ];
  for(const host of hosts){
    try{
      const url=`${host}/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=zh-TW&dt=t&q=${encodeURIComponent(q)}`;
      const data=await fetchJson(url,{'User-Agent':'Mozilla/5.0','Accept':'application/json'},9000);
      const segs=Array.isArray(data?.[0])?data[0]:[];
      const out=cleanText(segs.map(x=>Array.isArray(x)?String(x[0]||''):'').join(''));
      const checked=cleanTranslation(q,out,lang);
      if(checked) return checked;
    }catch(_){/* try next provider */}
  }
  throw new Error('google unavailable');
}

async function myMemoryTranslate(q,lang){
  if(!['en','ja','ko'].includes(lang)) throw new Error('unsupported source');
  const url=`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${lang}|zh-TW`;
  const data=await fetchJson(url,{'Accept':'application/json','User-Agent':'Mozilla/5.0'},9000);
  if(String(data?.responseStatus||'')!=='200') throw new Error('mymemory unavailable');
  const out=cleanTranslation(q,data?.responseData?.translatedText||'',lang);
  if(!out) throw new Error('bad translation');
  return out;
}

function cacheGet(key){
  const hit=memoryCache.get(key);
  if(!hit) return '';
  if(Date.now()-hit.time>CACHE_TTL_MS){
    memoryCache.delete(key);
    return '';
  }
  return hit.value;
}

function cacheSet(key,value){
  memoryCache.set(key,{time:Date.now(),value});
  while(memoryCache.size>CACHE_MAX){
    const first=memoryCache.keys().next().value;
    if(first===undefined) break;
    memoryCache.delete(first);
  }
}

async function translateOne(text){
  const q=cleanText(text);
  if(!q) return '';
  if(looksChinese(q)) return q;

  const lang=detectLang(q);
  if(lang==='und' || lang==='zh') return q;

  const key=`${lang}:${q}`;
  const cached=cacheGet(key);
  if(cached) return cached;

  try{
    const out=await googleTranslate(q,lang);
    cacheSet(key,out);
    return out;
  }catch(_){ }

  try{
    const out=await myMemoryTranslate(q,lang);
    cacheSet(key,out);
    return out;
  }catch(_){ }

  return q;
}

async function mapConcurrent(items,limit,fn){
  const out=new Array(items.length);
  let next=0;
  async function worker(){
    while(true){
      const i=next++;
      if(i>=items.length) return;
      try{ out[i]=await fn(items[i],i); }
      catch(_){ out[i]=items[i]; }
    }
  }
  const workers=Array.from({length:Math.min(limit,items.length||1)},()=>worker());
  await Promise.all(workers);
  return out;
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
    const texts=[...new Set(raw.map(cleanText).filter(Boolean))].slice(0,40);
    const translations=await mapConcurrent(texts,4,translateOne);
    const translated=translations.reduce((n,v,i)=>n+(v&&v!==texts[i]?1:0),0);

    return res.status(200).json({
      translations,
      requested:texts.length,
      translated,
      version:'title-zh-tw-4'
    });
  }catch(_){
    return res.status(200).json({
      error:'translation_unavailable',
      translations:[],
      requested:0,
      translated:0,
      version:'title-zh-tw-4'
    });
  }
};
