/**
 * seed-local-listings.js
 *
 * 在 local 网络数据库中批量创建演示房源与用户。
 * 使用 Hardhat 标准账号 0-9（5 房东 + 5 租客）。
 *
 * 用法:
 *   node scripts/seed-local-listings.js
 *   node scripts/seed-local-listings.js --clear   # 先清空已有 local 数据再写入
 */

process.env.CHAIN_ENV = 'local';

const path = require('path');
const fs = require('fs');
const { getDb, saveDb, migrate, parseResult } = require('../apps/backend/src/db');
const { getUserDb, saveUserDb, parseResult: parseUserResult } = require('../apps/backend/src/user-db');

// ── Hardhat 标准账号（测试专用） ───────────────────────────────────
const HARDHAT_ACCOUNTS = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // 0 - 房东
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // 1 - 房东
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // 2 - 房东
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906', // 3 - 房东
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', // 4 - 房东
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', // 5 - 租客
  '0x976EA74026E726554dB657fA54763abd0C3a0aa9', // 6 - 租客
  '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955', // 7 - 租客
  '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f', // 8 - 租客
  '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', // 9 - 租客
];

const LANDLORDS = HARDHAT_ACCOUNTS.slice(0, 5);
const TENANTS = HARDHAT_ACCOUNTS.slice(5, 10);

const LANDLORD_NICKNAMES = ['张伟', '李明', '王芳', '赵磊', '陈静'];
const TENANT_NICKNAMES  = ['刘洋', '杨雪', '孙博', '周晨', '吴燕'];

// ── 本地图片（复用 sepolia 上传的真实图片） ────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../apps/backend/data/uploads/listings');
function getAvailableImages() {
  try {
    return fs.readdirSync(UPLOADS_DIR)
      .filter(f => f.endsWith('.webp') || f.endsWith('.jpg'))
      .map(f => `/uploads/listings/${f}`);
  } catch {
    return [];
  }
}

