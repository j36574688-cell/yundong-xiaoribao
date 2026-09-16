import {createRequire} from 'node:module';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
process.env.NEWS_AUDIT_EXPORT='1';
const require=createRequire(import.meta.url);
const news=require(path.join(root,'api','news.js'));
const a=news.__audit;
const assert=(x,m)=>{if(!x)throw new Error(m)};
const now=Date.now();
const mk=(id,sport,league,heat,sourceCount=1)=>({id,title:`${league} event ${id}`,url:`https://example.com/${id}`,sourceName:`Source${sourceCount}`,publishedAt:new Date(now-heat*60000).toISOString(),sport,league,eventType:'球隊／聯盟公告',eventTypes:['球隊／聯盟公告'],sourceCount,languages:['en-US'],relatedSources:[`Source${sourceCount}`],heat});
const values=[
 {items:[mk('a1','冰球','NHL',90,2),mk('a2','冰球','NHL',80,1)]},
 {items:[mk('b1','棒球','MLB',89,2),mk('b2','棒球','MLB',70,1),mk('b3','棒球','MLB',65,1)]},
 {items:[mk('c1','籃球','NBA',88,1),mk('c2','籃球','NBA',60,1)]}
];
const out=a.buildHighlights(values,5);
assert(Array.isArray(out)&&out.length===5,'five highlights should be produced');
const counts={}; for(const x of out)counts[x.sport]=(counts[x.sport]||0)+1;
assert(Object.values(counts).every(n=>n<=2),'diversity limit failed');
assert(out.every(x=>typeof x.highlightPercentile==='number'&&x.highlightPercentile>=0&&x.highlightPercentile<=100),'percentile missing');
assert(a.sourceAuthorityWeight({sourceUrl:'https://www.mlb.com/news/x'})>1,'official source authority weight failed');
assert(a.keywordMatches('Shohei Ohtani hits a home run',{keywords:['Ohtani','王威晨']}).length===1,'keyword matching failed');
console.log('PASS：百分位、同運動最多 2 篇、來源權威度、關鍵字追蹤五大頭條測試通過。');
