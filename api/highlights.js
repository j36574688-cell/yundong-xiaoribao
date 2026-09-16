const news=require('./news.js');
const {allow:rateLimit}=require('./lib/rate-limit');

module.exports=async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='GET')return res.status(405).json({version:'highlights-v1',error:'GET only',items:[],count:0});
  try{
    const rl=await rateLimit(req,'highlights',30,60000);
    if(!rl.ok)return res.status(429).json({version:'highlights-v1',error:'rate_limit_exceeded',items:[],count:0});
    const history=String(req.query?.history||'').toLowerCase()==='1';
    if(history){
      const days=Math.min(30,Math.max(1,Number(req.query?.days)||7));
      const out=[]; const now=Date.now();
      for(let i=0;i<days;i++){
        const d=new Date(now-i*86400000).toISOString().slice(0,10);
        const v=await news.__loadHighlights(d);
        if(v)out.push(v);
      }
      return res.status(200).json({version:'highlights-history-v1',days,items:out,count:out.length,generatedAt:new Date().toISOString()});
    }
    const force=String(req.query?.refresh||'')==='1';
    const v=await news.__generateHighlights(force);
    return res.status(200).json(v);
  }catch(e){
    return res.status(200).json({version:'highlights-v1',generatedAt:new Date().toISOString(),items:[],count:0,sourceSections:[],error:String(e?.message||e)});
  }
};
