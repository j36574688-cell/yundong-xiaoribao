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
const CACHE_VERSION='v4';
const HIGHLIGHTS_VERSION='x1';
const HEAT_ALGORITHM_VERSION='v2';
const SECTION_INDEX_KEY='sd:index:v4:sections';
const HIGHLIGHTS_KEY_PREFIX='sd:highlights:v4:';
const HIGHLIGHTS_TTL_MS=20*60*1000;
const HIGHLIGHTS_HISTORY_DAYS=30;
const HEALTH_KEY='sd:health:v3';
const CACHE_HITS_KEY='sd:metrics:v3:cache:hits';
const CACHE_MISSES_KEY='sd:metrics:v3:cache:misses';

const SOURCES = require('../config/sources.v1.json');
const SPORTS_CONFIG = require('../config/sports.v1.json');
const LEAGUES_CONFIG = require('../config/leagues.v1.json');
const TYPES_CONFIG = require('../config/content-types.v1.json');
const {ENABLED:KV_ENABLED,get:kvGet,set:kvSet,incr:kvIncr,hgetall:kvHgetall,hset:kvHset}=require('./lib/redis');
const {allow:rateLimit}=require('./lib/rate-limit');

const COUNTRY = SOURCES.COUNTRY;
const LEAGUE = SOURCES.LEAGUE;
const PACK = SOURCES.PACK;
const SPORT_COUNTRIES = SOURCES.SPORT_COUNTRIES;
const SPORT_LEAGUES = SOURCES.SPORT_LEAGUES;
const ESPORTS_SITES = SOURCES.ESPORTS_SITES;
const ESPORTS_RULES = SOURCES.ESPORTS_RULES;
const LOCALE_RESULT_HINTS = SOURCES.localeResultHints || {};

const memoryNewsCache = globalThis.__SD_NEWS_CACHE_V2 || new Map();
const rawSourceCache = globalThis.__SD_RAW_SOURCE_CACHE_V2 || new Map();
globalThis.__SD_NEWS_CACHE_V2 = memoryNewsCache;
globalThis.__SD_RAW_SOURCE_CACHE_V2 = rawSourceCache;
const healthMemory=globalThis.__SD_HEALTH_V3 || new Map();
globalThis.__SD_HEALTH_V3=healthMemory;
const cacheMetrics=globalThis.__SD_CACHE_METRICS_V3 || {hits:0,misses:0};
globalThis.__SD_CACHE_METRICS_V3=cacheMetrics;
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

function localeResultSignal(title,league){
  const hints=Array.isArray(LOCALE_RESULT_HINTS?.[league])?LOCALE_RESULT_HINTS[league]:[];
  if(!hints.length) return false;
  const text=String(title||'');
  return hints.some(x=>text.toLowerCase().includes(String(x).toLowerCase()));
}