function pickImages(allImages, count = 3) {
  if (allImages.length === 0) return [];
  const picked = [];
  const copy = [...allImages];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

// ── 房源数据 ──────────────────────────────────────────────────────
const LISTINGS_DATA = [
  // 朝阳区 - 4套
  {
    title: '朝阳望京精装一居室 近地铁',
    description: '位于望京SOHO附近，地铁14号线步行5分钟，周边商业配套齐全，超市、餐饮一应俱全。精装修，家电家具全配，拎包入住。楼层高视野好，南北通透采光佳。',
    address: '北京市朝阳区望京中环南路XX号院X栋XXX室',
    district: '朝阳区',
    rent_amount: '0.025',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 52,
    min_lease_months: 6,
  },
  {
    title: '朝阳国贸两居室 高层景观房',
    description: '国贸CBD核心区，步行可达国贸地铁站（1号线/10号线），楼下即商场。两室两厅一卫，精装修全配，高层视野开阔可俯瞰城市。适合商务人士居住。',
    address: '北京市朝阳区建国路XX号国际中心X座XXXX室',
    district: '朝阳区',
    rent_amount: '0.05',
    bedrooms: 2, livingrooms: 1, bathrooms: 1, area: 88,
    min_lease_months: 12,
  },
  {
    title: '朝阳三元桥三居室 适合家庭',
    description: '三元桥核心地段，地铁10号线/机场快线双轨交汇，交通极便利。三室两厅两卫，面积宽敞，采光好，适合三口之家入住。周边国际学校、医院、大型购物中心均在1km内。',
    address: '北京市朝阳区霄云路XX号霄云里小区X楼XXXX',
    district: '朝阳区',
    rent_amount: '0.08',
    bedrooms: 3, livingrooms: 2, bathrooms: 2, area: 135,
    min_lease_months: 12,
  },
  {
    title: '朝阳双井loft公寓 年轻人最爱',
    description: '双井地铁站步行3分钟，10号线直达，周边富力城、双花里生活圈。LOFT设计感满满，挑高4.8米，上下两层使用面积大，现代简约装修，适合独居年轻人或小情侣。',
    address: '北京市朝阳区广渠路XX号双井创意空间X座XXX',
    district: '朝阳区',
    rent_amount: '0.022',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 45,
    min_lease_months: 3,
  },

  // 海淀区 - 4套
  {
    title: '海淀中关村一居室 近北大清华',
    description: '中关村科技园核心地带，步行15分钟至北京大学/清华大学。地铁4号线中关村站附近，全精装修，家电家具全配。非常适合在中关村上班的IT人员或研究生。',
    address: '北京市海淀区中关村北大街XX号中关村公寓X栋XXX室',
    district: '海淀区',
    rent_amount: '0.03',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 58,
    min_lease_months: 6,
  },
  {
    title: '海淀五道口两居室 宇宙中心',
    description: '五道口商业区，地铁13号线五道口站旁，华清嘉园对面。周边餐饮、超市极为便利，生活气息浓厚。两室一厅，采光好，楼层适中，适合在附近高校工作的老师或科技公司员工。',
    address: '北京市海淀区成府路XX号华清嘉园X区X号楼XXXX',
    district: '海淀区',
    rent_amount: '0.045',
    bedrooms: 2, livingrooms: 1, bathrooms: 1, area: 82,
    min_lease_months: 6,
  },
  {
    title: '海淀上地IT精英公寓 整套出租',
    description: '上地软件园旁，紧邻地铁13号线上地站，周边百度、网易、联想总部林立。一室一厅精装，配置高档，网速稳定（千兆入户），适合IT从业者，拎包入住。',
    address: '北京市海淀区上地三街XX号上地嘉园X号楼XXXX',
    district: '海淀区',
    rent_amount: '0.028',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 55,
    min_lease_months: 6,
  },
  {
    title: '海淀西山三居室 大院子环境好',
    description: '西山风景区附近，空气好，绿化率高。三室两厅大户型，小区环境优美，物业好，停车方便。距地铁16号线苏州街站约2km，适合有私家车的家庭。',
    address: '北京市海淀区四季青路XX号西山庭院X区X号XXXX',
    district: '海淀区',
    rent_amount: '0.07',
    bedrooms: 3, livingrooms: 2, bathrooms: 2, area: 128,
    min_lease_months: 12,
  },

  // 西城区 - 3套
  {
    title: '西城金融街精装一居 商务首选',
    description: '金融街核心区，紧邻多家银行总部和证券公司，步行可达地铁4号线西单站。精装修，全家具家电，楼层高采光足，适合在金融街上班的精英人士。',
    address: '北京市西城区金融大街XX号财富中心X座XXXX',
    district: '西城区',
    rent_amount: '0.038',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 62,
    min_lease_months: 6,
  },
  {
    title: '西城德胜门老胡同四合院 独居院',
    description: '德胜门附近传统四合院，独立小院约80平，自住采光院落，有停车位。保留传统北京建筑风貌，已改造现代设施，暖气供暖，有独卫。适合喜欢胡同文化的租客。',
    address: '北京市西城区德内大街XX号胡同X号',
    district: '西城区',
    rent_amount: '0.06',
    bedrooms: 2, livingrooms: 1, bathrooms: 1, area: 80,
    min_lease_months: 12,
  },
  {
    title: '西城西直门两居室 交通超便利',
    description: '西直门交通枢纽旁，地铁2号线/4号线/13号线三线换乘，公交总站附近。两室一厅精装修，家电家具全配，周边商场、超市、医院均在步行范围内。',
    address: '北京市西城区西直门内大街XX号展览路小区X楼XXXX',
    district: '西城区',
    rent_amount: '0.042',
    bedrooms: 2, livingrooms: 1, bathrooms: 1, area: 79,
    min_lease_months: 6,
  },

  // 东城区 - 3套
  {
    title: '东城王府井精装套间 黄金地段',
    description: '王府井商业步行街附近，地铁1号线王府井站步行5分钟，周边东方广场、银泰百货、北京饭店。精装套间，酒店式公寓管理，安保严格，适合高端商务人士。',
    address: '北京市东城区王府井大街XX号君悦公寓XX楼XXXX',
    district: '东城区',
    rent_amount: '0.055',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 68,
    min_lease_months: 3,
  },
  {
    title: '东城南锣鼓巷一居室 文艺气息',
    description: '南锣鼓巷附近，北京最知名的文艺街区，周边咖啡馆、文创店林立。传统与现代结合的装修风格，有独立卫浴，采光好。适合喜欢文艺氛围的年轻人或外籍人士。',
    address: '北京市东城区南锣鼓巷附近胡同XX号院X号',
    district: '东城区',
    rent_amount: '0.033',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 48,
    min_lease_months: 3,
  },
  {
    title: '东城天坛公园旁三居室 适合养老',
    description: '天坛公园东门附近，晨练极为方便，空气清新，绿化好。老小区翻新，三室两厅，宽敞明亮，楼层适中，适合退休老人或喜欢安静环境的家庭。暖气中央空调全配。',
    address: '北京市东城区天坛东路XX号天坛里小区X号楼XXXX',
    district: '东城区',
    rent_amount: '0.065',
    bedrooms: 3, livingrooms: 2, bathrooms: 1, area: 112,
    min_lease_months: 12,
  },

  // 丰台区 - 3套
  {
    title: '丰台方庄两居室 生活便利',
    description: '方庄成熟社区，地铁5号线刘家窑站附近，周边方庄购物中心、永辉超市、多家医院。两室一厅，中等装修，家电齐全，小区绿化好物业管理规范。',
    address: '北京市丰台区方庄南路XX号方庄小区X号楼XXXX',
    district: '丰台区',
    rent_amount: '0.032',
    bedrooms: 2, livingrooms: 1, bathrooms: 1, area: 78,
    min_lease_months: 6,
  },
  {
    title: '丰台大红门服装城附近一居 性价比高',
    description: '大红门服装商贸区旁，地铁10号线成寿寺站步行8分钟，交通便利。一室一厅简单装修，价格实惠，适合在附近经商的朋友或预算有限的年轻人。',
    address: '北京市丰台区成寿寺路XX号成寿寺小区X号楼XXXX',
    district: '丰台区',
    rent_amount: '0.018',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 44,
    min_lease_months: 3,
  },
  {
    title: '丰台丽泽金融商务区新房出租',
    description: '丽泽金融商务区（新金融街）内，地铁14号线/16号线双线直达，附近全是新建商业楼宇。全新精装修，高档家具家电，智能门锁，适合在丽泽上班的金融行业人士。',
    address: '北京市丰台区丽泽路XX号丽泽SOHO X塔XXXX',
    district: '丰台区',
    rent_amount: '0.04',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 60,
    min_lease_months: 6,
  },

  // 顺义区 - 2套
  {
    title: '顺义首都机场旁国际公寓 外籍友好',
    description: '首都国际机场旁，顺义国际社区核心区，周边国际学校（北京顺义国际学校）、外籍人士聚居区。全英文物业服务，四室三卫大户型，带车库，适合需要常飞的商务人士或外籍家庭。',
    address: '北京市顺义区裕翔路XX号顺义欧陆经典X区XX栋',
    district: '顺义区',
    rent_amount: '0.095',
    bedrooms: 4, livingrooms: 2, bathrooms: 3, area: 220,
    min_lease_months: 12,
  },
  {
    title: '顺义新城一居室 性价比之王',
    description: '顺义新城区域，地铁15号线顺义站附近，新兴居住社区配套逐步完善。精装一居，全新家具家电，性价比极高。适合在顺义工作或在机场工作的单身人士。',
    address: '北京市顺义区仁和路XX号阳光顺城X区X号楼XXXX',
    district: '顺义区',
    rent_amount: '0.015',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 48,
    min_lease_months: 6,
  },

  // 通州区 - 2套
  {
    title: '通州运河旁精装两居 地铁直达',
    description: '大运河文化旅游景区旁，地铁6号线通州北关站步行10分钟。两室一厅精装修，临河视野，空气清新，周边万达广场、北京环球影城附近，生活配套不断完善。',
    address: '北京市通州区运河东大街XX号运河ONE X栋XXXX',
    district: '通州区',
    rent_amount: '0.028',
    bedrooms: 2, livingrooms: 1, bathrooms: 1, area: 80,
    min_lease_months: 6,
  },
  {
    title: '通州北京副中心新区公寓',
    description: '北京城市副中心核心区，临近政务区，周边规划配套齐全。品质新建小区，精装修，地铁6号线/副中心线可达，适合在副中心上班的公职人员或白领。',
    address: '北京市通州区行政办公区附近XX路XX号副中心公园城XXXX',
    district: '通州区',
    rent_amount: '0.035',
    bedrooms: 2, livingrooms: 1, bathrooms: 1, area: 85,
    min_lease_months: 12,
  },

  // 大兴区 - 2套
  {
    title: '大兴亦庄开发区两居 经济实用',
    description: '亦庄经济技术开发区内，地铁亦庄线荣京东街站附近，周边京东、小米等科技企业众多。两室一厅，装修干净整洁，家电齐全，适合在开发区上班的科技从业者。',
    address: '北京市大兴区荣京东街XX号荣亦坊X区X号楼XXXX',
    district: '大兴区',
    rent_amount: '0.026',
    bedrooms: 2, livingrooms: 1, bathrooms: 1, area: 76,
    min_lease_months: 6,
  },
  {
    title: '大兴大兴机场附近新盘 投资价值高',
    description: '大兴国际机场商业圈内，地铁大兴机场线附近，新建商住两用公寓。全新精装，智能家居，南向采光足，适合在机场工作或看好区域发展的租客，租期灵活。',
    address: '北京市大兴区榆垡镇XX路XX号临空国际公寓X区XXXX',
    district: '大兴区',
    rent_amount: '0.02',
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: 50,
    min_lease_months: 3,
  },
];

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function seedUsers(userDb, network) {
  const existing = parseUserResult(userDb.exec('SELECT wallet_address FROM users'));
  const existingWallets = new Set(existing.map(r => String(r.wallet_address || '').toLowerCase()));

  let added = 0;
  for (let i = 0; i < 5; i++) {
    const wallet = LANDLORDS[i];
    if (existingWallets.has(wallet.toLowerCase())) {
      console.log(`  [skip] 房东 ${LANDLORD_NICKNAMES[i]} ${wallet.slice(0,8)}... 已存在`);
      continue;
    }
    const id = makeId('uid');
    userDb.run(
      'INSERT INTO users (id, wallet_address, role, nickname, phone) VALUES (?, ?, ?, ?, ?)',
      [id, wallet, 'landlord', LANDLORD_NICKNAMES[i], '']
    );
    added++;
    console.log(`  [+] 房东 ${LANDLORD_NICKNAMES[i]} ${wallet.slice(0,8)}...`);
  }

  for (let i = 0; i < 5; i++) {
    const wallet = TENANTS[i];
    if (existingWallets.has(wallet.toLowerCase())) {
      console.log(`  [skip] 租客 ${TENANT_NICKNAMES[i]} ${wallet.slice(0,8)}... 已存在`);
      continue;
    }
    const id = makeId('uid');
    userDb.run(
      'INSERT INTO users (id, wallet_address, role, nickname, phone) VALUES (?, ?, ?, ?, ?)',
      [id, wallet, 'tenant', TENANT_NICKNAMES[i], '']
    );
    added++;
    console.log(`  [+] 租客 ${TENANT_NICKNAMES[i]} ${wallet.slice(0,8)}...`);
  }

  if (added > 0) saveUserDb('local');
  return added;
}

async function seedListings(db, userDb, allImages) {
  // 读取房东 ID 映射
  const landlordRows = parseUserResult(userDb.exec(
    `SELECT id, wallet_address FROM users WHERE role = 'landlord' AND wallet_address IN (${LANDLORDS.map(() => '?').join(',')})`,
    LANDLORDS
  ));
  const walletToId = {};
  landlordRows.forEach(r => { walletToId[String(r.wallet_address).toLowerCase()] = r.id; });

  let added = 0;
  for (let i = 0; i < LISTINGS_DATA.length; i++) {
    const data = LISTINGS_DATA[i];
    const landlordWallet = LANDLORDS[i % 5];
    const landlordId = walletToId[landlordWallet.toLowerCase()];
    if (!landlordId) {
      console.log(`  [warn] 找不到房东 ID for ${landlordWallet}`);
      continue;
    }

    const images = pickImages(allImages, 2 + (i % 3)); // 2-4 张图
    const id = makeId('lst');
    const now = new Date();
    // 各房源时间错开，显得更真实
    const offsetMs = i * 1000 * 60 * 7;
    const createdAt = new Date(now.getTime() - offsetMs).toISOString().replace('T', ' ').slice(0, 19);

    db.run(
      `INSERT INTO listings (
        id, landlord_id, title, description, address, district,
        rent_amount, rent_cycle, min_lease_months,
        bedrooms, livingrooms, bathrooms, area,
        clauses_template_json, image_urls, image_hashes, image_cids,
        public_snapshot_cid, public_snapshot_hash, content_hash, tx_hash, status,
        chain_version, chain_nonce, chain_block_number, chain_block_time,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        landlordId,
        data.title,
        data.description,
        data.address,
        data.district,
        data.rent_amount,
        'month',
        data.min_lease_months,
        data.bedrooms,
        data.livingrooms,
        data.bathrooms,
        data.area,
        '[]',
        JSON.stringify(images),
        '[]',
        '[]',
        '',
        '',
        `demo_hash_${id}`,
        `0x${'0'.repeat(64)}`,
        'available',
        1,
        1,
        0,
        0,
        createdAt,
        createdAt,
      ]
    );
    added++;
    console.log(`  [+] ${data.district} ${data.title.slice(0, 20)} (${data.rent_amount} ETH) 图片×${images.length}`);
  }

  saveDb();
  return added;
}

async function main() {
  const clearMode = process.argv.includes('--clear');

  console.log('\n=== 链上安居 Local 数据初始化 ===\n');

  // 初始化数据库
  await migrate();

  const db = await getDb();
  const userDb = await getUserDb('local');

  if (clearMode) {
    console.log('[clear] 清空 local 房源数据...');
    // 只删 demo 数据（landlord_id 属于 hardhat 账号）
    const landlordIds = parseUserResult(userDb.exec(
      `SELECT id FROM users WHERE wallet_address IN (${LANDLORDS.map(() => '?').join(',')})`,
      LANDLORDS
    )).map(r => r.id);
    if (landlordIds.length > 0) {
      db.run(`DELETE FROM listings WHERE landlord_id IN (${landlordIds.map(() => '?').join(',')})`, landlordIds);
      saveDb();
      console.log(`  已删除 ${db.getRowsModified()} 条房源`);
    }
  }

  console.log('\n[1/3] 注册用户（5 房东 + 5 租客）');
  const usersAdded = await seedUsers(userDb, 'local');
  console.log(`  完成，新增 ${usersAdded} 个用户\n`);

  console.log('[2/3] 扫描本地图片资源');
  const allImages = getAvailableImages();
  console.log(`  找到 ${allImages.length} 张图片\n`);

  console.log('[3/3] 写入房源数据');
  const listingsAdded = await seedListings(db, userDb, allImages);

  console.log(`\n✓ 完成！新增 ${listingsAdded} 套房源`);
  console.log('\n房东账号（可用 MetaMask 导入 Hardhat 私钥登录）:');
  LANDLORDS.forEach((w, i) => console.log(`  [${i}] ${LANDLORD_NICKNAMES[i]}: ${w}`));
  console.log('\n租客账号:');
  TENANTS.forEach((w, i) => console.log(`  [${i}] ${TENANT_NICKNAMES[i]}: ${w}`));
  console.log('\n提示: 联网版风控冷却已重置，可重新尝试签约。\n');
}

main().catch(err => {
  console.error('Error:', err?.message || err);
  process.exit(1);
});
