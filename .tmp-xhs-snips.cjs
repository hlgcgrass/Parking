const fs=require('fs'); const j=JSON.parse(fs.readFileSync('server/xhs-p0-candidates-41.json','utf8'));
const re=/(?:导航|定位|停在|停车场|车库|广场|大厦|中心|汽配城|酒店|公园|码头|医院|商场|路边)[^。！？；]{0,80}(?:停车|元|免费|封顶|收费|车位|步行|米|公里)/g;
for(const p of j.places){let arr=[]; for(const n of p.notes){for(const s of String(n.text).split(/(?<=[。！？；])/)){if(/停车|车位|收费|元|封顶|免费/.test(s)&&/(元|免费|封顶|收费)/.test(s)){let z=s.replace(/\s+/g,' ').trim(); if(z.length>260)z=z.slice(0,260); arr.push(z)}}} const uniq=[...new Set(arr)].slice(0,12); console.log('==='+p.place+'==='); console.log(uniq.join('\n'));}
