// Vercel Serverless Function: stable multi-sport news aggregator (architecture v2).
// Canonical production endpoint: /api/news
// Goals: per-source timeout, allSettled fan-out, layered cache, strict routing,
// conservative event clustering, versioned heat scoring, and stable API contract.

const CONFIG_VERSION = '1.0.0';
const API_CONTRACT_VERSION = '1.0';
const SOURCE_TIMEOUT_MS = 8000;
const SECTION_CACHE_TTL_MS = 7 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 2 * 60 * 1000;
const RAW_SOURCE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SECTIONS = 20;
const MAX_ITEMS_PER_SECTION = 100;
const MAX_FETCH_CONCURRENCY = 8;

const SOURCES = require('../config/sources.v1.json');
const SPORTS_CONFIG = require('../config/sports.v1.json');
const LEAGUES_CONFIG = require('../config/leagues.v1.json');
const TYPES_CONFIG = require('../config/content-types.v1.json');

const COUNTRY = SOURCES.COUNTRY;
const LEAGUE = SOURCES.LEAGUE;
const PACK = SOURCES.PACK;
const SPORT_COUNTRIES = SOURCES.SPORT_COUNTRIES;
const SPORT_LEAGUES = SOURCES.SPORT_LEAGUES;
const ESPORTS_SITES = SOURCES.ESPORTS_SITES;
const ESPORTS_RULES = SOURCES.ESPORTS_RULES;

const memoryNewsCache = globalThis.__SD_NEWS_CACHE_V2 || new Map();
const rawSourceCache = globalThis.__SD_RAW_SOURCE_CACHE_V2 || new Map();
globalThis.__SD_NEWS_CACHE_V2 = memoryNewsCache;
globalThis.__SD_RAW_SOURCE_CACHE_V2 = rawSourceCache;
const ESPORTS_NOISE=/\b(guides?|walkthrough|builds?|tier list|tier-list|skins?|codes?|redeem|patch notes?|system requirements?|settings?|crosshair|sensitivity|how to|best .* settings|dataminer|datamining)\b|攻略|教學|造型|造型包|配裝|設定|靈敏度|準心|代碼|兌換碼|外掛|洩漏|漏洞/i;

function esportsAccept(title,section,url='',sourceUrl=''){
  if(section?.sport!=='電競') return true;
  const league=String(section?.league||'全部');
  const text=String(title||'').toLowerCase();
  const domain=domainOf(sourceUrl)||domainOf(url);
  const known=league!=='全部'?(ESPORTS_SITES[league]||[]):Object.values(ESPORTS_SITES).flat();
  const sourceIsKnown=known.some(d=>domain===d||domain.endsWith('.'+d));
  if(league==='全部'){
    const gameSignals=['league of legends','lol esports','valorant','vct','counter-strike','counter strike','cs2','dota 2','dota2','lck','lpl','lec','lcs','blast','esl'];
    if(!sourceIsKnown && !gameSignals.some(x=>text.includes(x))) return false;
    if(ESPORTS_NOISE.test(title) && !/\b(esports|vct|lck|lpl|lec|lcs|blast|esl|counter[- ]strike|cs2|dota ?2|league of legends|valorant)\b/i.test(title)) return false;
    return true;
  }
  const rule=ESPORTS_RULES[league];
  if(!rule) return sourceIsKnown;
  const requiredHit=rule.required.some(x=>text.includes(x));
  const competitiveHit=rule.competitive.some(x=>text.includes(x));
  if(!sourceIsKnown && !requiredHit) return false;
  if(ESPORTS_NOISE.test(title) && !competitiveHit) return false;
  if(league==='LCK' && /\b(lpl|lec|lcs)\b/i.test(title) && !/\blck\b/i.test(title)) return false;
  if(league==='LPL' && /\b(lck|lec|lcs)\b/i.test(title) && !/\blpl\b/i.test(title)) return false;
  if(league==='LEC' && /\b(lck|lpl|lcs)\b/i.test(title) && !/\blec\b/i.test(title)) return false;
  if(league==='LCS' && /\b(lck|lpl|lec)\b/i.test(title) && !/\blcs\b/i.test(title)) return false;
  if(league==='VCT' && /\b(cs2|counter[- ]strike|league of legends|dota ?2)\b/i.test(title) && !/\b(vct|valorant)\b/i.test(title)) return false;
  if(league==='CS2' && /\b(valorant|vct|league of legends|dota ?2)\b/i.test(title) && !/\b(cs2|counter[- ]strike|iem|major)\b/i.test(title)) return false;
  if(league==='Dota 2' && /\b(cs2|counter[- ]strike|valorant|vct|league of legends)\b/i.test(title) && !/\bdota ?2\b/i.test(title)) return false;
  return requiredHit || sourceIsKnown;
}

