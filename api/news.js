// Vercel Serverless Function: local-language sports news aggregator.
// Keeps news retrieval out of Supabase so one slow/blocked source cannot make the app show 0.

const COUNTRY = {
  US:{market:'en-US',domains:['espn.com','cbssports.com','foxsports.com','nbcsports.com','sports.yahoo.com','nba.com','mlb.com','nfl.com','nhl.com']},
  CA:{market:'en-CA',domains:['tsn.ca','sportsnet.ca','cbc.ca']},
  JP:{market:'ja-JP',domains:['nikkansports.com','sponichi.co.jp','hochi.news','daily.co.jp','sanspo.com','nhk.or.jp','news.yahoo.co.jp','npb.jp']},
  KR:{market:'ko-KR',domains:['yna.co.kr','osen.co.kr','sports.chosun.com','sports.donga.com','sports.khan.co.kr','koreabaseball.com']},
  TW:{market:'zh-TW',domains:['cna.com.tw','ltn.com.tw','udn.com','ettoday.net','tsna.com.tw','cpbl.com.tw']},
  GB:{market:'en-GB',domains:['bbc.com','skysports.com','theguardian.com']},
  ES:{market:'es-ES',domains:['marca.com','as.com','mundodeportivo.com','sport.es','relevo.com']},
  IT:{market:'it-IT',domains:['gazzetta.it','corrieredellosport.it','tuttosport.com','sport.sky.it','eurosport.it']},
  DE:{market:'de-DE',domains:['kicker.de','sportschau.de','sport1.de','ran.de','bild.de']},
  FR:{market:'fr-FR',domains:['lequipe.fr','rmcsport.bfmtv.com','eurosport.fr','footmercato.net']},
  BR:{market:'pt-BR',domains:['ge.globo.com','uol.com.br','lance.com.br','gazetaesportiva.com']},
  MX:{market:'es-MX',domains:['record.com.mx','mediotiempo.com','tudn.com']},
  AR:{market:'es-AR',domains:['ole.com.ar','tycsports.com']},
  PT:{market:'pt-PT',domains:['abola.pt','record.pt','ojogo.pt']},
  NL:{market:'nl-NL',domains:['nos.nl','vi.nl','ad.nl','voetbalprimeur.nl']},
  BE:{market:'nl-BE',domains:['sporza.be','rtbf.be','vrt.be']},
  TR:{market:'tr-TR',domains:['trtspor.com.tr','fanatik.com.tr','ntvspor.net']},
  AU:{market:'en-AU',domains:['abc.net.au','foxsports.com.au','sen.com.au']},
  NZ:{market:'en-NZ',domains:['stuff.co.nz','nzherald.co.nz']},
  ZA:{market:'en-ZA',domains:['supersport.com','sport24.co.za']},
  IN:{market:'en-IN',domains:['sportstar.thehindu.com','hindustantimes.com']},
  CN:{market:'zh-CN',domains:['sports.sina.com.cn','sports.qq.com','thepaper.cn']},
  PL:{market:'pl-PL',domains:['sport.pl','sportowefakty.wp.pl']},
  CZ:{market:'cs-CZ',domains:['sport.cz','isport.blesk.cz']},
  GR:{market:'el-GR',domains:['sport24.gr','gazzetta.gr','novasports.gr']},
  AT:{market:'de-AT',domains:['laola1.at','kurier.at']},
  CH:{market:'de-CH',domains:['srf.ch','20min.ch']},
  SE:{market:'sv-SE',domains:['svt.se','aftonbladet.se','expressen.se']},
  NO:{market:'nb-NO',domains:['nrk.no','tv2.no','vg.no']},
  DK:{market:'da-DK',domains:['dr.dk','tv2.dk','bold.dk']},
  FI:{market:'fi-FI',domains:['yle.fi','mtvuutiset.fi','iltalehti.fi']},
  ID:{market:'id-ID',domains:['kompas.com','detik.com','bola.net']},
  MY:{market:'ms-MY',domains:['thestar.com.my','malaymail.com','bharian.com.my']},
  TH:{market:'th-TH',domains:['thairath.co.th','siamsport.co.th']},
  SG:{market:'en-SG',domains:['straitstimes.com','channelnewsasia.com']},
  IE:{market:'en-IE',domains:['rte.ie','irishtimes.com']},
  HU:{market:'hu-HU',domains:['nemzetisport.hu','nso.hu']}
};