function classify(title,section={}){
  const hits=Object.entries(TYPE).filter(([,r])=>r.test(title)).map(([k])=>k);
  if(!hits.includes('比賽結果') && localeResultSignal(title,section?.league)) hits.unshift('比賽結果');
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
function typeAccept(title,section){
  const wanted=selectedTypes(section);
  if(!wanted.length||wanted.includes('全部')) return true;
  const hits=classify(title,section);
  return wanted.some(t=>hits.includes(t));
}

function selectedKeywords(section){
  const raw=section?.keywords;
  if(Array.isArray(raw)) return raw.map(x=>clean(x)).filter(Boolean).slice(0,20);
  return [];
}
function keywordMatches(title,section){
  const kws=selectedKeywords(section);
  if(!kws.length) return [];
  const t=String(title||'').toLowerCase();
  return kws.filter(k=>t.includes(k.toLowerCase()));
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

async function updateHealth(id,patch){
  const now=new Date().toISOString();
  const current=healthMemory.get(id)||{id,success:0,fail:0,lastSuccess:null,lastFailure:null,lastError:null,updatedAt:null};
  const next={...current,...patch,updatedAt:now};
  healthMemory.set(id,next);
  try{ await kvHset(HEALTH_KEY,id,JSON.stringify(next)); }catch(_){}
}

async function noteCacheMetric(kind){
  if(kind==='hit')cacheMetrics.hits++; else cacheMetrics.misses++;
  try{ await kvIncr(kind==='hit'?CACHE_HITS_KEY:CACHE_MISSES_KEY,30*24*60*60*1000); }catch(_){}
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
  let domains=[];
  if(ESPORTS_SITES[league]) domains=ESPORTS_SITES[league];
  else if(sport==='電競') domains=Object.values(ESPORTS_SITES).flat();
  else domains=cfg.domains||[];
  domains=[...new Set(domains)].slice(0,8);
  const sites=domains.map(x=>`site:${x}`).join(' OR ');
  const age=Math.min(7,Math.max(1,Math.ceil((Number(section.hours)||24)/24)));
  return useSites&&sites?`(${t}) (${sites}) when:${age}d`:`(${t}) when:${age}d`;
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
  const eventTypes=classify(raw.title,section);
  const stableId='n-'+Buffer.from(`${raw.url||raw.title||''}`).toString('base64url').slice(0,48);
  return {id:stableId,...raw,sectionId:section.id,sport:section.sport,league:section.league,eventType:eventTypes[0],eventTypes,eventId:`${section.sport}|${section.league}|${norm(raw.title)}`,sourceCount:1,languages:[raw.language],relatedSources:[raw.sourceName],matchedKeywords:[]};
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
function sourceAuthorityWeight(n){
  const d=domainOf(n.sourceUrl)||domainOf(n.url);
  const official=[
    'mlb.com','mlb.jp','npb.jp','kbo.co.kr','cpbl.com.tw','nba.com','nhl.com','nfl.com',
    'fifa.com','uefa.com','formula1.com','atptour.com','wtatennis.com','bwfworldtour.com','wtt.com',
    'lolesports.com','valorantesports.com','blast.tv','esl.com','dota2.com','worldathletics.org','worldaquatics.com'
  ];
  if(official.some(x=>d===x||d.endsWith('.'+x))) return 1.15;
  const reputable=['espn.com','reuters.com','apnews.com','bbc.com','theguardian.com','sports.yahoo.com','cbssports.com','foxsports.com','sponichi.co.jp','nikkansports.com'];
  if(reputable.some(x=>d===x||d.endsWith('.'+x))) return 1.05;
  return 1;
}

function applyHeatV1(items){
  return items.map(x=>{
    const sc=x.sourceCount||1; const lc=(x.languages||[]).length||1; const fresh=freshnessScore(x.publishedAt);
    const weight=CONTENT_WEIGHT[x.eventType]||0.60; const events=eventCountScore(x._clusterArticles||1);
    const raw=0.25*Math.log(sc+1)+0.15*Math.min(1,lc/3)+0.20*fresh+0.15*weight+0.25*events;
    return {...x,heat:Math.max(0,Math.min(100,Math.round(raw/1.25*100))),heatAlgorithmVersion:'v1'};
  });
}
function applyHeat(items){
  return items.map(x=>{
    const sc=x.sourceCount||1; const lc=(x.languages||[]).length||1; const fresh=freshnessScore(x.publishedAt);
    const weight=CONTENT_WEIGHT[x.eventType]||0.60; const events=eventCountScore(x._clusterArticles||1);
    const authority=sourceAuthorityWeight(x);
    const raw=(0.23*Math.log(sc+1)+0.14*Math.min(1,lc/3)+0.20*fresh+0.16*weight+0.27*events)*authority;
    return {...x,heat:Math.max(0,Math.min(100,Math.round(raw/1.35*100))),sourceAuthorityWeight:authority,heatAlgorithmVersion:HEAT_ALGORITHM_VERSION};
  });
}

function cacheKey(section){
  const types=selectedTypes(section).map(String).sort();
  return JSON.stringify({
    cacheVersion:CACHE_VERSION,
    v:CONFIG_VERSION,
    sport:String(section?.sport||''),
    league:String(section?.league||''),
    types,
    hours:Number(section?.hours)||24
  });
}

async function cacheGet(key){
  const memory=memoryNewsCache.get(key);
  if(memory){
    const ttl=memory.items?.length?SECTION_CACHE_TTL_MS:EMPTY_CACHE_TTL_MS;
    if(Date.now()-memory.time<=ttl){ await noteCacheMetric('hit'); return memory.value; }
    memoryNewsCache.delete(key);
  }
  if(KV_ENABLED){
    try{
      const raw=await kvGet(`sd:news:v4:${Buffer.from(key).toString('base64url')}`);
      if(raw){
        const value=JSON.parse(raw);
        const ttl=value?.items?.length?SECTION_CACHE_TTL_MS:EMPTY_CACHE_TTL_MS;
        // Redis TTL is authoritative; this guard is only for malformed legacy values.
        if(value && Date.parse(value.fetchedAt) && Date.now()-Date.parse(value.fetchedAt)<=Math.max(ttl,5*60*1000)) {
          memoryNewsCache.set(key,{time:Date.now(),items:value.items||[],value});
          await noteCacheMetric('hit');
          return value;
        }
      }
    }catch(_){}
  }
  await noteCacheMetric('miss');
  return null;
}

async function cacheSet(key,value){
  memoryNewsCache.set(key,{time:Date.now(),items:value.items||[],value});
  while(memoryNewsCache.size>120){
    const first=memoryNewsCache.keys().next().value;
    if(first===undefined)break;
    memoryNewsCache.delete(first);
  }
  if(KV_ENABLED){
    try{
      const ttl=value?.items?.length?SECTION_CACHE_TTL_MS:EMPTY_CACHE_TTL_MS;
      const storageKey=`sd:news:v4:${Buffer.from(key).toString('base64url')}`;
      await kvSet(storageKey,JSON.stringify(value),ttl);
      await kvHset(SECTION_INDEX_KEY,Buffer.from(key).toString('base64url'),JSON.stringify({key,updatedAt:value.fetchedAt||new Date().toISOString()}));
    }catch(_){}
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
  const cached=section.forceRefresh ? null : await cacheGet(key);
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
      if(parsed.length){
        await updateHealth(`market:${code}`,{success:(healthMemory.get(`market:${code}`)?.success||0)+1,lastSuccess:new Date().toISOString(),lastError:null});
      }else{
        await updateHealth(`market:${code}`,{success:(healthMemory.get(`market:${code}`)?.success||0)+1,lastSuccess:new Date().toISOString(),lastError:null});
        const url2=googleUrl(queryFor({...section,hours:Math.min(168,hours)},cfg,batch,false),cfg.market);
        const fallback=await fetchText(url2,SOURCE_TIMEOUT_MS).catch(()=>null);
        if(fallback)parsed=parseRss(fallback,cfg.market);
      }
      for(const item of parsed){
        const publisher=domainOf(item.sourceUrl)||String(item.sourceName||'unknown').toLowerCase();
        const h=healthMemory.get(`publisher:${publisher}`)||{id:`publisher:${publisher}`,success:0,fail:0,lastSuccess:null,lastFailure:null,lastError:null,updatedAt:null};
        void updateHealth(`publisher:${publisher}`,{success:h.success+1,lastSuccess:new Date().toISOString(),lastError:null});
      }
      return {code,items:parsed,error:null};
    }catch(e){
      const msg=String(e?.message||e);
      const h=healthMemory.get(`market:${code}`)||{success:0,fail:0};
      await updateHealth(`market:${code}`,{fail:(h.fail||0)+1,lastFailure:new Date().toISOString(),lastError:msg});
      return {code,items:[],error:msg};
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
      const types=classify(title);
      if(!typeAccept(title,section))continue;
      const matchedKeywords=keywordMatches(title,section);
      if(LOW_VALUE.test(title)&&types[0]==='其他重要新聞'&&!matchedKeywords.length)continue;
      if(sport==='電競'){
        if(!esportsAccept(title,section,raw.url,raw.sourceUrl))continue;
      }else if(!leagueAccept(title,section,raw.url,raw.sourceUrl))continue;
      const a=buildArticle(raw,section);
      a.eventTypes=types;a.eventType=types[0];a.matchedKeywords=matchedKeywords;
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
  await cacheSet(key,value);
  return value;
}


function percentileRanks(items){
  const byLeague=new Map();
  for(const item of items){const k=`${item.sport||''}|${item.league||''}`;if(!byLeague.has(k))byLeague.set(k,[]);byLeague.get(k).push(item);}
  const rank=new Map();
  for(const [k,arr] of byLeague){const sorted=[...arr].sort((a,b)=>Number(b.heat||0)-Number(a.heat||0)); const n=sorted.length;
    sorted.forEach((item,i)=>rank.set(item.id,n<=1?1:(n-i)/n));
  }
  return rank;
}

function buildHighlights(sectionValues,maxItems=5){
  const pool=[];
  const seen=new Map();
  for(const value of sectionValues||[]){
    for(const item of (value?.items||[])){
      const key=norm(item.title)||String(item.id);
      if(!key)continue;
      const prev=seen.get(key);
      if(prev){
        prev.sourceCount=Math.max(Number(prev.sourceCount||1),Number(item.sourceCount||1));
        prev.relatedSources=[...new Set([...(prev.relatedSources||[]),...(item.relatedSources||[])])];
        prev.languages=[...new Set([...(prev.languages||[]),...(item.languages||[])])];
        prev.eventTypes=[...new Set([...(prev.eventTypes||[]),...(item.eventTypes||[])])];
        continue;
      }
      const copy={...item,relatedSources:[...(item.relatedSources||[])],languages:[...(item.languages||[])],eventTypes:[...(item.eventTypes||[])]};
      seen.set(key,copy);pool.push(copy);
    }
  }
  const pct=percentileRanks(pool);
  const ranked=pool.map((item)=>{const freshness=freshnessScore(item.publishedAt); const diversity=Math.min(1,Number(item.sourceCount||1)/3); const percentile=pct.get(item.id)||0; const highlightScore=0.60*percentile+0.22*freshness+0.13*diversity+0.05*(Number(item.heat||0)/100); return {...item,highlightPercentile:Math.round(percentile*100),highlightScore:Number(highlightScore.toFixed(4))};})
    .sort((a,b)=>b.highlightScore-a.highlightScore||Number(b.heat||0)-Number(a.heat||0)||Date.parse(b.publishedAt||'')-Date.parse(a.publishedAt||''));
  const out=[]; const perSport=new Map();
  for(const item of ranked){const sport=String(item.sport||''); const n=perSport.get(sport)||0; if(n>=2)continue; out.push(item); perSport.set(sport,n+1); if(out.length>=maxItems)break;}
  return out.map((item,i)=>({...item,highlightRank:i+1,highlightReason:`${item.highlightPercentile} 百分位聯盟熱度｜${Number(item.sourceCount||1)>1?'多來源交叉':'單一來源'}｜近期性 ${Math.round(freshnessScore(item.publishedAt)*100)}%`}));
}

async function getSectionCacheByIndex(){
  const rows=[];
  if(KV_ENABLED){
    try{
      const arr=await kvHgetall(SECTION_INDEX_KEY);
      if(Array.isArray(arr)){
        for(let i=0;i<arr.length;i+=2){try{const meta=JSON.parse(String(arr[i+1]||'{}')); if(meta?.key)rows.push(meta.key);}catch(_){} }
      }
    }catch(_){ }
  }
  if(!rows.length){ for(const [key,v] of memoryNewsCache) if(v?.value) rows.push(key); }
  const vals=[];
  for(const key of rows.slice(0,120)){
    let value=null;
    if(KV_ENABLED){try{const raw=await kvGet(`sd:news:v4:${Buffer.from(key).toString('base64url')}`); if(raw)value=JSON.parse(raw);}catch(_){} }
    if(!value){const mem=memoryNewsCache.get(key); value=mem?.value||null;}
    if(value?.items?.length)vals.push(value);
  }
  return vals;
}

async function saveHighlights(value,dateKey){
  const key=`${HIGHLIGHTS_KEY_PREFIX}${dateKey}`;
  const payload={...value,historyKey:dateKey,expiresAt:new Date(Date.now()+HIGHLIGHTS_TTL_MS).toISOString()};
  if(KV_ENABLED){try{await kvSet(key,JSON.stringify(payload),HIGHLIGHTS_HISTORY_DAYS*24*60*60*1000);}catch(_){} }
  globalThis.__SD_HIGHLIGHTS_V4={value:payload,time:Date.now(),key};
  return payload;
}

async function loadHighlights(dateKey){
  if(KV_ENABLED){try{const raw=await kvGet(`${HIGHLIGHTS_KEY_PREFIX}${dateKey}`);if(raw)return JSON.parse(raw);}catch(_){} }
  const mem=globalThis.__SD_HIGHLIGHTS_V4;
  if(mem?.key===`${HIGHLIGHTS_KEY_PREFIX}${dateKey}` && Date.now()-mem.time<HIGHLIGHTS_TTL_MS)return mem.value;
  return null;
}

async function generateHighlights(force=false){
  const today=new Date().toISOString().slice(0,10);
  if(!force){const cached=await loadHighlights(today);if(cached)return cached;}
  let values=await getSectionCacheByIndex();
  if(!values.length) return saveHighlights({version:HIGHLIGHTS_VERSION,generatedAt:new Date().toISOString(),items:[],count:0,sourceSections:[]},today);
  const items=buildHighlights(values,5);
  const sourceSections=[...new Set(values.flatMap(v=>(v.items||[]).map(x=>x.sectionId)).filter(Boolean))];
  return saveHighlights({version:HIGHLIGHTS_VERSION,generatedAt:new Date().toISOString(),items,count:items.length,sourceSections,algorithm:'cross-sport-percentile+x1'},today);
}


async function healthSnapshot(){
  const rows=new Map();
  for(const [id,v] of healthMemory) rows.set(id,v);
  if(KV_ENABLED){
    try{
      const arr=await kvHgetall(HEALTH_KEY);
      if(Array.isArray(arr)){
        for(let i=0;i<arr.length;i+=2){
          const id=String(arr[i]||'');
          if(!id)continue;
          try{ rows.set(id,{...JSON.parse(String(arr[i+1]||'{}'))}); }catch(_){}
        }
      }
    }catch(_){}
  }
  const list=[...rows.values()].map(x=>({
    ...x,
    success:Number(x.success||0),
    fail:Number(x.fail||0),
    successRate:(Number(x.success||0)+Number(x.fail||0))?Math.round(Number(x.success||0)/(Number(x.success||0)+Number(x.fail||0))*100):null
  })).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  let cacheHits=cacheMetrics.hits, cacheMisses=cacheMetrics.misses;
  if(KV_ENABLED){
    try{ const [h,m]=await Promise.all([kvGet(CACHE_HITS_KEY),kvGet(CACHE_MISSES_KEY)]); if(h!=null)cacheHits=Number(h)||0; if(m!=null)cacheMisses=Number(m)||0; }catch(_){}
  }
  const today=new Date().toISOString().slice(0,10); let highlight=null; try{highlight=await loadHighlights(today);}catch(_){} const highlightAge=highlight?.generatedAt?Date.now()-Date.parse(highlight.generatedAt):null;
  return {version:'health-v4',generatedAt:new Date().toISOString(),kvEnabled:KV_ENABLED,cache:{hits:cacheHits,misses:cacheMisses,hitRate:(cacheHits+cacheMisses)?Math.round(cacheHits/(cacheHits+cacheMisses)*100):null},highlights:{exists:!!highlight,ageMinutes:highlightAge==null?null:Math.round(highlightAge/60000),stale:highlightAge==null?true:highlightAge>30},sources:list};
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

async function fetchForRss(section){
  const value=await one({...section,forceRefresh:false});
  return value;
}

async function loadHighlightsForDate(dateKey){ return loadHighlights(String(dateKey)); }

module.exports.__health=healthSnapshot;

module.exports = async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).json({error:'POST only',contractVersion:API_CONTRACT_VERSION});
  const cronInternal=String(req.headers?.['x-internal-cron']||'')==='1' && (!process.env.CRON_SECRET || String(req.headers?.authorization||'')===`Bearer ${process.env.CRON_SECRET}`);
  if(!cronInternal){
    const rl=await rateLimit(req,'news',20,60000);
    if(!rl.ok)return res.status(429).json({version:'vercel-news-v4',configVersion:CONFIG_VERSION,contractVersion:API_CONTRACT_VERSION,items:[],count:0,errors:[`rate_limit_exceeded:${rl.limit}/min`],fetchedAt:new Date().toISOString()});
  }
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
    const payload={version:'vercel-news-v4',configVersion:CONFIG_VERSION,contractVersion:API_CONTRACT_VERSION,heatAlgorithmVersion:HEAT_ALGORITHM_VERSION,fetchedAt:new Date().toISOString(),items,count:items.length,errors,cacheHits};
    const check=validateContractPayload(payload);
    if(!check.ok)return res.status(500).json({error:'contract_violation',detail:check.reason,contractVersion:API_CONTRACT_VERSION,items:[],count:0,errors:[check.reason],fetchedAt:new Date().toISOString()});
    return res.status(200).json(payload);
  }catch(e){
    return res.status(500).json({version:'vercel-news-v4',configVersion:CONFIG_VERSION,contractVersion:API_CONTRACT_VERSION,items:[],count:0,errors:[String(e?.message||e)],fetchedAt:new Date().toISOString()});
  }
};

if(process.env.NEWS_AUDIT_EXPORT==='1') module.exports.__audit={
  COUNTRY,LEAGUE,PACK,SPORT_COUNTRIES,SPORT_LEAGUES,ESPORTS_SITES,ESPORTS_RULES,TYPE,classify,typeAccept,selectedTypes,queryFor,leagueAccept,esportsAccept,countryList,
  SPORTS_CONFIG,LEAGUES_CONFIG,TYPES_CONFIG,CONFIG_VERSION,API_CONTRACT_VERSION,HEAT_ALGORITHM_VERSION,validateContractPayload,LOCALE_RESULT_HINTS,CACHE_VERSION,KV_ENABLED,healthSnapshot,cacheKey,localeResultSignal,applyHeatV1,applyHeat,sourceAuthorityWeight,selectedKeywords,keywordMatches,buildHighlights
};

module.exports.__generateHighlights=generateHighlights;
module.exports.__buildHighlights=buildHighlights;
module.exports.__loadHighlights=loadHighlightsForDate;
module.exports.__fetchForRss=fetchForRss;
module.exports.__rateLimit=rateLimit;
