import path from 'node:path';
import { createRequire } from 'node:module';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const require=createRequire(import.meta.url);
process.env.NEWS_AUDIT_EXPORT='1';
const news=require(path.join(root,'api','news.js'));
const {validateContractPayload}=news.__audit;
const valid={contractVersion:'1.0',fetchedAt:new Date().toISOString(),items:[{
  id:'1',sectionId:'s',title:'Test',url:'https://example.com',sourceName:'Example',publishedAt:new Date().toISOString(),sport:'冰球',league:'NHL',eventType:'其他重要新聞',eventTypes:['其他重要新聞'],sourceCount:1,languages:['en-US'],relatedSources:['Example'],heat:50
}],count:1,errors:[],configVersion:'1.0.0',heatAlgorithmVersion:'v1'};
if(!validateContractPayload(valid).ok){console.error('FAIL：合法 payload 未通過');process.exit(1);}
const bad={...valid,items:[{...valid.items[0],heat:undefined}]};
if(validateContractPayload(bad).ok){console.error('FAIL：缺少必要欄位的 payload 卻通過');process.exit(1);}
console.log('PASS：API contract validator 可辨識合法與非法 payload。');
