const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const crypto = require('crypto');

(async () => {
  const leagues = ['Liga Pro','Setka Cup','TT Cup Series','Win Cup','Bull Cup','Czech Liga Pro'];
  const pools = {
    'Liga Pro': ['Mikhail Zhukov','Pavel Favorskiy','Dmitry Bakanov','Alexey Smirnov','Ivan Bragin','Sergey Petrov','Andrey Korneev','Nikolai Loginov','Vladislav Makarov','Denis Kulikov','Roman Litvinov','Evgeny Fadeev'],
    'Setka Cup': ['Boris Grozdev','Viktor Lebedev','Alexei Vasiliev','Oleg Sokolov','Dmitry Shklovsky','Konstantin Belov','Pavel Mironov','Ilya Sorokin','Artur Dementyev','Egor Ivanov','Maxim Petrov','Kirill Nosov'],
    'TT Cup Series': ['Ruslan Chervyakov','Dmitry Bobrov','Pavel Dyachenko','Alexei Yumashev','Vladimir Samsonov','Timur Radionov','Sergey Tkach','Anton Gutorov'],
    'Win Cup': ['Pavel Platonov','Mikhail Korolev','Denis Usynin','Alexei Sadovnikov','Igor Morozov','Grigory Vlasov','Vitaly Nesterenko','Daniil Moskvin'],
    'Bull Cup': ['Aleksandr Kudryavtsev','Pavel Kostrov','Fedor Kuznetsov','Nikita Ryumin','Eduard Grachev','Maxim Zhuravlev','Andrey Smirnov','Vasily Yakovlev'],
    'Czech Liga Pro': ['Josef Obdrzalek','Lukas Pecha','Jan Mikula','Tomas Konecny','Martin Sevcik','David Reznicek','Pavel Jansa','Roman Skypala']
  };
  const now = new Date();
  let created = 0;

  for (let i = 0; i < 8; i++) {
    const league = leagues[i % leagues.length];
    const pool = pools[league];
    const i1 = Math.floor(Math.random() * pool.length);
    let i2 = Math.floor(Math.random() * (pool.length - 1));
    if (i2 >= i1) i2++;
    const p1 = pool[i1], p2 = pool[i2];
    const base = 1.15 + Math.random() * 0.85;
    const spread = 0.3 + Math.random() * 0.7;
    const o1 = Math.round(Math.min(base, base+spread)*100)/100;
    const o2 = Math.round(Math.max(base, base+spread)*100)/100;
    const key = p1+'|'+p2+'|'+league+'|tt_circuit';
    const extId = 'ext_'+crypto.createHash('md5').update(key).digest('hex').slice(0,12);
    const st = new Date(now.getTime() + (i*30+Math.random()*20)*60000);
    try {
      const m = await db.match.create({data:{externalId:extId,source:'tt_circuit_2025',sport:'table_tennis',league,player1:p1,player2:p2,startTime:st,status:i<3?'live':'upcoming',score1:0,score2:0}});
      await db.bookmakerOdds.create({data:{matchId:m.id,source:'tt_circuit_2025',odds1:o1,odds2:o2}});
      created++;
    } catch(e) { console.log('skip',e.message); }
  }

  const fp = [...pools['Liga Pro'].slice(0,6),...pools['Setka Cup'].slice(0,6),...pools['TT Cup Series'].slice(0,4)];
  for (let i = 0; i < 12; i++) {
    const league = leagues[i % leagues.length];
    const p1 = fp[i], p2 = fp[(i+3)%fp.length];
    if (p1===p2) continue;
    const s1 = Math.random()>0.5?(Math.random()>0.3?3:2):1;
    const s2 = s1>=3?Math.floor(Math.random()*2):(s1>=2?(Math.random()>0.5?3:1):(Math.random()>0.4?3:2));
    const winner = s1>s2?p1:p2;
    const key = p1+'|'+p2+'|'+league+'|tt_circuit';
    const extId = 'ext_'+crypto.createHash('md5').update(key).digest('hex').slice(0,12);
    const st = new Date(now.getTime()-(1+i*2+Math.random()*3)*3600000);
    const base = 1.15+Math.random()*0.85;
    const spread = 0.3+Math.random()*0.7;
    const o1 = Math.round(Math.min(base,base+spread)*100)/100;
    const o2 = Math.round(Math.max(base,base+spread)*100)/100;
    try {
      const m = await db.match.create({data:{externalId:extId,source:'tt_circuit_2025',sport:'table_tennis',league,player1:p1,player2:p2,startTime:st,status:'finished',score1:s1,score2:s2,winner}});
      await db.bookmakerOdds.create({data:{matchId:m.id,source:'tt_circuit_2025',odds1:o1,odds2:o2}});
      created++;
    } catch(e) {}
  }
  console.log('Matches created: ' + created);
  await db.collectionLog.create({data:{source:'seed_script',status:'success',matchesFound:created,matchesCollected:created,matchesNew:created,matchesUpdated:0,duration:0}});
  await db.$disconnect();
})();
