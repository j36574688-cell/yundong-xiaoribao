const news=require('./news.js');

const WARM_SECTIONS=[
  {id:'cron-nhl',name:'NHL 全部',sport:'冰球',league:'NHL',contentTypes:['全部'],hours:24},
  {id:'cron-mlb',name:'MLB 全部',sport:'棒球',league:'MLB',contentTypes:['全部'],hours:24},
  {id:'cron-npb',name:'NPB 比賽結果',sport:'棒球',league:'NPB',contentTypes:['比賽結果'],hours:72},
  {id:'cron-cpbl',name:'CPBL 全部',sport:'棒球',league:'CPBL',contentTypes:['全部'],hours:24},
  {id:'cron-nba',name:'NBA 全部',sport:'籃球',league:'NBA',contentTypes:['全部'],hours:24},
  {id:'cron-f1',name:'F1 全部',sport:'賽車',league:'F1',contentTypes:['全部'],hours:48},
  {id:'cron-lpl',name:'LPL 全部',sport:'電競',league:'LPL',contentTypes:['全部'],hours:72},
  {id:'cron-cs2',name:'CS2 全部',sport:'電競',league:'CS2',contentTypes:['全部'],hours:72}
];

function cronAuthorized(req){
  const secret=process.env.CRON_SECRET;
  if(!secret)return process.env.VERCEL !== '1';
  const auth=String(req.headers?.authorization||'');
  return auth===`Bearer ${secret}`;
}

module.exports=async(req,res)=>{
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
  if(!cronAuthorized(req))return res.status(401).json({ok:false,error:'unauthorized'});
  const fakeRes={code:200,body:null,setHeader(){},status(c){this.code=c;return this;},json(v){this.body=v;return v;},end(){}};
  let warmResult=null,highlightResult=null;
  try{
    await news({method:'POST',headers:{'x-internal-cron':'1',authorization:req.headers?.authorization||''},body:{sections:WARM_SECTIONS,forceRefresh:true}},fakeRes);
    warmResult={ok:(fakeRes.code||200)<300,count:Number(fakeRes.body?.count||0),errors:Array.isArray(fakeRes.body?.errors)?fakeRes.body.errors.slice(0,20):[]};
  }catch(e){warmResult={ok:false,count:0,errors:[String(e?.message||e)]};}
  try{
    highlightResult=await news.__generateHighlights(true);
  }catch(e){highlightResult={ok:false,error:String(e?.message||e),items:[],count:0};}
  const ok=Boolean(warmResult?.ok);
  return res.status(200).json({ok,warmed:WARM_SECTIONS.length,count:warmResult?.count||0,errors:warmResult?.errors||[],highlights:{ok:highlightResult?.ok!==false,count:Number(highlightResult?.count||0),version:highlightResult?.version||'x1'},fetchedAt:new Date().toISOString()});
};
