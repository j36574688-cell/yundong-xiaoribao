const news=require('./news.js');
const {allow:rateLimit}=require('./lib/rate-limit');
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function validUrl(v){try{return new URL(String(v)).href;}catch{return 'https://example.com/';}}
module.exports=async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='GET')return res.status(405).send('GET only');
  try{
    const rl=await rateLimit(req,'rss',20,60000); if(!rl.ok)return res.status(429).send('rate_limit_exceeded');
    const sport=String(req.query?.sport||'棒球');
    const league=String(req.query?.league||'全部');
    const hours=Math.max(1,Math.min(168,Number(req.query?.hours)||24));
    const rawTypes=String(req.query?.types||'全部').split(',').map(x=>x.trim()).filter(Boolean);
    const types=rawTypes.length?rawTypes:['全部'];
    const id=String(req.query?.id||`rss-${sport}-${league}`);
    const d=await news.__fetchForRss({id,sport,league,contentTypes:types,hours});
    const items=(d?.items||[]).slice(0,30);
    const now=new Date().toUTCString();
    const proto=String(req.headers?.['x-forwarded-proto']||'https').split(',')[0]; const host=String(req.headers?.host||'example.com');
    const selfBase=`${proto}://${host}`;
    const body=`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>運動小日報｜${esc(league==='全部'?sport:`${sport} ${league}`)}</title><link>${esc(selfBase)}</link><description>${esc('運動小日報 RSS')}</description><lastBuildDate>${esc(now)}</lastBuildDate>${items.map(x=>`<item><title>${esc(x.title)}</title><link>${esc(validUrl(x.url))}</link><guid isPermaLink="true">${esc(validUrl(x.url))}</guid><pubDate>${esc(new Date(x.publishedAt).toUTCString())}</pubDate><source>${esc(x.sourceName||'新聞來源')}</source><description>${esc(`${x.eventType||'其他重要新聞'}｜Heat ${Math.round(x.heat||0)}${x.sourceCount>1?`｜多來源 ${x.sourceCount}`:''}`)}</description></item>`).join('')}</channel></rss>`;
    res.setHeader('Content-Type','application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control','public, max-age=300');
    return res.status(200).send(body);
  }catch(e){res.setHeader('Content-Type','application/xml; charset=utf-8');return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>運動小日報</title><description>${esc(String(e?.message||e))}</description></channel></rss>`)}
};
