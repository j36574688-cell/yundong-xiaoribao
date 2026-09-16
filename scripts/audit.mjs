import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const require=createRequire(import.meta.url);
process.env.NEWS_AUDIT_EXPORT='1';
const news=require(path.join(root,'api','news.js'));
const a=news.__audit;
const sports=JSON.parse(fs.readFileSync(path.join(root,'config','sports.v1.json'),'utf8'));
const leagues=JSON.parse(fs.readFileSync(path.join(root,'config','leagues.v1.json'),'utf8'));
const types=JSON.parse(fs.readFileSync(path.join(root,'config','content-types.v1.json'),'utf8'));
const sources=JSON.parse(fs.readFileSync(path.join(root,'config','sources.v1.json'),'utf8'));
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const errors=[]; const notes=[]; const eq=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
if(!a) errors.push('NEWS_AUDIT_EXPORT 未能取得 __audit。');
if(a){
  const auditSports=Object.keys(a.SPORT_COUNTRIES);
  const auditTypes=Object.keys(a.TYPE);
  if(!eq(sports,auditSports)) errors.push('sports.v1.json 與 backend SPORT_COUNTRIES 不一致');
  if(!eq(leagues,a.SPORT_LEAGUES)) errors.push('leagues.v1.json 與 backend SPORT_LEAGUES 不一致');
  if(!eq(types,auditTypes)) errors.push('content-types.v1.json 與 backend TYPE 不一致');
  if(!eq(sources.COUNTRY,a.COUNTRY)) errors.push('sources.v1.json COUNTRY 不一致');
  if(!eq(sources.LEAGUE,a.LEAGUE)) errors.push('sources.v1.json LEAGUE 不一致');
  if(!eq(sources.PACK,a.PACK)) errors.push('sources.v1.json PACK 不一致');
  if(!eq(sources.SPORT_COUNTRIES,a.SPORT_COUNTRIES)) errors.push('sources.v1.json SPORT_COUNTRIES 不一致');
  if(!eq(sources.SPORT_LEAGUES,a.SPORT_LEAGUES)) errors.push('sources.v1.json SPORT_LEAGUES 不一致');
  if(!eq(sources.ESPORTS_SITES,a.ESPORTS_SITES)) errors.push('sources.v1.json ESPORTS_SITES 不一致');
  if(!eq(sources.ESPORTS_RULES,a.ESPORTS_RULES)) errors.push('sources.v1.json ESPORTS_RULES 不一致');
  if(a.CONFIG_VERSION!=='1.0.0') errors.push(`CONFIG_VERSION 異常：${a.CONFIG_VERSION}`);
  if(a.API_CONTRACT_VERSION!=='1.0') errors.push(`API_CONTRACT_VERSION 異常：${a.API_CONTRACT_VERSION}`);
  if(!['v1','v2'].includes(a.HEAT_ALGORITHM_VERSION)) errors.push(`HEAT_ALGORITHM_VERSION 異常：${a.HEAT_ALGORITHM_VERSION}`);
  const totalLeagues=Object.values(a.SPORT_LEAGUES).reduce((n,x)=>n+x.length,0);
  notes.push(`sports=${auditSports.length}`);
  notes.push(`leagues=${totalLeagues}`);
  notes.push(`contentTypes=${auditTypes.length}`);
  notes.push(`esportsLeagues=${Object.keys(a.ESPORTS_SITES).length}`);
  const missingFrontSports=auditSports.filter(s=>!index.includes(s));
  if(missingFrontSports.length) errors.push(`index.html 可能缺少 sport：${missingFrontSports.join(',')}`);
}
for(const f of ['index.html','api/news.js','api/translate.js','config/sports.v1.json','config/leagues.v1.json','config/content-types.v1.json','config/sources.v1.json']){
  if(!fs.existsSync(path.join(root,f)))errors.push(`缺少檔案：${f}`);
}
console.log('=== 運動小日報 Architecture v4 Audit ===');
console.log(notes.join(' | '));
if(errors.length){console.error(`FAIL (${errors.length})`);for(const e of errors)console.error('- '+e);process.exit(1);}
console.log('PASS：config、backend 與核心檔案完整。');