const LEAGUE = {
  MLB:['MLB','Major League Baseball'], NPB:['NPB','Nippon Professional Baseball','日本プロ野球','日本職棒'], KBO:['KBO','Korea Baseball Organization','KBO리그','한국프로야구','韓國職棒'], CPBL:['CPBL','Chinese Professional Baseball League','中華職棒','中職'], WBC:['World Baseball Classic','WBC','世界棒球經典賽'], WBSC:['WBSC','World Baseball Softball Confederation'], MiLB:['MiLB','Minor League Baseball'],
  NBA:['NBA','National Basketball Association'], WNBA:['WNBA',"Women's National Basketball Association"], FIBA:['FIBA','International Basketball Federation'], EuroLeague:['EuroLeague'], 'P.LEAGUE+':['P.LEAGUE+','P+ LEAGUE'], T1:['T1 League','T1 basketball'], SBL:['Super Basketball League','SBL'],
  世界盃:['FIFA World Cup','World Cup','世界盃'], 歐冠:['UEFA Champions League','Champions League','歐冠'], 英超:['Premier League','English Premier League','英超'], 西甲:['La Liga','Spanish La Liga','西甲'], 意甲:['Serie A','Italian Serie A','意甲'], 德甲:['Bundesliga','German Bundesliga','德甲'], 法甲:['Ligue 1','French Ligue 1','法甲'], MLS:['Major League Soccer','MLS'],
  ATP:['ATP','ATP Tour'], WTA:['WTA','WTA Tour'], 四大滿貫:['Grand Slam','Wimbledon','US Open','French Open','Roland Garros','Australian Open'], 'Davis Cup':['Davis Cup'], 'Billie Jean King Cup':['Billie Jean King Cup'],
  F1:['Formula 1','Formula One','F1'], MotoGP:['MotoGP'], WEC:['World Endurance Championship','WEC'], NASCAR:['NASCAR'], IndyCar:['IndyCar'], 'Formula E':['Formula E'], 'Formula 2':['Formula 2','F2'],
  BWF:['BWF','Badminton World Federation'], 湯姆斯盃:['Thomas Cup','湯姆斯盃'], 尤伯盃:['Uber Cup','尤伯盃'], 蘇迪曼盃:['Sudirman Cup','蘇迪曼盃'], WTT:['WTT','World Table Tennis'], ITTF:['ITTF','International Table Tennis Federation'], VNL:['Volleyball Nations League','VNL'], FIVB:['FIVB','International Volleyball Federation'], NHL:['NHL','National Hockey League'], IIHF:['IIHF','International Ice Hockey Federation'],
  PGA:['PGA Tour','PGA'], LPGA:['LPGA Tour','LPGA'], 'DP World Tour':['DP World Tour','European Tour'], 'Ryder Cup':['Ryder Cup'], 'U.S. Open':['U.S. Open'],
  'WBC Boxing':['World Boxing Council','WBC Boxing'], WBA:['World Boxing Association','WBA'], IBF:['International Boxing Federation','IBF'], WBO:['World Boxing Organization','WBO'], UFC:['UFC','Ultimate Fighting Championship'], PFL:['PFL','Professional Fighters League'], 'ONE Championship':['ONE Championship','ONE Fight Night'], Bellator:['Bellator'],
  'World Athletics':['World Athletics'], 'Diamond League':['Diamond League'], 'World Aquatics':['World Aquatics'], FIG:['FIG','International Gymnastics Federation'], UCI:['UCI','Union Cycliste Internationale'], 'Tour de France':['Tour de France'], 'Giro d’Italia':['Giro d’Italia',"Giro d'Italia"], 'Vuelta a España':['Vuelta a España','Vuelta a Espana'],
  'League of Legends':['League of Legends'], LCK:['LCK','League of Legends Champions Korea'], LPL:['LPL','League of Legends Pro League'], LEC:['LEC','League of Legends EMEA Championship'], LCS:['LCS','League of Legends Championship Series'], Valorant:['Valorant','VALORANT'], VCT:['Valorant Champions Tour','VCT'], CS2:['Counter-Strike 2','CS2'], BLAST:['BLAST Premier','BLAST'], ESL:['ESL','ESL Pro League'], 'Dota 2':['Dota 2','Dota2'],
  'Rugby World Cup':['Rugby World Cup'], 'Six Nations':['Six Nations'], 'The Rugby Championship':['The Rugby Championship'], NFL:['NFL','National Football League'], NCAA:['NCAA','College Football','NCAA Football'], 'Super Bowl':['Super Bowl'], IHF:['IHF','International Handball Federation'], EHF:['EHF','European Handball Federation'], FIH:['FIH','International Hockey Federation'], 'Hockey World Cup':['Hockey World Cup'], FIS:['FIS','International Ski Federation'], 'World Archery':['World Archery'], FIE:['FIE','International Fencing Federation'], IWF:['IWF','International Weightlifting Federation'], IJF:['IJF','International Judo Federation'], 'World Taekwondo':['World Taekwondo'], FEI:['FEI','Fédération Equestre Internationale'], 'World Triathlon':['World Triathlon'], IRONMAN:['IRONMAN']
};

