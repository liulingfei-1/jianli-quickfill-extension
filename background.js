// 在安装时注入默认键值（若不存在同名键则创建，不覆盖已有数据）

const STORAGE_KEY = 'bucket';
const SETTINGS_KEY = 'bucket_settings';
const API_KEY_STORAGE = 'qwen_api_key';
const AI_RESUME_KEY = 'ai_resume_text';
const DEFAULT_API_KEY = ''; // 留空，提醒用户自行配置

const DEFAULT_BUCKET = {
  // 基本信息
  '姓名': '示例：张三',
  '求职意向': '示例：勘探技术工程师',
  '现居城市': '示例：成都',
  '手机': '示例：138-0000-0000',
  '邮箱': '示例：example@mail.com',
  '到岗时间': '示例：两周内可到岗',
  '驻外意愿备注': '示例：可接受西北地区项目出差',

  // 资格亮点（概述与拆分）
  '资格亮点-概述': '示例：具备野外勘探、图件编制与无人机航测经验，英语沟通能力良好。',
  '资格亮点-野外地质': '示例：野外地质观察、样品采集与地质图编制经验',
  '资格亮点-科创课题': '示例：参与层序地层课题，承担资料整编与图件绘制',
  '资格亮点-无人机': '示例：持有无人机证书，可执行航测与数据处理',
  '资格亮点-英语': '示例：英语能力扎实，支持跨团队沟通',
  '资格亮点-媒体数据': '示例：负责校园媒体账号运营，持续产出高质量内容',

  // 教育经历
  '教育-学校': '示例大学',
  '教育-专业': '示例专业',
  '教育-学历': '本科',
  '教育-起止': '2022.09–2026.06',
  '教育-完整': '示例大学｜示例专业 本科｜2022.09–2026.06',
  '教育-核心课程': '示例课程：普通地质学、沉积岩石学、构造地质学',

  // 实习/实践经历
  '经历-野外地质实习-地点': '示例地区 A',
  '经历-野外地质实习-时间': '2023.06–2023.07',
  '经历-野外地质实习-描述': '示例：负责露头记录、样品采集与阶段总结撰写',

  '经历-野外填图实习-地点': '示例地区 B',
  '经历-野外填图实习-时间': '2024.10–2024.11',
  '经历-野外填图实习-描述': '示例：完成地形测量、地层划分与地质图编制',

  // 科研/项目
  '项目-科创-角色': '示例：大学生科技创新训练计划｜成员｜2022.11–2023.05',
  '项目-科创-课题': '示例：区域地层划分与油气地质意义研究，负责资料整理',

  '项目-央视网-名称': '示例项目 A｜联络/剪辑｜2024.01–2024.08',
  '项目-央视网-数据': '示例成绩：多平台累计播放 20万+，参与院校 20+',
  '项目-央视网-链接': 'https://example.com/project-a',

  '项目-毕业视频-名称': '示例项目 B｜摄影/航拍/剪辑｜2025.06–2025.07',
  '项目-毕业视频-说明': '示例：多机位拍摄校园专题，负责剪辑与交付',
  '项目-毕业视频-链接': 'https://example.com/project-b',

  // 校园媒体运营
  '媒体-概述': '示例：校级媒体账号主理人，策划并执行视频内容',
  '媒体-活动保障': '示例：负责运动会、晚会等大型活动的多机位拍摄与交付',

  // 技能与证书
  '技能-地质': '示例：野外观察、资料整编与地质图编制',
  '技能-无人机/测绘': '示例：熟悉无人机航拍与基础测绘流程',
  '技能-软件': '示例：DaVinci Resolve、ArcGIS、Office 套件',
  '技能-语言': '示例：英语 CET-6 或同等水平',

  // 荣誉（倒序）
  '荣誉1': '示例：2024 年全国专业竞赛三等奖',
  '荣誉2': '示例：市级艺术展演一等奖',
  '荣誉3': '示例：高校新闻专题负责人',
  '荣誉4': '示例：优秀学生记者',

  // 作品链接
  '链接-B站作品': 'https://example.com/video-demo',
  '链接-毕业视频（公众号）': 'https://example.com/article-demo'
};


chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    // 安装或更新时均尝试合并（不覆盖同名键）
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    const current = data[STORAGE_KEY] || {};
    let changed = false;
    const merged = { ...current };
    for (const [k, v] of Object.entries(DEFAULT_BUCKET)) {
      if (!(k in merged) || merged[k] === undefined || merged[k] === null || merged[k] === '') {
        merged[k] = v;
        changed = true;
      }
    }
    if (changed) {
      await chrome.storage.local.set({ [STORAGE_KEY]: merged });
    }
    const { [API_KEY_STORAGE]: existingKey } = await chrome.storage.local.get([API_KEY_STORAGE]);
    if (!existingKey && DEFAULT_API_KEY) {
      await chrome.storage.local.set({ [API_KEY_STORAGE]: DEFAULT_API_KEY });
    }
  } catch (e) {
    // 忽略错误，避免影响扩展加载
    console.warn('初始化默认键值失败：', e);
  }
});

// 组合一个“内置文字简历”，优先从存储的键值拼装，缺失则退回默认
async function buildResumeText() {
  const res = await chrome.storage.local.get([AI_RESUME_KEY, STORAGE_KEY]);
  const custom = res[AI_RESUME_KEY];
  if (typeof custom === 'string' && custom.trim()) {
    return custom.trim();
  }
  const bkt = res[STORAGE_KEY] || {};
  function pick(k, def='') {
    if (bkt && Object.prototype.hasOwnProperty.call(bkt, k)) {
      const val = bkt[k];
      if (val === undefined || val === null) return def;
      return String(val);
    }
    if (Object.prototype.hasOwnProperty.call(DEFAULT_BUCKET, k)) {
      return DEFAULT_BUCKET[k];
    }
    return def;
  }
  const parts = [];
  parts.push(`${pick('姓名','')}｜求职意向：${pick('求职意向','')}`.trim());
  parts.push(`现居：${pick('现居城市','')}｜手机：${pick('手机','')}｜邮箱：${pick('邮箱','')}`.trim());
  if (pick('到岗时间','') || pick('驻外意愿备注','')) {
    parts.push(`到岗时间：${pick('到岗时间','')}｜${pick('驻外意愿备注','')}`.trim());
  }
  const hl = [
    pick('资格亮点-野外地质',''),
    pick('资格亮点-科创课题',''),
    pick('资格亮点-无人机',''),
    pick('资格亮点-英语','')
  ].filter(Boolean).join('；');
  if (hl) parts.push(`资格亮点：${hl}`);
  const edu = pick('教育-完整','');
  if (edu) parts.push(`教育经历：${edu}`);
  const exp1 = pick('经历-野外地质实习-地点','') ? `野外地质实习（${pick('经历-野外地质实习-地点','')}｜${pick('经历-野外地质实习-时间','')}）：${pick('经历-野外地质实习-描述','')}` : '';
  const exp2 = pick('经历-野外填图实习-地点','') ? `野外填图实习（${pick('经历-野外填图实习-地点','')}｜${pick('经历-野外填图实习-时间','')}）：${pick('经历-野外填图实习-描述','')}` : '';
  const exps = [exp1, exp2].filter(Boolean).join('；');
  if (exps) parts.push(`实践经历：${exps}`);
  const proj = [pick('项目-科创-课题',''), pick('项目-毕业视频-说明','')].filter(Boolean).join('；');
  if (proj) parts.push(`项目：${proj}`);
  const skills = [pick('技能-地质',''), pick('技能-无人机/测绘',''), pick('技能-软件',''), pick('技能-语言','')].filter(Boolean).join('；');
  if (skills) parts.push(`技能：${skills}`);
  return parts.filter(Boolean).join('\n');
}