const TYPE = {
  "比賽結果":/final score|box score|game result|won|win over|beat|defeat|victory|lost to|勝|敗|比分|戰勝|擊敗|賽果|終場/i,
  "即時戰況":/\blive\b|live score|live updates|in progress|即時|文字直播/i,
  賽程:/schedule|fixture|upcoming|next game|next match|calendar|賽程|預告|對陣/i,
  "晉級／淘汰":/advance|advanced|qualif|eliminat|knockout|晉級|淘汰|出線|出局/i,
  "冠軍／決賽":/championship|champion|finals|title decider|決賽|冠軍|爭冠/i,
  "球員／選手表現":/stats?|statistics|performance|points|goals|assists|rebounds|home runs|hits|strikeouts|得分|安打|投球|進球|表現/i,
  "生涯紀錄":/career high|career-high|career best|milestone|生涯新高|生涯紀錄|生涯里程碑/i,
  "世界／聯盟紀錄":/world record|league record|record-breaking|new record|紀錄|破紀錄|刷新紀錄/i,
  "獎項／MVP":/\bMVP\b|award|most valuable|best player|player of the year|獎項|最有價值|最佳球員|年度最佳/i,
  交易:/\btrade\b|traded|trade deadline|acquire|acquired|deal|交易|換隊|換來|交易案/i,
  "簽約／續約":/signed|signing|re-signed|extension|contract extension|new contract|agrees to a contract|簽約|簽下|續約|延長合約|新合約/i,
  "自由市場":/free agent|free agency|free-agent|自由球員|自由市場|自由球員市場/i,
  受傷:/\binjur(?:y|ed)\b|sidelined|hurt|suffered an injury|傷勢|受傷|負傷|傷兵/i,
  "傷勢更新":/injury update|injury status|injury report|medical update|rehab|傷勢更新|傷情更新|復健進度|傷勢報告/i,
  手術:/surgery|underwent surgery|operation|procedure|手術|開刀/i,
  復出:/comeback|returns? to action|returning to play|back in lineup|復出|回歸|傷癒歸隊|歸隊/i,
  缺席:/absence|absent|will miss|misses the game|out for|ruled out|inactive|缺席|缺陣|無法出賽/i,
  "禁賽／罰款":/suspension|suspended|fine|fined|penalty|禁賽|罰款|處分/i,
  爭議:/controversy|controversial|dispute|backlash|爭議|風波|質疑/i,
  "裁判事件":/referee|umpire|officiating|officials decision|裁判|判決|誤判|判罰/i,
  衝突:/altercation|fight|brawl|clash|conflict|衝突|口角|鬥毆/i,
  "聯盟調查":/investigation|investigating|league probe|probe into|under investigation|聯盟調查|調查/i,
  "教練異動":/coach fired|coach hired|new head coach|new manager|manager fired|coaching change|換帥|教練異動|總教練更換|解雇教練|任命教練/i,
  "球隊／聯盟公告":/official announcement|announces|announcement|statement|球隊公告|聯盟公告|官方公告|宣布|聲明/i,
  "商業／合約":/sponsorship|sponsor|partnership|commercial|business deal|rights deal|贊助|商業合作|轉播權|品牌合作/i,
  排名:/ranking|ranked|standings|power rankings|排名|戰績排名|積分榜|排行榜/i,
  "國際賽事":/international competition|international tournament|world cup|world championship|國際賽|國際賽事|世界盃|世界錦標賽/i,
  "延期／取消":/postponed|postponement|cancelled|canceled|called off|延期|延賽|取消/i
};
const LOW_VALUE=/\b(prediction|predictions|preview|odds|recap|roundup|opinion|column|guide|explainer|power ranking|what to know|best of|top stories)\b|預測|前瞻|回顧|盤點|評論|專欄|指南|懶人包/i;


