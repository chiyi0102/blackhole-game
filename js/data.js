'use strict';
/* ================= 配置文件：常量 / 目标定义 / 区域布局 / 地图主题 ================= */

/* ---- 世界 ----
   5x5 街区网格，街区边长 STEP，道路宽 ROAD，每张地图都是一块浮在环境底色上的板子 */
const WORLD = 2200;
const STEP = 440;
const ROAD = 64;

/* ---- 比赛 ---- */
const TIME_LIMIT = 120;          // 竞技模式时长（秒）
const MAX_VISUAL_R = 400;        // 黑洞最大视觉半径（判定半径可以继续长，绘制封顶）

/* ---- 颜色 / 名字 ---- */
const COLORS = ['#c86bff', '#4ad7ff', '#ff9d5c', '#ff6a8a'];
const NAMES = ['宗主', '小黑', '阿紫', '大橙'];

/* ---- 楼上海报贴图库 ---- */
const POSTERS = ['p1', 'p2', 'p3', 'p4', 'pout', 'grin', 'thumbs', 'laugh', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];

/* ---- 可吞噬目标定义 ----
   r: 判定半径   h: 高度倍数（H = r*h）   score: 吞噬得分   label: 名称
   style 同时决定绘制分支（建筑 / 植物 / 设施 / 动物） */
const SPAWNS = {
  /* 城市建筑（v=99.5 分数按大小分档：小楼 3 分、中楼 4 分、大楼 5 分、最大 6-7 分） */
  house:   { r:26, h:1.15, score:3,  label:'住宅'   },
  apt:     { r:40, h:1.70, score:4,  label:'公寓楼' },
  office:  { r:46, h:2.50, score:5,  label:'写字楼' },
  mall:    { r:64, h:1.60, score:6,  label:'商场'   },
  shop:    { r:34, h:1.35, score:3,  label:'商店'   },
  cafe:    { r:30, h:1.20, score:3,  label:'餐厅'   },
  tower:   { r:30, h:4.80, score:6,  label:'高塔'   },
  stadium: { r:72, h:1.25, score:7,  label:'体育馆' },
  /* 主题建筑（v=101 多地图；v=99.5 分数分档） */
  cabin:     { r:30, h:1.30, score:3,  label:'木屋'   },
  lighthouse:{ r:34, h:3.20, score:5,  label:'灯塔'   },
  igloo:     { r:26, h:0.95, score:3,  label:'冰屋'   },
  pyramid:   { r:44, h:2.20, score:5,  label:'金字塔' },
  adobe:     { r:32, h:1.15, score:3,  label:'土坯房' },
  watchtower:{ r:30, h:3.60, score:4,  label:'瞭望塔' },
  church:    { r:28, h:3.40, score:4,  label:'教堂'   },
  unfinished:{ r:34, h:2.20, score:4,  label:'烂尾楼' },
  /* 树 / 植物（v=99.5：树 2 分、小花/灌木/蘑菇 1 分） */
  tree:    { r:19, h:1.15, score:2,  label:'树'     },
  pine:    { r:18, h:1.30, score:2,  label:'松树'   },
  snowpine:{ r:18, h:1.30, score:2,  label:'雪松'   },
  birch:   { r:17, h:1.25, score:2,  label:'白桦'   },
  maple:   { r:20, h:1.20, score:2,  label:'枫树'   },
  palm:    { r:19, h:1.40, score:2,  label:'棕榈树' },
  cactus:  { r:14, h:1.40, score:2,  label:'仙人掌' },
  mushroom:{ r:9,  h:0.60, score:1,  label:'蘑菇'   },
  stump:   { r:12, h:0.55, score:1,  label:'树桩'   },
  snowman: { r:15, h:1.10, score:2,  label:'雪人'   },
  flower:  { r:7,  h:0.60, score:1,  label:'花丛'   },
  bush:    { r:9,  h:0.70, score:1,  label:'灌木'   },
  planter: { r:11, h:0.80, score:2,  label:'花坛'   },
  /* 行人 / 动物（v=99.5：行人 1 分、小动物 2 分） */
  ped:     { r:11, h:1.00, score:1,  label:'行人'   },
  deer:    { r:13, h:1.00, score:2,  label:'小鹿'   },
  crab:    { r:8,  h:0.50, score:1,  label:'螃蟹'   },
  camel:   { r:16, h:1.10, score:2,  label:'骆驼'   },
  reindeer:{ r:14, h:1.10, score:2,  label:'驯鹿'   },
  /* ---- 可吞噬街道设施：尺寸即吞噬等级，小黑洞吞小、大黑洞吞大 ---- */
  lamp:    { r:10, h:2.40, score:2,  label:'路灯'   },
  trash:   { r:8,  h:0.90, score:1,  label:'垃圾桶' },
  bench:   { r:12, h:0.60, score:1,  label:'长椅'   },
  bike:    { r:11, h:0.90, score:2,  label:'自行车' },
  sign:    { r:9,  h:1.80, score:1,  label:'路标'   },
  fence:   { r:13, h:1.00, score:2,  label:'围栏'   },
  stall:   { r:16, h:1.30, score:3,  label:'小摊'   },
  mail:    { r:7,  h:1.10, score:1,  label:'邮箱'   },
  billboard:{r:18, h:2.00, score:2,  label:'广告牌' },
  hydrant: { r:8,  h:1.00, score:1,  label:'消防栓' },
  pole:    { r:10, h:2.80, score:2,  label:'电线杆' },
  /* 主题设施（v=99.5 分数分档） */
  umbrella:  { r:13, h:1.20, score:2, label:'沙滩伞' },
  sandcastle:{ r:10, h:0.70, score:1, label:'沙堡'   },
  tent:      { r:15, h:1.30, score:2, label:'帐篷'   },
  rock:      { r:13, h:0.70, score:2, label:'岩石'   },
  surfboard: { r:10, h:1.30, score:2, label:'冲浪板' },
};
const CAR_SCORE = 3;             // 吞噬一辆汽车得分（v=99.5 3→3，中等物体）
const HOLE_SCORE = 200;          // 吞掉一个黑洞得分
const SINGLE_COMPLETION = 0.95;  // 单人模式通关阈值：吞噬进度达到 95% 即判定完成

