import path from 'node:path';
import { createRequire } from 'node:module';
const root=path.resolve(new URL('..',import.meta.url).pathname);
process.env.NEWS_AUDIT_EXPORT='1';
const require=createRequire(import.meta.url);

function responseFor(req){
  let statusCode=200, body=null;
  return {setHeader(){},status(code){statusCode=code;return this;},json(v){body=v;return v;},end(){return null;},_get(){return {statusCode,body};}};
}

const RSS=(title,source,url)=>`<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://example.com/${encodeURIComponent(title)}</link><pubDate>${new Date().toUTCString()}</pubDate><source url="${url}">${source}</source></item></channel></rss>`;

globalThis.fetch=async(url)=>{
  const u=String(url);
  const dec=decodeURIComponent(u);
  let title='NHL player suffers an injury'; let source='NHL.com'; let sourceUrl='https://www.nhl.com';
  if(dec.includes('LPL')||dec.includes('英雄联盟职业联赛')){title='LPL team announces new roster';source='WanPlus';sourceUrl='https://www.wanplus.cn';}
  if(dec.includes('受傷') || dec.includes('injury')){title='NHL player suffers an injury';source='NHL.com';sourceUrl='https://www.nhl.com';}
  return {ok:true,status:200,text:async()=>RSS(title,source,sourceUrl)};
};

const news=require(path.join(root,'api','news.js'));
const a=news.__audit;
const {leagueAccept,typeAccept}=a;
const assert=(cond,msg)=>{if(!cond)throw new Error(msg)};
assert(leagueAccept('Toronto player update',{sport:'冰球',league:'NHL'},'https://example.com','https://www.nhl.com'),'NHL known-source headline should be accepted');
assert(!leagueAccept('KBO playoff result',{sport:'棒球',league:'MLB'},'https://example.com','https://sports.yahoo.com'),'MLB must reject KBO headline');
assert(leagueAccept('LPL roster update',{sport:'電競',league:'LPL'}),'generic LPL alias should be recognized by league rules');
assert(typeAccept('NHL player suffers an injury',{sport:'冰球',league:'NHL',contentTypes:['受傷']}),'受傷 filter should accept injury headline');
assert(!typeAccept('NHL player announces retirement',{sport:'冰球',league:'NHL',contentTypes:['受傷']}),'受傷 filter should reject unrelated headline');

const req={method:'POST',body:{sections:[{id:'s1',sport:'冰球',league:'NHL',contentTypes:['受傷'],hours:24}]}};
const res=responseFor(req);
await news(req,res);
const out=res._get();
assert(out.statusCode===200,'API handler should return 200');
assert(out.body&&Array.isArray(out.body.items),'API items should be an array');
assert(out.body.contractVersion==='1.0','API contract version should be 1.0');
assert(out.body.items.every(x=>x.sport==='冰球'&&x.league==='NHL'),'NHL route must not leak other sports/leagues');
assert(out.body.items.every(x=>x.heat>=0&&x.heat<=100),'heat must stay within 0-100');
console.log('PASS：league hard filter、content type hard filter、API contract 與 heat 範圍 regression test 通過。');