const PACK = {
  MLB:['US','CA'], NPB:['JP'], KBO:['KR'], CPBL:['TW'], WBC:['US','JP','KR','TW'], WBSC:['JP','US','TW','KR'], MiLB:['US'],
  NBA:['US','CA'], WNBA:['US','CA'], FIBA:['ES','FR','IT','DE'], EuroLeague:['ES','GR','IT','TR'], 'P.LEAGUE+':['TW'], T1:['TW'], SBL:['TW'],
  世界盃:['GB','ES','FR','DE'], 歐冠:['GB','ES','FR','DE'], 英超:['GB'], 西甲:['ES'], 意甲:['IT'], 德甲:['DE'], 法甲:['FR'], MLS:['US','CA'],
  ATP:['US','GB','FR','ES'], WTA:['US','GB','FR','ES'], 四大滿貫:['AU','GB','FR','US'], 'Davis Cup':['GB','FR','ES','US'], 'Billie Jean King Cup':['GB','FR','ES','US'],
  F1:['GB','IT','ES','FR'], MotoGP:['IT','ES','FR'], WEC:['FR','GB','DE','IT'], NASCAR:['US'], IndyCar:['US'], 'Formula E':['GB','DE','FR'], 'Formula 2':['GB','IT'],
  BWF:['MY','ID','JP','KR'], 湯姆斯盃:['ID','MY','CN','JP'], 尤伯盃:['CN','JP','KR','ID'], 蘇迪曼盃:['CN','JP','KR','ID'], WTT:['CN','JP','KR','DE'], ITTF:['CN','JP','KR','DE'], VNL:['IT','BR','PL','JP'], FIVB:['IT','BR','PL','JP'], NHL:['CA','US','SE','FI'], IIHF:['CA','US','SE','FI'],
  PGA:['US','GB'], LPGA:['US','JP'], 'DP World Tour':['GB','ES','DE','FR'], 'Ryder Cup':['US','GB','ES','FR'], 'U.S. Open':['US'], 'WBC Boxing':['US','MX','GB'], WBA:['US','MX','GB'], IBF:['US','GB','MX'], WBO:['US','GB','MX'], UFC:['US','GB','BR'], PFL:['US','GB'], 'ONE Championship':['TH','SG','JP'], Bellator:['US','GB'],
  'World Athletics':['US','GB','FR','DE'], 'Diamond League':['GB','FR','DE','IT'], 'World Aquatics':['US','AU','GB','JP'], FIG:['US','JP','GB','FR'], UCI:['FR','IT','ES','BE'], 'Tour de France':['FR','BE','NL','GB'], 'Giro d’Italia':['IT','FR','BE','NL'], 'Vuelta a España':['ES','FR','IT'],
  'League of Legends':['KR','CN','US','DE'], LCK:['KR'], LPL:['CN'], LEC:['DE','FR','ES','GB'], LCS:['US','CA'], Valorant:['KR','US','BR','DE'], VCT:['KR','US','BR','DE'], CS2:['DE','GB','US','FR'], BLAST:['DK','GB','DE','FR'], ESL:['DE','GB','US','FR'], 'Dota 2':['CN','US','DE','SE'],
  'Rugby World Cup':['GB','FR','NZ','AU'], 'Six Nations':['GB','FR','IE'], 'The Rugby Championship':['NZ','AU','ZA','AR'], NFL:['US','CA'], NCAA:['US'], 'Super Bowl':['US','CA'], IHF:['DE','FR','ES','DK'], EHF:['DE','FR','ES','DK'], FIH:['NL','IN','DE','BE'], 'Hockey World Cup':['NL','IN','DE','BE'], FIS:['AT','CH','NO','SE'], 'World Archery':['KR','CN','US','FR'], FIE:['FR','IT','HU','US'], IWF:['CN','US','DE','GB'], IJF:['JP','FR','BR'], 'World Taekwondo':['KR','US','FR','GB'], FEI:['GB','DE','FR','US'], 'World Triathlon':['GB','US','AU','ES'], IRONMAN:['US','AU','GB','ES']
};
const SPORT_COUNTRIES = {
  棒球:['JP','US','KR','TW'], 籃球:['US','CA','ES','FR'], 足球:['GB','ES','IT','DE','FR','BR'], 網球:['US','GB','FR','ES'], 賽車:['GB','IT','ES','FR'], 羽球:['MY','ID','JP','KR'], 桌球:['CN','JP','KR','DE'], 排球:['IT','BR','PL','JP'], 冰球:['CA','US','SE','FI'], 高爾夫:['US','GB','JP','AU'], 拳擊:['US','GB','MX','BR'], MMA:['US','GB','BR'], 田徑:['US','GB','FR','DE'], 游泳:['US','AU','GB','JP'], 體操:['US','JP','GB','FR'], 自行車:['FR','IT','ES','BE'], 電競:['KR','CN','US','DE'], 橄欖球:['GB','FR','NZ','AU'], 美式足球:['US','CA'], 手球:['DE','FR','ES','DK'], 曲棍球:['NL','IN','DE','BE'], 滑雪:['AT','CH','NO','SE'], 射箭:['KR','CN','US','FR'], 擊劍:['FR','IT','HU','US'], 舉重:['CN','US','DE','GB'], 柔道:['JP','FR','BR'], 跆拳道:['KR','US','FR','GB'], 馬術:['GB','DE','FR','US'], 三鐵:['GB','US','AU','ES']
};
const SPORT_LEAGUES = {
  棒球:['MLB','NPB','KBO','CPBL','WBC','WBSC','MiLB'], 籃球:['NBA','WNBA','FIBA','EuroLeague','P.LEAGUE+','T1','SBL'], 足球:['世界盃','歐冠','英超','西甲','意甲','德甲','法甲','MLS'], 網球:['ATP','WTA','四大滿貫','Davis Cup','Billie Jean King Cup'], 賽車:['F1','MotoGP','WEC','NASCAR','IndyCar','Formula E','Formula 2'], 羽球:['BWF','湯姆斯盃','尤伯盃','蘇迪曼盃'], 桌球:['WTT','ITTF'], 排球:['VNL','FIVB'], 冰球:['NHL','IIHF'], 高爾夫:['PGA','LPGA','DP World Tour','Ryder Cup','U.S. Open'], 拳擊:['WBC Boxing','WBA','IBF','WBO'], MMA:['UFC','PFL','ONE Championship','Bellator'], 田徑:['World Athletics','Diamond League'], 游泳:['World Aquatics'], 體操:['FIG'], 自行車:['UCI','Tour de France','Giro d’Italia','Vuelta a España'], 電競:['League of Legends','LCK','LPL','LEC','LCS','Valorant','VCT','CS2','BLAST','ESL','Dota 2'], 橄欖球:['Rugby World Cup','Six Nations','The Rugby Championship'], 美式足球:['NFL','NCAA','Super Bowl'], 手球:['IHF','EHF'], 曲棍球:['FIH','Hockey World Cup'], 滑雪:['FIS'], 射箭:['World Archery'], 擊劍:['FIE'], 舉重:['IWF'], 柔道:['IJF'], 跆拳道:['World Taekwondo'], 馬術:['FEI'], 三鐵:['World Triathlon','IRONMAN']
};

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

