import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { COVERS_DIR, DEFAULT_ADMIN, FILES_DIR } from './config.js';
import { all, db, json, nowIso, one, run, saveSettings, transaction } from './db.js';
import { mergeUiText, UI_TEXT_DEFAULTS } from './content.js';

const defaultSettings = {
  siteName: '傅先生AI项目VIP',
  brandShort: '傅先生 AI',
  documentTitle: '傅先生AI项目VIP｜AI项目合作与项目资源平台',
  heroEyebrow: '精选 AI 项目 · 可信赖的落地伙伴',
  heroTitle: '把经过验证的 AI 项目，\n变成可落地的增长方案',
  heroSubtitle: '聚焦 AI 创作、SaaS 系统、变现项目与企业技术服务。每个项目都提供清晰的能力边界、交付资料与深入合作通道。',
  heroTrust: '从需求评估到部署交付，每一步都有明确路径；先把价值讲清楚，再谈合作。',
  heroHighlights: ['项目能力透明', '交付资料完备', '支持深度合作'],
  serviceStatement: '不是卖一个概念，而是交付一套能跑起来的方案',
  trustHeading: '把不确定，变成可验证的每一步',
  trustSubtitle: '我们更关注项目是否适合你的业务，以及上线之后能否持续产生价值。',
  trustPoints: [
    {
      title: '真实场景优先',
      description: '围绕获客、内容生产、知识管理与经营提效等真实业务问题组织方案，不用空泛概念包装。',
      index: '01'
    },
    {
      title: '上线过程可追踪',
      description: '从需求梳理、部署配置到人员培训，关键节点清晰同步，减少沟通成本与交付风险。',
      index: '02'
    },
    {
      title: '持续更新与支持',
      description: '已上架内容与资料由后台统一维护，合作项目可根据业务变化持续调整与迭代。',
      index: '03'
    }
  ],
  processTitle: '从了解项目，到真正用起来',
  processSteps: [
    { title: '查看项目与资料', description: '了解功能范围、适配场景与交付边界。' },
    { title: '提交合作需求', description: '留下业务目标，我们据此判断适配方式。' },
    { title: '评估与演示', description: '围绕预算、周期和团队情况完成方案沟通。' },
    { title: '部署与持续支持', description: '确认合作后进入实施、培训与运营迭代。' }
  ],
  featuredProjectId: null,
  contactEyebrow: '开启合作',
  contactSectionIndex: '03',
  contactSectionLabel: 'START A CONVERSATION',
  contactTitle: '先聊聊你的业务，再决定下一步',
  contactSubtitle: '留下联系方式和核心需求，我们会尽快与你沟通项目适配度、交付方式与预算范围。',
  contactPhone: '400-000-0000',
  contactWechat: 'fushi-ai',
  contactHours: '工作日 09:00 - 18:00',
  contactNotice: '提交即表示同意仅将以上信息用于本次业务沟通，我们不会向无关第三方披露。',
  floatingContactEnabled: true,
  floatingContactLabel: '联系顾问',
  floatingContactTitle: '项目合作咨询',
  floatingContactDescription: '扫码添加项目顾问，获取项目资料、合作方式与预算建议。',
  floatingContactEyebrow: 'DIRECT CONTACT',
  floatingContactAdminName: '傅先生AI项目顾问',
  floatingContactAdminTitle: '项目合作顾问',
  floatingContactBadge: '项目顾问',
  floatingContactQrUrl: '/assets/contact-qr-placeholder.svg',
  floatingContactAdminImageUrl: '/assets/admin-emblem.svg',
  floatingContactQrHint: '微信扫码，添加项目顾问',
  floatingContactNote: '添加时请备注“项目咨询”，便于我们快速了解你的需求。',
  footerCopyright: '© 2026 傅先生AI项目VIP. 保留所有权利。',
  icpNumber: '备案号待填写',
  uiText: UI_TEXT_DEFAULTS,
  downloadRequireLead: false,
  downloadDailyLimit: 0
};

