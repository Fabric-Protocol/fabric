import type { AppLocale } from './i18n.js';

export type Category = {
  id: number;
  slug: string;
  name: string;
  description: string;
  examples: string[];
};

export type CategoriesResponse = {
  categories_version: number;
  categories: Category[];
};

// Immutable registry version for agent cache invalidation.
export const CATEGORIES_VERSION = 1;

// Stable IDs and slugs. Do not renumber or rename after publish.
export const CATEGORIES: Category[] = [
  {
    id: 1,
    slug: 'goods',
    name: 'Goods',
    description: 'Physical items',
    examples: [
      'Specific dress/outfit (brand/model/size/color) for same-day pickup + delivery',
      'Hard-to-find replacement part (appliance/vehicle) with label/serial photo',
      'Limited local drop item purchased and shipped with receipt photos',
      'Sealed physical media kit (USB/drive) prepared, tamper-sealed, shipped with chain-of-custody photos',
      'Device/part authenticity kit delivery (standardized verification photo set + packing list)',
    ],
  },
  {
    id: 2,
    slug: 'services',
    name: 'Services',
    description: 'Work performed',
    examples: [
      '2-hour handyman visit (assemble/mount/patch) with before/after photos',
      'Deep clean (defined rooms) with completion evidence',
      'Onsite “hands for machines” (reboot/swap cable/read LEDs/move device) with timestamped media',
      'Long-run job babysitting (3D print/CNC/backup run) with intervene-on-failure rules + logs/photos',
      'In-person line-standing + handoff protocol with proof-of-queue timestamps',
    ],
  },
  {
    id: 3,
    slug: 'space_asset_time',
    name: 'Space & Asset Time',
    description: 'rent/borrow/use',
    examples: [
      'Parking/driveway block (time window)',
      'Workshop bay time (seller present; output delivered)',
      'Secure staging location window for pickup/handoff (rules + timestamps)',
      'Short-term storage corner with defined access schedule + photo inventory at intake/outtake',
      'Quiet room/studio hour with power/Wi-Fi requirements and access procedure',
    ],
  },
  {
    id: 4,
    slug: 'access_reservations',
    name: 'Access & Reservations',
    description: 'events/queues/memberships',
    examples: [
      'Restaurant reservation transfer/guest-name swap where allowed',
      'Guest pass / +1 entry for event',
      'Transferable appointment slot where policy allows',
      'Priority entrance/hosted entry arrangement with explicit constraints and evidence of confirmation',
      'Submission via seller’s membership lane (where lawful) with proof of submission and confirmation artifact',
    ],
  },
  {
    id: 5,
    slug: 'logistics_transportation',
    name: 'Logistics & Transportation',
    description: 'people/goods/errands',
    examples: [
      'Pickup/dropoff with receipts + tracking',
      'Pack-and-ship (materials included) with photo evidence',
      'Sealed courier relay (tamper tape, timestamps, handoff photos)',
      'Cold-chain delivery with temperature log snapshots',
      'Multi-hop relay across cities with standardized handoff checklist and evidence packet',
    ],
  },
  {
    id: 6,
    slug: 'proof_verification',
    name: 'Proof & Verification',
    description: 'inspection, attestation, chain-of-custody',
    examples: [
      'Proof-of-condition inspection (photos, measurements, receipts)',
      'Apartment truthing (noise/odor/parking reality at peak hours) with timestamped media',
      'Proof-of-presence at time window (agreed token/gesture) with timestamped evidence',
      'Authenticity triage (serials/packaging tells) with standardized photo kit checklist',
      'Chain-of-custody evidence packet (sealed pickup → logged handoffs → delivery proof)',
    ],
  },
  {
    id: 7,
    slug: 'account_actions_delegated_access',
    name: 'Account Actions & Delegated Access',
    description: 'Account Actions & Delegated Access',
    examples: [
      'Submit/claim/redeem using seller’s membership/account (bounded, consent-based)',
      'Post/list/run an item in seller’s owned channel/workspace',
      'Temporary admin/add-to-workspace (revocable, time-bounded)',
      'Issue a time-bounded access key/license token and revoke on schedule (artifact returned)',
      'Priority submission inside a gated portal seller can access, returning confirmation artifacts',
    ],
  },
  {
    id: 8,
    slug: 'digital_resources',
    name: 'Digital Resources',
    description: 'compute/storage/infra',
    examples: [
      'GPU hours with exact model + reproducible container hash',
      'Storage/bandwidth allocation for fixed term',
      'Hosted webhook receiver + retries + logs (time-bounded)',
      'Dedicated callback endpoint + audit log export for agent workflows (time-bounded)',
      'Region-specific execution runner for latency/regulatory constraints, returning run logs and hashes',
    ],
  },
  {
    id: 9,
    slug: 'rights_ip',
    name: 'Rights & IP',
    description: 'licenses, permissions, scarce digital rights',
    examples: [
      'Time-bounded access to one-of-a-kind dataset under explicit license terms',
      'Permission/license grant to use a photo/asset (bounded scope)',
      'One-time decryption key release at a scheduled time (rights-controlled delivery)',
      'License transfer/assignment where lawful, with chain-of-title documentation packet',
      'Virtual items/digital collectibles (including NFTs) where ToS allows transfer, with proof-of-transfer artifact',
    ],
  },
  {
    id: 10,
    slug: 'social_capital_communities',
    name: 'Social Capital & Communities',
    description: 'Social Capital & Communities',
    examples: [
      'Conditional warm intro (criteria-based; seller-controlled)',
      'Endorsement/reference with explicit scope',
      'Invite to private community + sponsor message',
      'Distribution slot: seller posts your request/item in a high-trust group under their name with screening rules',
      'Host a question/request in an expert circle seller controls, returning summary of responses and attendance proof',
    ],
  },
];