/* 建筑样式集合（画海报 / 算进度权重共用） */
const BUILD_STYLES = ['house','apt','office','mall','shop','cafe','tower','stadium',
                      'cabin','lighthouse','igloo','pyramid','adobe','watchtower',
                      'church','unfinished'];
/* 动物样式集合（billboard 动物绘制 + 漫游移动共用） */
const ANIMAL_STYLES = ['deer','crab','camel','reindeer'];
const ANIMAL_SPEED = { deer: 62, crab: 22, camel: 32, reindeer: 58 };
/* 植物样式集合（立式植物绘制） */
const PLANT_STYLES = ['tree','pine','palm','cactus','mushroom','stump','snowman','flower','bush','planter',
                      'birch','maple'];
/* 主题设施（propShape 绘制） */
const PROP_STYLES = ['lamp','trash','bench','bike','sign','fence','stall','mail','billboard','hydrant','pole',
                     'umbrella','sandcastle','tent','rock','surfboard'];

/* ================= 地图主题 =================
   每张地图 = 一套完整配置（区域布局 / 色板 / 物体池 / 道路材质 / 天空海洋 / 动物）。
   生成与绘制全部按当前主题取值；游戏规则、吞噬、海报系统完全不变。
   区域键含义按主题不同：res/com/park/land 每张地图有各自的解释。 */