const categories = [
  { name: 'AI 创作工具', description: '内容生产、创意协作与效率提升', sort: 40 },
  { name: 'SaaS 系统', description: '可部署、可扩展的企业级产品底座', sort: 30 },
  { name: '变现项目', description: '经过市场验证的增长与商业化方案', sort: 20 },
  { name: '技术服务', description: '面向企业的定制实施与长期支持', sort: 10 }
];

const projects = [
  {
    name: '智稿 AI 内容中台',
    slogan: '让品牌内容生产从“靠人催”升级为“靠系统跑”',
    description: '智稿是一套面向品牌方与内容团队的一站式 AI 内容生产方案。系统将选题、脚本、改写、审核与素材归档串成标准流程，帮助团队减少重复劳动，统一内容口径。\n\n适用于公众号、短视频、电商详情页与私域内容等高频生产场景。支持按企业知识库配置专属表达风格，也可结合审批角色实现多人协作。可提供完整部署文档、操作培训与后续场景扩展支持。',
    highlights: ['多场景内容模板与品牌语气配置', '选题到发布的全流程协作', '企业知识库与审核规则可扩展'],
    tags: ['内容提效', '品牌中台', '可私有化'],
    category: 'AI 创作工具',
    cover: '/assets/covers/zhigao.svg',
    sort: 100,
    software: { name: '智稿 AI 内容中台 v1.0 演示包.zip', stored: 'zhigao-demo.zip', key: 'files/zhigao-demo.zip', mime: 'application/zip' },
    document: { name: '智稿 AI 内容中台 - 产品与合作说明.txt', stored: 'zhigao-overview.txt', key: 'files/zhigao-overview.txt', mime: 'text/plain' }
  },
  {
    name: '星链企业获客 SaaS',
    slogan: '把分散的线索，变成可跟进的销售机会',
    description: '星链围绕企业获客链路，提供线索沉淀、自动分配、跟进提醒、成交阶段与数据看板等核心能力。系统以轻量部署和多角色协作为重点，适合销售团队、渠道团队与本地服务商快速建立标准化客户管理流程。\n\n支持表单接入、线索去重、销售漏斗分析、权限隔离与数据导出。可根据实际业务流程调整字段、状态与提醒策略，并预留企业微信、CRM 与第三方数据源接入能力。',
    highlights: ['统一线索池与自动分配规则', '销售过程可视化与跟进提醒', '业务字段和流程灵活配置'],
    tags: ['销售增长', '流程管理', '轻量部署'],
    category: 'SaaS 系统',
    cover: '/assets/covers/xinglian.svg',
    sort: 90,
    software: null,
    document: { name: '星链企业获客 SaaS - 功能清单.txt', stored: 'xinglian-features.txt', key: 'files/xinglian-features.txt', mime: 'text/plain' }
  },
  {
    name: '短视频矩阵增长方案',
    slogan: '从选题、成片到分发，建立可持续的内容增长系统',
    description: '本方案面向希望稳定运营多平台短视频账号的团队，将账号定位、选题库、脚本生产、素材管理、矩阵分发和数据复盘组合为可执行的内容系统。\n\n交付包含运营方法、模板工具、平台适配建议与团队分工方案。AI 工具用于降低批量生产门槛，但内容判断与品牌策略仍由运营人员掌控，避免无效堆量。适合企业新媒体团队、知识服务机构和本地商家合作落地。',
    highlights: ['账号定位与选题方法可复制', '批量生产工具与标准模板', '数据复盘带动下一轮增长'],
    tags: ['内容增长', '矩阵运营', '实战陪跑'],
    category: '变现项目',
    cover: '/assets/covers/video.svg',
    sort: 80,
    software: null,
    document: { name: '短视频矩阵增长方案 - 合作手册.txt', stored: 'video-growth.txt', key: 'files/video-growth.txt', mime: 'text/plain' }
  },
  {
    name: '企业知识库智能问答',
    slogan: '让沉淀在文档里的经验，成为团队随取随用的答案',
    description: '面向企业内部知识分散、查找效率低、培训成本高等问题，提供文档接入、知识切片、权限检索、问答引用与使用分析的一体化能力。\n\n可接入产品手册、售后规则、项目规范、培训资料等内部内容。答案保留来源引用，员工能够快速核对；管理员可持续更新知识并查看高频问题。支持私有化部署，数据不出企业可控环境。',
    highlights: ['文档自动解析与知识切片', '答案来源可追溯', '适配企业私有化部署'],
    tags: ['知识管理', '智能问答', '私有化'],
    category: 'SaaS 系统',
    cover: '/assets/covers/knowledge.svg',
    sort: 70,
    software: { name: '企业知识库智能问答 v1.0 演示包.zip', stored: 'knowledge-demo.zip', key: 'files/knowledge-demo.zip', mime: 'application/zip' },
    document: { name: '企业知识库智能问答 - 部署说明.txt', stored: 'knowledge-deploy.txt', key: 'files/knowledge-deploy.txt', mime: 'text/plain' }
  },
  {
    name: '私域转化陪跑系统',
    slogan: '把社群、内容与成交动作连接成一套可复用的运营机制',
    description: '项目围绕高客单产品与专业服务企业的私域经营，从用户分层、内容节奏、社群触达、意向识别到成交跟进建立完整机制。\n\n方案强调与现有团队协同，提供 SOP、话术框架、数据记录工具和阶段复盘方法。不承诺短期流量结果，而是帮助团队形成可观察、可优化、可持续运营的转化流程。适合咨询、培训、企业服务与高客单零售业务合作。',
    highlights: ['用户分层与运营节奏规划', '标准 SOP 与成交过程记录', '围绕真实数据持续复盘'],
    tags: ['私域运营', '转化体系', '企业服务'],
    category: '变现项目',
    cover: '/assets/covers/private.svg',
    sort: 60,
    software: null,
    document: { name: '私域转化陪跑系统 - 服务说明.txt', stored: 'private-domain.txt', key: 'files/private-domain.txt', mime: 'text/plain' }
  },
  {
    name: 'AI 数字人交付服务',
    slogan: '把数字人从展示Demo，变成可稳定产出的内容工具',
    description: '提供数字人形象配置、声音选择、脚本适配、视频生成与发布流程的完整技术服务。适用于企业介绍、课程讲解、产品说明与日更短视频等内容场景。\n\n项目先基于真实使用频率与内容类型进行评估，再确定形象、算力和工作流方案。交付包含基础形象、生成流程、素材规范与团队培训，可根据合作规模扩展至批量生产与系统集成。',
    highlights: ['面向真实内容产出设计流程', '形象、声音与脚本一体化配置', '支持团队培训与后续扩展'],
    tags: ['数字人', '视频生产', '定制交付'],
    category: '技术服务',
    cover: '/assets/covers/digital.svg',
    sort: 50,
    software: null,
    document: { name: 'AI 数字人交付服务 - 能力说明.txt', stored: 'digital-human.txt', key: 'files/digital-human.txt', mime: 'text/plain' }
  }
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function makeDemoZip(projectName) {
  const filename = Buffer.from('README.txt');
  const content = Buffer.from(`# ${projectName} 演示包\n\n这是系统初始化时生成的演示文件，用于验证软件包下载、统计和权限规则。\n\n正式运营时，请在管理后台替换为真实软件安装包。\n`);
  const checksum = crc32(content);
  const local = Buffer.concat([
    uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
    uint32(checksum), uint32(content.length), uint32(content.length), uint16(filename.length),
    uint16(0), filename, content
  ]);
  const central = Buffer.concat([
    uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
    uint32(checksum), uint32(content.length), uint32(content.length), uint16(filename.length),
    uint16(0), uint16(0), uint16(0), uint16(0), uint32(0), uint32(0), filename
  ]);
  const end = Buffer.concat([
    uint32(0x06054b50), uint16(0), uint16(0), uint16(1), uint16(1),
    uint32(central.length), uint32(local.length), uint16(0)
  ]);
  return Buffer.concat([local, central, end]);
}

function createSeedFile(file, projectName, type) {
  const target = path.join(FILES_DIR, file.stored);
  if (fs.existsSync(target)) return;
  if (file.stored.endsWith('.zip')) {
    fs.writeFileSync(target, makeDemoZip(projectName));
  } else {
    fs.writeFileSync(target, [
      `${projectName}`,
      '='.repeat(48),
      '',
      '说明：本文件为系统初始化演示资料，正式运营时请由管理员在后台替换。',
      '',
      '合作流程',
      '1. 查看项目介绍并确认业务场景。',
      '2. 通过站内合作咨询提交需求与联系方式。',
      '3. 双方完成需求评估、演示与交付范围确认。',
      '4. 签订合作方案后进入部署、培训与持续支持。',
      '',
      '资料类型：' + (type === 'software' ? '软件包说明' : '项目资料')
    ].join('\n'), 'utf8');
  }
}

export function seedDatabase() {
  const timestamp = nowIso();

  if (!one('SELECT id FROM admins LIMIT 1')) {
    run(`
      INSERT INTO admins
        (username, password_hash, display_name, is_super, permissions, active, token_version, created_at, updated_at)
      VALUES (?, ?, ?, 1, '[]', 1, 1, ?, ?)
    `, [
      DEFAULT_ADMIN.username,
      bcrypt.hashSync(DEFAULT_ADMIN.password, 12),
      DEFAULT_ADMIN.displayName,
      timestamp,
      timestamp
    ]);
  }

  transaction(() => {
    const insertSetting = db.prepare(`
      INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    `);
    for (const [key, value] of Object.entries(defaultSettings)) {
      insertSetting.run(key, JSON.stringify(value), timestamp);
    }
  });

  // 新版本增加文案字段时，为已有站点补齐，不覆盖运营人员已经修改的内容。
  const existingUiText = one("SELECT value FROM settings WHERE key = 'uiText'");
  if (existingUiText) {
    try {
      const merged = mergeUiText(JSON.parse(existingUiText.value));
      run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [
        JSON.stringify(merged),
        timestamp,
        'uiText'
      ]);
    } catch {
      run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [
        JSON.stringify(UI_TEXT_DEFAULTS),
        timestamp,
        'uiText'
      ]);
    }
  }

  if (!one('SELECT id FROM categories LIMIT 1')) {
    const stmt = db.prepare(`
      INSERT INTO categories (name, description, sort_order, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);
    transaction(() => {
      for (const category of categories) {
        stmt.run(category.name, category.description, category.sort, timestamp, timestamp);
      }
    });
  }

  if (!one('SELECT id FROM projects LIMIT 1')) {
    const categoryRows = all('SELECT id, name FROM categories');
    const categoryIds = Object.fromEntries(categoryRows.map((row) => [row.name, row.id]));
    const insertProject = db.prepare(`
      INSERT INTO projects
        (name, slogan, description, highlights, tags, category_id, cover_url, sort_weight, published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const insertFile = db.prepare(`
      INSERT INTO project_files
        (project_id, type, original_name, display_name, stored_name, storage_key, mime_type, size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    transaction(() => {
      for (const project of projects) {
        const result = insertProject.run(
          project.name,
          project.slogan,
          project.description,
          json(project.highlights),
          json(project.tags),
          categoryIds[project.category] ?? null,
          project.cover,
          project.sort,
          timestamp,
          timestamp
        );
        const projectId = Number(result.lastInsertRowid);
        for (const [type, file] of [['software', project.software], ['document', project.document]]) {
          if (!file) continue;
          createSeedFile(file, project.name, type);
          const size = fs.statSync(path.join(FILES_DIR, file.stored)).size;
          insertFile.run(
            projectId, type, file.name, file.name, file.stored, file.key, file.mime, size, timestamp, timestamp
          );
        }
      }
    });
  }

  // 清理过期下载票据，避免长期运行后积累无效记录。
  run('DELETE FROM download_tickets WHERE expires_at < ?', [timestamp]);
}