type LocalizedCategoryFields = Pick<Category, 'name' | 'description' | 'examples'>;

const SIMPLIFIED_CHINESE_CATEGORY_FIELDS: Record<string, LocalizedCategoryFields> = {
  goods: {
    name: '实物商品',
    description: '实体物品',
    examples: [
      '指定连衣裙/穿搭（品牌/型号/尺码/颜色），支持当天取货和送达',
      '难找的替换零件（家电/车辆），附标签或序列号照片',
      '本地限量发售商品代买并邮寄，附收据照片',
      '密封实体介质套件（U 盘/硬盘）制作、封签并附交接照片后发货',
      '设备或零件真伪核验套件交付（标准化验货照片 + 装箱清单）',
    ],
  },
  services: {
    name: '服务',
    description: '提供劳务或执行工作',
    examples: [
      '2 小时上门维修/安装/补墙，并附前后对比照片',
      '指定房间深度清洁，并附完成证明',
      '线下“机器看护”服务（重启/换线/读指示灯/移动设备），附时间戳素材',
      '长时间任务代守（3D 打印/CNC/备份运行），附失败干预规则和日志/照片',
      '现场排队与交接服务，附排队时间证明',
    ],
  },
  space_asset_time: {
    name: '空间与资产时段',
    description: '租用、借用或使用时段',
    examples: [
      '停车位/车道在指定时间段内使用',
      '工作坊工位时段（提供者在场，交付产出）',
      '安全中转存放点时段，用于取货或交接，并附规则与时间戳',
      '短期仓储角落，含约定访问时间和入库/出库照片清单',
      '带电源/Wi-Fi 的安静房间或录音室时段，含进入流程',
    ],
  },
  access_reservations: {
    name: '准入与预约',
    description: '活动、排队或会员资格相关',
    examples: [
      '在规则允许下转让餐厅预约或更换来宾姓名',
      '活动来宾票或加一名额',
      '在政策允许下转让预约时段',
      '优先入场或代接待安排，并附明确限制和确认凭证',
      '通过卖方会员通道代提交，在合法前提下返回提交与确认凭证',
    ],
  },
  logistics_transportation: {
    name: '物流与运输',
    description: '人员、物品或跑腿配送',
    examples: [
      '代取代送，附小票和追踪信息',
      '打包并发货（含材料），附照片证据',
      '封签快递中转（封条、时间戳、交接照片）',
      '冷链配送，附温度记录截图',
      '跨城市多段接力配送，附标准化交接清单和证据包',
    ],
  },
  proof_verification: {
    name: '证明与核验',
    description: '检查、见证与保管链证明',
    examples: [
      '状态检查证明（照片、尺寸、票据）',
      '公寓实况核验（高峰时段噪音/气味/停车情况），附时间戳素材',
      '指定时间窗口到场证明（约定口令或动作），附时间戳证据',
      '真伪初筛（序列号/包装细节），附标准化照片清单',
      '保管链证据包（封签取件 -> 记录交接 -> 送达证明）',
    ],
  },
  account_actions_delegated_access: {
    name: '账号操作与委托访问',
    description: '在受限范围内代操作账号或授予访问',
    examples: [
      '使用卖方会员或账号代提交/代领取/代兑换（经同意且范围受限）',
      '在卖方拥有的渠道或工作区代发布/代运行',
      '临时管理员或加入工作区权限（可撤销、限时）',
      '发放限时访问密钥或许可令牌，并按计划撤销并返回凭证',
      '在卖方可访问的受限门户中优先提交，并返回确认凭证',
    ],
  },
  digital_resources: {
    name: '数字资源',
    description: '算力、存储与基础设施',
    examples: [
      '指定型号 GPU 时长，附可复现容器哈希',
      '固定期限的存储或带宽配额',
      '托管 webhook 接收器，含重试与日志（限时）',
      '专用回调端点和审计日志导出，面向代理工作流（限时）',
      '满足延迟或合规要求的区域执行器，并返回运行日志和哈希',
    ],
  },
  rights_ip: {
    name: '权利与知识产权',
    description: '许可、授权与稀缺数字权利',
    examples: [
      '在明确许可条款下限时访问独特数据集',
      '在限定范围内授予使用照片或素材的许可',
      '在约定时间一次性释放解密密钥（受权利控制的交付）',
      '在合法前提下转让许可或权利，并附权属链证明包',
      '在平台规则允许下转移虚拟物品或数字藏品，并附转移证明',
    ],
  },
  social_capital_communities: {
    name: '社会资本与社群',
    description: '介绍、背书与社群入口',
    examples: [
      '基于条件的暖介绍（由卖方控制是否发起）',
      '带明确范围的背书或推荐',
      '邀请进入私密社群并附带引荐说明',
      '分发名额：卖方以自己的身份在高信任群组发布你的请求或物品，并说明筛选规则',
      '在卖方掌控的专家圈子中代发问题或需求，并返回回复摘要和参与证明',
    ],
  },
};

export const CATEGORIES_RESPONSE: CategoriesResponse = {
  categories_version: CATEGORIES_VERSION,
  categories: CATEGORIES,
};

export function getCategoriesResponse(locale: AppLocale = 'en'): CategoriesResponse {
  if (locale === 'en') return CATEGORIES_RESPONSE;
  if (locale !== 'zh-Hans') return CATEGORIES_RESPONSE;
  return {
    categories_version: CATEGORIES_VERSION,
    categories: CATEGORIES.map((category) => {
      const localized = SIMPLIFIED_CHINESE_CATEGORY_FIELDS[category.slug];
      if (!localized) return category;
      return {
        ...category,
        ...localized,
      };
    }),
  };
}