function clean(s=''){return String(s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();}
function parseDate(v){if(!v)return new Date().toISOString(); const d=new Date(v); return Number.isFinite(d.getTime())?d.toISOString():new Date().toISOString();}
function norm(s){return clean(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\b(the|a|an|and|of|to|in|on|for|with|news|update|latest|breaking|official|report|reports|sport|sports)\b/g,' ').replace(/\s+/g,' ').trim().slice(0,180);}
function classify(title){let hits=Object.entries(TYPE).filter(([,r])=>r.test(title)).map(([k])=>k);if(hits.includes('傷勢更新'))hits=hits.filter(x=>x!=='受傷');if(hits.includes('世界／聯盟紀錄'))hits=hits.filter(x=>x!=='生涯紀錄');return hits.length?hits:['其他重要新聞'];}
function parseRss(xml,lang){const out=[];const items=String(xml).match(/<item>[\s\S]*?<\/item>/gi)||[];for(const item of items){const m=(tag)=>{const x=item.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`,'i'));return x?clean(x[1]):''};const title=m('title');const link=m('link')||((item.match(/<link>([^<]+)/i)||[])[1]||'');const pub=m('pubDate')||m('published')||m('updated');const sm=item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);const source=sm?clean(sm[1]):'Google News';if(title&&link)out.push({title,url:link,sourceName:source,publishedAt:parseDate(pub),language:lang});}return out;}
async function fetchText(url,ms=4500){const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),ms);try{const r=await fetch(url,{signal:ac.signal,headers:{'user-agent':'SportsDaily/7.0','accept':'application/rss+xml,application/xml,text/xml'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}finally{clearTimeout(timer);}}
function googleUrl(q,market){const [lang,cc]=market.split('-');return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${encodeURIComponent(market)}&gl=${cc}&ceid=${cc}:${lang}`;}
function queryFor(section,cfg){const league=section.league||'全部';const sport=section.sport||'棒球';const terms=league!=='全部'?(LEAGUE[league]||[league]):([sport,...(SPORT_LEAGUES[sport]||[])]);const t=terms.slice(0,6).map(x=>`"${x}"`).join(' OR ');const sites=cfg.domains.slice(0,6).map(x=>`site:${x}`).join(' OR ');return `(${t}) (${sites}) when:${Math.min(7,Math.max(1,Math.ceil((Number(section.hours)||24)/24)))}d`;}
function countryList(section){if(section.league&&PACK[section.league])return PACK[section.league].filter(x=>COUNTRY[x]).slice(0,4);if(section.sport&&SPORT_COUNTRIES[section.sport])return SPORT_COUNTRIES[section.sport].filter(x=>COUNTRY[x]).slice(0,4);return ['US','GB','JP','KR'];}
function domainOf(url){
  try{return new URL(String(url||'')).hostname.replace(/^www\./,'').toLowerCase();}
  catch{return '';}
}
function leagueAccept(title,section,url=''){
  const league=String(section.league||'全部');
  const sport=String(section.sport||'棒球');
  const text=String(title||'').toLowerCase();
  if(league==='全部'){
    const terms=[sport,...(SPORT_LEAGUES[sport]||[])].map(String);
    return terms.some(t=>text.includes(t.toLowerCase())) || sport==='棒球';
  }
  const direct=(LEAGUE[league]||[league]).some(t=>text.includes(String(t).toLowerCase()));
  if(direct)return true;
  const domain=domainOf(url);
  const countries=countryList(section);
  for(const code of countries){
    const cfg=COUNTRY[code];
    if(cfg && cfg.domains.some(d=>domain===d || domain.endsWith('.'+d))) return true;
  }
  return false;
}
function buildArticle(raw,section){const eventTypes=classify(raw.title);return {...raw,sport:section.sport,league:section.league,eventType:eventTypes[0],eventTypes,eventId:`${section.sport}|${section.league}|${norm(raw.title)}`,sourceCount:1,languages:[raw.language],relatedSources:[raw.sourceName]};}
async function one(section){const map=new Map();const countries=countryList(section);const jobs=[];for(const code of countries){const cfg=COUNTRY[code];if(!cfg)continue;jobs.push(fetchText(googleUrl(queryFor(section,cfg),cfg.market)).then(x=>[code,parseRss(x,cfg.market)]).catch(()=>[code,[]]));}const rs=await Promise.all(jobs);for(const [code,items] of rs){for(const raw of items){const title=raw.title;if(LOW_VALUE.test(title) && classify(title)[0]==='其他重要新聞')continue;if(!leagueAccept(title,section,raw.url))continue;const a=buildArticle(raw,section);const k=norm(title);if(!k)continue;const old=map.get(k);if(!old)map.set(k,a);else{old.sourceCount++;for(const l of a.languages)if(!old.languages.includes(l))old.languages.push(l);if(!old.relatedSources.includes(a.sourceName))old.relatedSources.push(a.sourceName);for(const t of a.eventTypes)if(!old.eventTypes.includes(t)&&t!=='其他重要新聞')old.eventTypes.push(t);if(Date.parse(a.publishedAt)>Date.parse(old.publishedAt))Object.assign(old,{title:a.title,url:a.url,sourceName:a.sourceName,publishedAt:a.publishedAt});}}}return Array.from(map.values()).sort((a,b)=>b.sourceCount-a.sourceCount||Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,80);}

module.exports = async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  try{
    const sections=Array.isArray(req.body?.sections)?req.body.sections.slice(0,20):[];
    const rr=await Promise.allSettled(sections.map(one));
    const items=[];const errors=[];
    rr.forEach((r,i)=>{if(r.status==='fulfilled')items.push(...r.value);else errors.push(`${sections[i]?.sport||''}/${sections[i]?.league||''}`)});
    return res.status(200).json({version:'vercel-localized-2',fetchedAt:new Date().toISOString(),items,count:items.length,errors});
  }catch(e){return res.status(500).json({version:'vercel-localized-2',items:[],count:0,error:String(e)})}
};
