const {incr}=require('./redis');
const memory=new Map();

function ipOf(req){
  const raw=req?.headers?.['x-forwarded-for'] || req?.headers?.['x-real-ip'] || req?.socket?.remoteAddress || 'unknown';
  return String(raw).split(',')[0].trim().slice(0,80)||'unknown';
}

async function allow(req,route,limit=20,windowMs=60000){
  const ip=ipOf(req);
  const bucket=Math.floor(Date.now()/windowMs);
  const key=`sd:rate:v3:${route}:${ip}:${bucket}`;
  const persistent=await incr(key,windowMs);
  if(persistent!=null) return {ok:persistent<=limit,count:persistent,limit};

  const memKey=`${route}|${ip}|${bucket}`;
  const n=(memory.get(memKey)||0)+1;
  memory.set(memKey,n);
  if(memory.size>3000){
    for(const k of memory.keys()){
      const parts=k.split('|');
      if(Number(parts.at(-1))<bucket-1) memory.delete(k);
      if(memory.size<=2400)break;
    }
  }
  return {ok:n<=limit,count:n,limit};
}
module.exports={allow,ipOf};