const THEMES = {

  /* ========== 城市：楼房主体，板子外是海洋 ========== */
  city: {
    name: '城市', emoji: '🏙',
    zoneMap: [
      ['res', 'res', 'park', 'com', 'com'],
      ['res', 'res', 'park', 'com', 'com'],
      ['park','park','park', 'com', 'land'],
      ['res', 'res', 'park', 'com', 'com'],
      ['res', 'res', 'park', 'com', 'com'],
    ],
    zoneCol: { res:'#e8d9b8', com:'#a9c6e2', park:'#8fc47e', land:'#dcd4e6' },
    zoneBuild: {
      res:  [['house', 0.38], ['apt', 0.30], ['office', 0.18], ['tower', 0.14]],   // v=101 高楼更多
      com:  [['office', 0.32], ['mall', 0.14], ['shop', 0.20], ['cafe', 0.14], ['tower', 0.20]],
      park: [],
    },
    landBuild: [['tower', 0.5], ['stadium', 0.5]],
    parkTrees: 5, parkBuild: ['tree'],
    zonePedW: { res: 0.30, com: 0.75, park: 0.55, land: 0.15 },
    pedTotal: 100,
    decoWeight: {
      res:  { planter:1.2, flower:1.4, bush:0.8 },
      com:  { planter:1.6, flower:1.0, bush:0.4 },
      park: { planter:2.0, flower:2.4, bush:2.0 },
      land: { planter:1.0, flower:0.8, bush:0.4 },
    },
    streetWeight: {
      res:  { lamp:3.0, trash:2.4, bench:1.2, bike:0.9, sign:1.2, mail:1.5, stall:0,   fence:0.7, hydrant:0.8, billboard:0,   pole:1.2 },
      com:  { lamp:3.4, trash:2.8, bench:1.0, bike:0.6, sign:1.6, mail:0,   stall:2.2, fence:0,   hydrant:1.0, billboard:1.0, pole:1.4 },
      park: { lamp:1.6, trash:1.4, bench:2.8, bike:0.8, sign:0.7, mail:0,   stall:0,   fence:2.4, hydrant:0.4, billboard:0,   pole:0.6 },
      land: { lamp:2.0, trash:1.2, bench:1.0, bike:0.5, sign:1.4, mail:0,   stall:1.2, fence:0,   hydrant:0.6, billboard:1.4, pole:1.0 },
    },
    parkingWeight: { res: 6, com: 12, park: 0, land: 3 },
    trafficLight: true,          // 路口红绿灯（城市感）
    roadCol: '#7d8591', roadMainCol: '#6d7684', roadLineCol: '#e8c038',
    sideCol: 'rgba(238,231,216,0.8)',
    sky: ['#7fc0e8', '#e0f0fa'], sea: ['#9ed4ee', '#3f93c4'],
    edge: null,                  // 板子外 = 海洋
    beach: null,                 // 沙滩环颜色（仅海岛）
    clouds: true,
    cars: 15, carColors: ['#e05252','#4a8ee8','#e8b84a','#7cc46a','#b07ae0','#e8e8e8','#3a3f4a'],
    animals: [],
  },

  /* ========== 森林：树是主角，边缘也是密林（不靠海） ==========
     res=阔叶林带  com=松林带  park=花草地  land=空地(瞭望塔) */
  forest: {
    name: '森林', emoji: '🌲',
    zoneMap: [
      ['res', 'res', 'park', 'com', 'com'],
      ['res', 'res', 'park', 'com', 'com'],
      ['park','park','park', 'com', 'land'],
      ['res', 'res', 'park', 'com', 'com'],
      ['res', 'res', 'park', 'com', 'com'],
    ],
    zoneCol: { res:'#a8d48c', com:'#79b86e', park:'#cdeab0', land:'#b4d8a0' },
    zoneBuild: {
      res:  [['tree', 0.38], ['pine', 0.22], ['maple', 0.12], ['birch', 0.12], ['cabin', 0.08], ['mushroom', 0.08]],
      com:  [['pine', 0.34], ['tree', 0.26], ['birch', 0.10], ['maple', 0.10], ['cabin', 0.12], ['mushroom', 0.08]],
      park: [],
    },
    landBuild: [['watchtower', 0.7], ['cabin', 0.3]],
    parkTrees: 12, parkBuild: ['tree', 'pine', 'maple', 'birch', 'mushroom', 'flower'],
    zonePedW: { res: 0.40, com: 0.40, park: 0.55, land: 0.30 },
    pedTotal: 84,
    decoWeight: {
      res:  { flower:1.8, bush:1.2, planter:0.2 },
      com:  { flower:1.2, bush:1.4, planter:0.2 },
      park: { flower:3.0, bush:2.2, planter:0.2 },
      land: { flower:0.6, bush:0.6, planter:0 },
    },
    streetWeight: {
      res:  { lamp:1.6, trash:1.6, bench:1.6, sign:0.8, fence:2.0, hydrant:0.4, pole:0.6, mail:0.6, bike:0.4 },
      com:  { lamp:1.6, trash:1.6, bench:1.4, sign:0.8, fence:2.2, hydrant:0.4, pole:0.6, mail:0.4, bike:0.4 },
      park: { lamp:0.8, trash:1.0, bench:2.0, sign:0.4, fence:2.6, hydrant:0.2, pole:0.3, mail:0,   bike:0.4 },
      land: { lamp:1.0, trash:0.8, bench:1.2, sign:0.8, fence:1.4, hydrant:0.2, pole:0.6, mail:0,   bike:0.2 },
    },
    parkingWeight: { res: 2, com: 2, park: 0, land: 1 },
    trafficLight: false,
    roadCol: '#9a7a50', roadMainCol: '#8a6c44', roadLineCol: '#d9c08a',
    sideCol: 'rgba(222,204,168,0.55)',
    sky: ['#9ed4e8', '#e2f2e6'], sea: ['#8fc4dc', '#4a94bc'],
    edge: ['#4e8f4a', '#6fb064'],   // 板子外 = 深林绿（边缘全是森林）
    beach: null,
    clouds: true,
    cars: 4, carColors: ['#6c9a58', '#8aae5e', '#5f8a52', '#7aa868'],
    animals: ['deer'],
  },

  /* ========== 海岛：沙滩环 + 中央度假区，板子外是海洋 ==========
     res=沙滩度假屋  com=度假区  park=绿洲  land=灯塔角 */
  island: {
    name: '海岛', emoji: '🏝',
    zoneMap: [
      ['res', 'res', 'park', 'com', 'res'],
      ['res', 'com', 'com',  'com', 'res'],
      ['park','com', 'land', 'com', 'park'],
      ['res', 'com', 'com',  'com', 'res'],
      ['res', 'res', 'park', 'com', 'res'],
    ],
    zoneCol: { res:'#f0e0b8', com:'#d4ecd8', park:'#a8d894', land:'#d8d4c8' },
    zoneBuild: {
      res:  [['palm', 0.30], ['cabin', 0.26], ['umbrella', 0.18], ['sandcastle', 0.12], ['surfboard', 0.14]],
      com:  [['cabin', 0.32], ['palm', 0.26], ['umbrella', 0.16], ['sandcastle', 0.14], ['surfboard', 0.12]],
      park: [],
    },
    landBuild: [['lighthouse', 1.0]],
    parkTrees: 8, parkBuild: ['palm', 'flower'],
    zonePedW: { res: 0.60, com: 0.70, park: 0.45, land: 0.25 },
    pedTotal: 95,
    decoWeight: {
      res:  { flower:0.8, bush:0.4, planter:0.4, volleyball:1.6 },   // v=101 沙滩排球场
      com:  { flower:1.2, bush:0.4, planter:0.6 },
      park: { flower:2.0, bush:1.0, planter:0.4 },
      land: { flower:0.4, bush:0.6, planter:0.2 },
    },
    streetWeight: {
      res:  { lamp:1.4, trash:1.6, bench:2.0, sign:0.8, fence:0.6, hydrant:0.2, pole:0.4, mail:0.6, bike:0.8 },
      com:  { lamp:2.0, trash:2.0, bench:1.8, sign:1.0, fence:0.4, hydrant:0.3, pole:0.4, mail:0.4, bike:0.8 },
      park: { lamp:0.8, trash:1.0, bench:2.2, sign:0.4, fence:0.6, hydrant:0.1, pole:0.2, mail:0,   bike:0.6 },
      land: { lamp:1.2, trash:0.8, bench:1.0, sign:0.8, fence:0.8, hydrant:0.2, pole:0.4, mail:0,   bike:0.4 },
    },
    parkingWeight: { res: 3, com: 5, park: 0, land: 1 },
    trafficLight: false,
    roadCol: '#d8c094', roadMainCol: '#c8ae84', roadLineCol: '#f2e6c4',
    sideCol: 'rgba(240,224,180,0.6)',
    sky: ['#6fc4ee', '#d8f2fa'], sea: ['#8ed4ee', '#2e8cc4'],
    edge: null,                    // 板子外 = 海洋
    beach: '#f0dfa0',              // 板子最外圈沙滩环
    clouds: true,
    cars: 0, carColors: ['#e8e8e8'],
    animals: ['crab'],
  },

  /* ========== 沙漠：沙丘主体 + 中央绿洲土城，边缘全是沙子 ==========
     com=沙丘带  res=土城小镇  park=绿洲  land=金字塔区 */
  desert: {
    name: '沙漠', emoji: '🏜',
    zoneMap: [
      ['com', 'com', 'com',  'com', 'com'],
      ['com', 'park','res',  'park','com'],
      ['com', 'res', 'land', 'res', 'com'],
      ['com', 'park','res',  'park','com'],
      ['com', 'com', 'com',  'com', 'com'],
    ],
    zoneCol: { res:'#ecd9a8', com:'#e2c67e', park:'#a8d894', land:'#d8c8a4' },
    zoneBuild: {
      com:  [['cactus', 0.32], ['rock', 0.18], ['adobe', 0.16], ['tent', 0.14], ['unfinished', 0.20]],   // v=101 烂尾楼
      res:  [['adobe', 0.34], ['cactus', 0.22], ['tent', 0.14], ['rock', 0.10], ['unfinished', 0.20]],
      park: [],
    },
    landBuild: [['pyramid', 0.5], ['church', 0.5]],   // v=101 沙漠教堂
    parkTrees: 6, parkBuild: ['palm', 'flower'],
    zonePedW: { res: 0.60, com: 0.35, park: 0.45, land: 0.25 },
    pedTotal: 70,
    decoWeight: {
      com:  { flower:0.2, bush:0.1, planter:0 },
      res:  { flower:0.4, bush:0.2, planter:0.4 },
      park: { flower:2.4, bush:1.0, planter:0.6 },
      land: { flower:0.2, bush:0.2, planter:0.2 },
    },
    streetWeight: {
      com:  { lamp:0.8, trash:1.0, bench:0.6, sign:0.8, fence:0.6, hydrant:0.2, pole:0.6, mail:0.4, bike:0.2 },
      res:  { lamp:1.6, trash:1.4, bench:1.0, sign:1.2, fence:0.8, hydrant:0.4, pole:0.8, mail:0.8, bike:0.4 },
      park: { lamp:0.6, trash:0.8, bench:1.2, sign:0.4, fence:0.4, hydrant:0.1, pole:0.2, mail:0,   bike:0.2 },
      land: { lamp:0.8, trash:0.6, bench:0.8, sign:0.8, fence:0.6, hydrant:0.2, pole:0.6, mail:0,   bike:0.2 },
    },
    parkingWeight: { res: 2, com: 2, park: 0, land: 1 },
    trafficLight: false,
    roadCol: '#d9bc80', roadMainCol: '#c9ac6e', roadLineCol: '#f0e0b0',
    sideCol: 'rgba(240,228,190,0.5)',
    sky: ['#f4c67e', '#fae8c8'], sea: ['#e8c890', '#c8a068'],
    edge: ['#e8d49a', '#d4b878'],   // 板子外 = 沙色（边缘全是沙子）
    beach: null,
    clouds: false,
    cars: 5, carColors: ['#c8a04a', '#8a9a5a', '#b8803c', '#a89a6c', '#d0b060'],
    animals: ['camel'],
  },

  /* ========== 雪地：雪原 + 冰湖 + 村庄，边缘全是雪 ==========
     com=冰湖雪原  res=村庄  park=松林带  land=教堂区 */
  snow: {
    name: '雪地', emoji: '❄️',
    zoneMap: [
      ['com', 'com', 'park', 'com', 'com'],
      ['com', 'res', 'park', 'res', 'com'],
      ['park','park','land', 'park','park'],
      ['com', 'res', 'park', 'res', 'com'],
      ['com', 'com', 'park', 'com', 'com'],
    ],
    zoneCol: { res:'#eef4f8', com:'#d8e8f2', park:'#dfeee2', land:'#f2f6fa' },
    zoneBuild: {
      com:  [['snowpine', 0.26], ['cabin', 0.18], ['igloo', 0.20], ['snowman', 0.14], ['rock', 0.14], ['church', 0.08]],   // v=102 教堂更多
      res:  [['cabin', 0.30], ['igloo', 0.22], ['snowpine', 0.18], ['snowman', 0.12], ['rock', 0.08], ['church', 0.10]],
      park: [],
    },
    landBuild: [['church', 1.0]],   // v=102 地标区 3 栋全是教堂（用户要求教堂更多）
    parkTrees: 8, parkBuild: ['snowpine', 'snowman'],
    zonePedW: { res: 0.55, com: 0.40, park: 0.45, land: 0.30 },
    pedTotal: 78,
    decoWeight: {
      com:  { flower:0.1, bush:0.2, planter:0 },
      res:  { flower:0.2, bush:0.4, planter:0.4 },
      park: { flower:0.2, bush:1.2, planter:0.2 },
      land: { flower:0.1, bush:0.2, planter:0.2 },
    },
    streetWeight: {
      com:  { lamp:1.2, trash:1.2, bench:0.8, sign:0.8, fence:1.0, hydrant:0.2, pole:0.8, mail:0.4, bike:0.2 },
      res:  { lamp:2.0, trash:1.6, bench:1.2, sign:1.2, fence:1.2, hydrant:0.4, pole:1.0, mail:0.8, bike:0.4 },
      park: { lamp:0.8, trash:1.0, bench:1.4, sign:0.4, fence:1.6, hydrant:0.1, pole:0.4, mail:0,   bike:0.2 },
      land: { lamp:1.2, trash:0.8, bench:1.0, sign:0.8, fence:0.8, hydrant:0.2, pole:0.6, mail:0,   bike:0.2 },
    },
    parkingWeight: { res: 3, com: 2, park: 0, land: 1 },
    trafficLight: false,
    roadCol: '#c8d8e4', roadMainCol: '#b8c8d8', roadLineCol: '#eef4f8',
    sideCol: 'rgba(238,244,250,0.7)',
    sky: ['#b8cfe0', '#e8eef4'], sea: ['#c8dce8', '#9ab8cc'],
    edge: ['#e8eef4', '#d4e0ea'],   // 板子外 = 雪白（边缘全是雪）
    beach: null,
    clouds: true,
    cars: 3, carColors: ['#dce8f0', '#c8d8e4', '#b8c8d8'],
    animals: ['reindeer'],
  },
};

/* 主题列表（菜单顺序） */
const THEME_LIST = ['city', 'forest', 'island', 'desert', 'snow'];

/* ---- 主干道：中央十字（所有主题通用） ---- */
const MAIN_ROAD_Y = 1320;
const MAIN_ROAD_X = 1320;
const MAIN_W = 96;