async function callQwenApi(prompt, maxChars) {
  const { [API_KEY_STORAGE]: apiKeyFromStore } = await chrome.storage.local.get([API_KEY_STORAGE]);
  const apiKey = apiKeyFromStore || DEFAULT_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 API Key，请在悬浮面板底部保存阿里云百炼密钥。');
  }
  const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const body = {
    model: 'qwen3-max-preview',
    temperature: 0.2,
    messages: [
      { role: 'system', content: '你是中文求职助手。根据用户简历与表单字段要求，生成简洁、专业、符合限制条件的填写内容。输出仅包含最终文本，不要解释。' },
      { role: 'user', content: prompt }
    ]
  };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch (networkErr) {
    throw new Error('网络请求失败：' + (networkErr?.message || networkErr));
  }
  let data;
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error('模型调用失败：' + res.status + ' ' + text);
  }
  try {
    data = await res.json();
  } catch (parseErr) {
    throw new Error('解析模型响应失败：' + (parseErr?.message || parseErr));
  }
  if (data?.error) {
    const msg = data.error?.message || JSON.stringify(data.error);
    throw new Error('模型返回错误：' + msg);
  }
  const content = data?.choices?.[0]?.message?.content || '';
  let out = (content || '').trim();
  // 去掉包裹的引号或代码块
  out = out.replace(/^```[\s\S]*?\n/,'').replace(/```$/,'').trim();
  if (maxChars && maxChars > 0 && out.length > maxChars) {
    out = out.slice(0, maxChars);
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'AI_SUGGEST_FIELD') {
    (async () => {
      const started = Date.now();
      const resume = await buildResumeText();
      const { fieldContext = '', typed = '', constraints = {}, hints = {} } = msg;
      const maxChars = Number(constraints.maxLength) || 0;
      const hintText = buildHintsSection(hints, fieldContext, typed, maxChars);
      const req = `${hintText}\n候选简历：\n${resume}\n\n请严格根据字段含义填写：\n1. 只输出该字段需要的内容；不要输出解释或与字段无关的信息。\n2. 若字段已有内容或限制，请遵守。\n3. 若限制为姓名/学校等，请仅输出对应短语。\n4. 保持语气专业、自然；如有最大字数，请严格不超过。`;
      try {
        const text = await callQwenApi(req, maxChars);
        sendResponse({ ok: true, text, durationMs: Date.now() - started });
      } catch (e) {
        console.warn('AI_SUGGEST_FIELD error:', e);
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // 异步响应
  }
  if (msg && msg.type === 'AI_SPLIT_RESUME') {
    (async () => {
      const started = Date.now();
      const resumeText = (msg.resumeText || '').trim();
      if (!resumeText) {
        sendResponse({ ok: false, error: '未提供简历文本。' });
        return;
      }
      const instruction = `请将下方简历文本拆分成合理的键值对，输出 JSON 对象，键使用简洁中文短语（如“个人概述”“教育经历”），值为对应内容字符串。请遵守：\n` +
        `1. 输出必须是合法 JSON，对象顶层不包含额外文字或注释。\n2. 控制在 20 条以内；若某条内容较长，可以合并为一项。\n3. 若文本中包含列表，可合并为一条字符串，用分号隔开。`;
      const prompt = `${instruction}\n\n简历文本：\n${resumeText}`;
      try {
        const raw = await callQwenApi(prompt, 0);
        const jsonText = extractJsonObject(raw);
        let obj;
        try {
          obj = JSON.parse(jsonText);
        } catch (parseErr) {
          throw new Error('解析模型返回的 JSON 失败：' + (parseErr?.message || parseErr));
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
          throw new Error('模型返回结果不是对象。');
        }
        const entries = Object.entries(obj)
          .filter(([k, v]) => typeof k === 'string' && typeof v === 'string')
          .map(([k, v]) => ({ key: k.trim(), value: v.trim() }))
          .filter(({ key }) => key.length > 0);
        sendResponse({ ok: true, entries, durationMs: Date.now() - started, raw });
      } catch (e) {
        console.warn('AI_SPLIT_RESUME error:', e);
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }
});

function extractJsonObject(text) {
  if (typeof text !== 'string') return '{}';
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const codeBlockMatch = trimmed.match(/```json([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/);
  if (codeBlockMatch) {
    const candidate = codeBlockMatch[1].trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate;
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return '{}';
}

function buildHintsSection(hints = {}, fieldContext = '', typed = '', maxChars = 0) {
  const lines = [];
  const ctx = (fieldContext || '').trim();
  if (ctx) lines.push(`字段上下文：${ctx}`);
  const attrSummary = (hints.attrSummary || '').trim();
  if (attrSummary) lines.push(`输入框属性：${attrSummary}`);
  const labelTexts = Array.isArray(hints.labelTexts) ? hints.labelTexts.filter(Boolean) : [];
  if (labelTexts.length) lines.push(`字段标签：${labelTexts.join(' / ')}`);
  const nearbyTexts = Array.isArray(hints.nearbyTexts) ? hints.nearbyTexts.filter(Boolean) : [];
  if (nearbyTexts.length) lines.push(`附近文字：${nearbyTexts.join(' / ')}`);
  const typedPreview = hints.typedPreview || typed;
  lines.push(`已输入：${typedPreview ? typedPreview : '(空)'}`);
  if (maxChars) lines.push(`长度限制：最大 ${maxChars} 字`);
  return lines.join('\n');
}