function clean(s=''){
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/<!\[CDATA\[|\]\]>/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
}

function parseDate(v){
  if(!v) return '';
  const d=new Date(v);
  return Number.isFinite(d.getTime())?d.toISOString():'';
}

function norm(s){
  return clean(s).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\b(the|a|an|and|of|to|in|on|for|with|news|update|latest|breaking|official|report|reports|sport|sports)\b/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,240);
}

function tokens(s){
  return norm(s).split(' ').filter(x=>x.length>=2);
}

function jaccard(a,b){
  const A=new Set(a),B=new Set(b);
  if(!A.size||!B.size)return 0;
  let inter=0; for(const x of A)if(B.has(x))inter++;
  return inter/(A.size+B.size-inter);
}

function classify(title){
  const hits=Object.entries(TYPE).filter(([,r])=>r.test(title)).map(([k])=>k);
  const out=hits.length?hits:['其他重要新聞'];
  if(out.includes('傷勢更新') && out.includes('受傷')) out.splice(out.indexOf('受傷'),1);
  if(out.includes('世界／聯盟紀錄') && out.includes('生涯紀錄')) out.splice(out.indexOf('生涯紀錄'),1);
  return out;
}

function selectedTypes(section){
  const raw=section?.types ?? section?.contentTypes ?? section?.selectedTypes ?? section?.type;
  if(Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if(typeof raw==='string'&&raw.trim()) return [raw.trim()];
  return ['全部'];
}

// NPB 日本語記事は「試合結果」「勝利」「敗戦」など結果語が見出しに現れやすく、
// 英語中心の共通 TYPE regex だけでは「比賽結果」に分類できない場合がある。
// ここでは NPB のみ日本語結果語を補完し、他のスポーツの挙動は変更しない。
function npbResultSignal(title){
  const s=String(title||'');
  return /試合結果|試合終了|試合速報|勝利|敗戦|勝った|敗れた|勝ち|敗れ|勝投手|敗投手|サヨナラ|延長戦|スコア|\b\d+\s*[-－ー]\s*\d+\b/i.test(s);
}
function classifyForSection(title,section){
  const hits=classify(title);
  if(section?.sport==='棒球' && section?.league==='NPB' && npbResultSignal(title) && !hits.includes('比賽結果')){
    hits.unshift('比賽結果');
  }
  return hits;
}
function typeAccept(title,section){
  const wanted=selectedTypes(section);
  if(!wanted.length||wanted.includes('全部')) return true;
  const hits=classifyForSection(title,section);
  return wanted.some(t=>hits.includes(t));
}

function parseRss(xml,lang){
  const out=[];
  const items=String(xml).match(/<item>[\s\S]*?<\/item>/gi)||[];
  for(const item of items){
    const m=(tag)=>{const x=item.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`,'i'));return x?clean(x[1]):'';};
    const title=m('title');
    const link=m('link')||((item.match(/<link>([^<]+)/i)||[])[1]||'');
    const pub=m('pubDate')||m('published')||m('updated');
    const sm=item.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const source=sm?clean(sm[2]):'Google News';
    const sourceUrl=sm?((sm[1].match(/\burl=["']([^"']+)/i)||[])[1]||''):'';
    if(title&&link)out.push({title,url:link,sourceName:source,sourceUrl,publishedAt:parseDate(pub),language:lang});
  }
  return out;
}

async function fetchText(url,ms=SOURCE_TIMEOUT_MS){
  const hit=rawSourceCache.get(url);
  if(hit&&Date.now()-hit.time<RAW_SOURCE_CACHE_TTL_MS)return hit.value;
  if(hit)rawSourceCache.delete(url);
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),ms);
  try{
    const r=await fetch(url,{signal:ac.signal,headers:{'user-agent':'SportsDaily/8.0','accept':'application/rss+xml,application/xml,text/xml'}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const text=await r.text();
    rawSourceCache.set(url,{time:Date.now(),value:text});
    return text;
  }finally{clearTimeout(timer);}
}

function googleUrl(q,market){
  const [lang,cc]=String(market||'en-US').split('-');
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${encodeURIComponent(market||'en-US')}&gl=${encodeURIComponent(cc||'US')}&ceid=${encodeURIComponent(`${cc||'US'}:${lang||'en'}`)}`;
}

function queryFor(section,cfg,batchIndex=0,useSites=true){
  const league=section.league||'全部';
  const sport=section.sport||'棒球';
  const terms=league!=='全部'?(LEAGUE[league]||[league]):[sport,...(SPORT_LEAGUES[sport]||[])];
  const start=(Number(batchIndex)||0)*8;
  const batchTerms=terms.slice(start,start+8);
  const t=(batchTerms.length?batchTerms:terms.slice(0,8)).map(x=>`"${x}"`).join(' OR ');
  const npbResultHint=(sport==='棒球' && league==='NPB' && selectedTypes(section).includes('比賽結果'))
    ? ' ("試合結果" OR 勝利 OR 敗戦 OR 試合終了 OR スコア)'
    : '';
  let domains=[];
  if(ESPORTS_SITES[league]) domains=ESPORTS_SITES[league];
  else if(sport==='電競') domains=Object.values(ESPORTS_SITES).flat();
  else domains=cfg.domains||[];
  domains=[...new Set(domains)].slice(0,8);
  const sites=domains.map(x=>`site:${x}`).join(' OR ');
  const age=Math.min(7,Math.max(1,Math.ceil((Number(section.hours)||24)/24)));
  return useSites&&sites?`(${t})${npbResultHint} (${sites}) when:${age}d`:`(${t})${npbResultHint} when:${age}d`;
}

function countryList(section){
  if(section.league&&PACK[section.league])return PACK[section.league].filter(x=>COUNTRY[x]).slice(0,4);
  if(section.sport&&SPORT_COUNTRIES[section.sport])return SPORT_COUNTRIES[section.sport].filter(x=>COUNTRY[x]).slice(0,4);
  return ['US','GB','JP','KR'];
}

function domainOf(url){
  try{return new URL(String(url||'')).hostname.replace(/^www\./,'').toLowerCase();}
  catch{return '';}
}

function leagueAccept(title,section,url='',sourceUrl=''){
  const league=String(section?.league||'全部');
  if(league==='全部')return true;
  const text=String(title||'').toLowerCase();
  const selected=(LEAGUE[league]||[league]).map(x=>String(x).toLowerCase());
  const selectedHit=selected.some(t=>t&&text.includes(t));
  const domain=domainOf(sourceUrl)||domainOf(url);
  const knownDomains=new Set();
  for(const code of (PACK[league]||[]))for(const d of (COUNTRY[code]?.domains||[]))knownDomains.add(String(d).toLowerCase());
  for(const d of (ESPORTS_SITES[league]||[]))knownDomains.add(String(d).toLowerCase());
  const sourceIsKnown=[...knownDomains].some(d=>domain===d||domain.endsWith('.'+d));
  const sport=String(section?.sport||'');
  const peers=(SPORT_LEAGUES[sport]||[]).filter(x=>x!==league);
  for(const other of peers){
    const terms=(LEAGUE[other]||[other]).map(x=>String(x).toLowerCase());
    if(terms.some(t=>t&&text.includes(t)))return false;
  }
  return selectedHit||sourceIsKnown;
}

function buildArticle(raw,section){
  const eventTypes=classify(raw.title);
  const stableId='n-'+Buffer.from(`${raw.url||raw.title||''}`).toString('base64url').slice(0,48);
  return {id:stableId,...raw,sectionId:section.id,sport:section.sport,league:section.league,eventType:eventTypes[0],eventTypes,eventId:`${section.sport}|${section.league}|${norm(raw.title)}`,sourceCount:1,languages:[raw.language],relatedSources:[raw.sourceName]};
}

function addToCluster(clusters,a){
  const at=Date.parse(a.publishedAt)||0;
  const atok=tokens(a.title);
  let best=null,bestScore=0;
  for(const c of clusters){
    const ct=Date.parse(c.publishedAt)||0;
    if(at&&ct&&Math.abs(at-ct)>30*60*60*1000)continue;
    const score=jaccard(atok,c._tokens);
    const subset=atok.length>=3&&c._tokens.length>=3&&(atok.every(x=>c._set.has(x))||c._tokens.every(x=>new Set(atok).has(x)));
    if((score>=0.82||subset)&&score>bestScore){best=c;bestScore=score;}
  }
  if(!best){a._tokens=atok;a._set=new Set(atok);a._clusterArticles=1;clusters.push(a);return;}
  best._clusterArticles++;
  best.sourceCount=new Set([...(best.relatedSources||[]),a.sourceName]).size;
  best.languages=[...new Set([...(best.languages||[]),a.language])];
  best.relatedSources=[...new Set([...(best.relatedSources||[]),a.sourceName])];
  best.eventTypes=[...new Set([...(best.eventTypes||[]),...(a.eventTypes||[])])];
  if((Date.parse(a.publishedAt)||0)>(Date.parse(best.publishedAt)||0)){
    best.title=a.title;best.url=a.url;best.sourceName=a.sourceName;best.sourceUrl=a.sourceUrl;best.publishedAt=a.publishedAt;best.language=a.language;
  }
}

const HEAT_ALGORITHM_VERSION='v1';
const CONTENT_WEIGHT={
  '其他重要新聞':0.60,'比賽結果':0.95,'即時戰況':0.80,'賽程':0.65,'晉級／淘汰':0.90,'冠軍／決賽':1.00,
  '球員／選手表現':0.70,'生涯紀錄':0.90,'世界／聯盟紀錄':1.00,'獎項／MVP':0.85,'交易':0.90,'簽約／續約':0.82,
  '自由市場':0.72,'受傷':0.82,'傷勢更新':0.70,'手術':0.82,'復出':0.80,'缺席':0.65,'禁賽／罰款':0.82,
  '爭議':0.72,'裁判事件':0.70,'衝突':0.78,'聯盟調查':0.82,'教練異動':0.80,'球隊／聯盟公告':0.70,
  '商業／合約':0.62,'排名':0.58,'國際賽事':0.72,'延期／取消':0.74
};
function freshnessScore(iso){
  const ts=Date.parse(iso); if(!Number.isFinite(ts))return 0;
  const ageH=Math.max(0,(Date.now()-ts)/3600000);
  return Math.exp(-ageH/30);
}
function eventCountScore(n){
  return Math.min(1,Math.log2(Math.max(1,n)+1)/Math.log2(7));
}
function applyHeat(items){
  return items.map(x=>{
    const sc=x.sourceCount||1;
    const lc=(x.languages||[]).length||1;
    const fresh=freshnessScore(x.publishedAt);
    const weight=CONTENT_WEIGHT[x.eventType]||0.60;
    const events=eventCountScore(x._clusterArticles||1);
    const raw=
      0.25*Math.log(sc+1)+
      0.15*Math.min(1,lc/3)+
      0.20*fresh+
      0.15*weight+
      0.25*events;
    return {...x,heat:Math.max(0,Math.min(100,Math.round(raw/1.25*100))),heatAlgorithmVersion:HEAT_ALGORITHM_VERSION};
  });
}

function cacheKey(section){
  const types=selectedTypes(section).map(String).sort();
  return JSON.stringify({
    v:CONFIG_VERSION,
    sport:String(section?.sport||''),
    league:String(section?.league||''),
    types,
    hours:Number(section?.hours)||24
  });
}
function cacheGet(key){
  const hit=memoryNewsCache.get(key);
  if(!hit)return null;
  const ttl=hit.items?.length?SECTION_CACHE_TTL_MS:EMPTY_CACHE_TTL_MS;
  if(Date.now()-hit.time>ttl){memoryNewsCache.delete(key);return null;}
  return hit.value;
}
function cacheSet(key,value){
  memoryNewsCache.set(key,{time:Date.now(),items:value.items||[],value});
  while(memoryNewsCache.size>120){
    const first=memoryNewsCache.keys().next().value;
    if(first===undefined)break;
    memoryNewsCache.delete(first);
  }
}

async function mapConcurrent(items,limit,fn){
  const out=[];
  for(let start=0;start<items.length;start+=limit){
    const batch=items.slice(start,start+limit);
    const settled=await Promise.allSettled(batch.map((item,index)=>fn(item,start+index)));
    settled.forEach((r,i)=>{out[start+i]=r.status==='fulfilled'?r.value:{error:String(r.reason?.message||r.reason)}});
  }
  return out;
}

async function one(section){
  const key=cacheKey(section);
  const cached=section.forceRefresh ? null : cacheGet(key);
  if(cached)return {...cached,cacheHit:true};

  const countries=countryList(section);
  const league=section.league||'全部';
  const sport=section.sport||'棒球';
  const allTerms=league!=='全部'?(LEAGUE[league]||[league]):[sport,...(SPORT_LEAGUES[sport]||[])];
  const batches=Math.max(1,Math.ceil(allTerms.length/8));
  const jobs=[];
  for(const code of countries){
    const cfg=COUNTRY[code]; if(!cfg)continue;
    for(let batch=0;batch<batches;batch++) jobs.push({code,cfg,batch});
  }
  const results=await mapConcurrent(jobs,MAX_FETCH_CONCURRENCY,async job=>{
    const {code,cfg,batch}=job;
    const hours=Math.max(1,Number(section.hours)||24);
    const url1=googleUrl(queryFor(section,cfg,batch,true),cfg.market);
    try{
      const primary=await fetchText(url1,SOURCE_TIMEOUT_MS);
      let parsed=primary?parseRss(primary,cfg.market):[];
      if(!parsed.length){
        const url2=googleUrl(queryFor({...section,hours:Math.min(168,hours)},cfg,batch,false),cfg.market);
        const fallback=await fetchText(url2,SOURCE_TIMEOUT_MS).catch(()=>null);
        if(fallback)parsed=parseRss(fallback,cfg.market);
      }
      return {code,items:parsed,error:null};
    }catch(e){
      return {code,items:[],error:String(e?.message||e)};
    }
  });

  const errors=results.filter(x=>x?.error).map(x=>`${x.code}: ${x.error}`);
  const hours=Math.max(1,Number(section.hours)||24);
  const map=new Map();
  for(const result of results){
    for(const raw of (result.items||[])){
      const ts=Date.parse(raw.publishedAt); if(!Number.isFinite(ts))continue;
      if(Date.now()-ts>hours*3600000)continue;
      const title=raw.title;
      const types=classifyForSection(title,section);
      if(!typeAccept(title,section))continue;
      if(LOW_VALUE.test(title)&&types[0]==='其他重要新聞')continue;
      if(sport==='電競'){
        if(!esportsAccept(title,section,raw.url,raw.sourceUrl))continue;
      }else if(!leagueAccept(title,section,raw.url,raw.sourceUrl))continue;
      const a=buildArticle(raw,section);
      a.eventTypes=types;a.eventType=types[0];
      const k=norm(title);if(!k)continue;
      if(map.has(k)){
        const old=map.get(k);
        old._clusterArticles=(old._clusterArticles||1)+1;
        old.relatedSources=[...new Set([...(old.relatedSources||[]),a.sourceName])];
        old.sourceCount=old.relatedSources.length;
        old.languages=[...new Set([...(old.languages||[]),a.language])];
        old.eventTypes=[...new Set([...(old.eventTypes||[]),...a.eventTypes])];
      }else map.set(k,a);
    }
  }

  const clusters=[];
  for(const a of map.values())addToCluster(clusters,a);
  const items=applyHeat(clusters).sort((a,b)=>b.heat-a.heat||Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,MAX_ITEMS_PER_SECTION)
    .map(x=>{
      const {_tokens,_set,_clusterArticles,...rest}=x;
      return {...rest,eventCount:_clusterArticles||1};
    });
  const value={items,count:items.length,errors,fetchedAt:new Date().toISOString(),configVersion:CONFIG_VERSION,heatAlgorithmVersion:HEAT_ALGORITHM_VERSION};
  cacheSet(key,value);
  return value;
}

const CONTRACT_REQUIRED_ITEM_FIELDS=['id','title','url','sourceName','publishedAt','sport','league','eventType','eventTypes','sourceCount','languages','relatedSources','heat','sectionId'];
function validateContractPayload(d){
  if(!d||typeof d!=='object')return {ok:false,reason:'response 不是 object'};
  if(!Array.isArray(d.items))return {ok:false,reason:'items 必須是 Array'};
  if(typeof d.count!=='number')return {ok:false,reason:'count 必須是 number'};
  if(!Array.isArray(d.errors))return {ok:false,reason:'errors 必須是 Array'};
  if(typeof d.fetchedAt!=='string')return {ok:false,reason:'fetchedAt 必須是 string'};
  for(const item of d.items.slice(0,10)){
    for(const k of CONTRACT_REQUIRED_ITEM_FIELDS){if(!(k in item)||item[k]===undefined||item[k]===null)return {ok:false,reason:`item 缺少欄位 ${k}`};}
    if(typeof item.title!=='string'||typeof item.url!=='string'||typeof item.sport!=='string'||typeof item.league!=='string')return {ok:false,reason:'title/url/sport/league 型別錯誤'};
    if(typeof item.sourceCount!=='number'||typeof item.heat!=='number')return {ok:false,reason:'sourceCount/heat 必須是 number'};
    if(!Array.isArray(item.eventTypes)||!Array.isArray(item.languages)||!Array.isArray(item.relatedSources))return {ok:false,reason:'eventTypes/languages/relatedSources 必須是 Array'};
  }
  return {ok:true};
}

module.exports = async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).json({error:'POST only',contractVersion:API_CONTRACT_VERSION});
  try{
    const forceRefresh=Boolean(req.body?.forceRefresh);
    const sections=Array.isArray(req.body?.sections)?req.body.sections.slice(0,MAX_SECTIONS).map(s=>({...s,forceRefresh})):[];
    const rr=await Promise.allSettled(sections.map(one));
    const items=[];const errors=[];const cacheHits=[];
    rr.forEach((r,i)=>{
      const s=sections[i]||{};
      if(r.status==='fulfilled'){
        items.push(...(r.value.items||[]));
        errors.push(...(r.value.errors||[]));
        if(r.value.cacheHit)cacheHits.push(s.id||`${s.sport}/${s.league}`);
      }else errors.push(`${s.sport||''}/${s.league||''}: ${String(r.reason?.message||r.reason)}`);
    });
    const payload={version:'vercel-news-v2',configVersion:CONFIG_VERSION,contractVersion:API_CONTRACT_VERSION,heatAlgorithmVersion:HEAT_ALGORITHM_VERSION,fetchedAt:new Date().toISOString(),items,count:items.length,errors,cacheHits};
    const check=validateContractPayload(payload);
    if(!check.ok)return res.status(500).json({error:'contract_violation',detail:check.reason,contractVersion:API_CONTRACT_VERSION,items:[],count:0,errors:[check.reason],fetchedAt:new Date().toISOString()});
    return res.status(200).json(payload);
  }catch(e){
    return res.status(500).json({version:'vercel-news-v2',configVersion:CONFIG_VERSION,contractVersion:API_CONTRACT_VERSION,items:[],count:0,errors:[String(e?.message||e)],fetchedAt:new Date().toISOString()});
  }
};

if(process.env.NEWS_AUDIT_EXPORT==='1') module.exports.__audit={
  COUNTRY,LEAGUE,PACK,SPORT_COUNTRIES,SPORT_LEAGUES,ESPORTS_SITES,ESPORTS_RULES,TYPE,classify,classifyForSection,npbResultSignal,typeAccept,selectedTypes,queryFor,leagueAccept,esportsAccept,countryList,
  SPORTS_CONFIG,LEAGUES_CONFIG,TYPES_CONFIG,CONFIG_VERSION,API_CONTRACT_VERSION,HEAT_ALGORITHM_VERSION,validateContractPayload
};
