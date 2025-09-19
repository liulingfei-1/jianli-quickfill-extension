// 在安装时注入默认键值（若不存在同名键则创建，不覆盖已有数据）

const STORAGE_KEY = 'bucket';
const SETTINGS_KEY = 'bucket_settings';
const API_KEY_STORAGE = 'qwen_api_key';
const AI_RESUME_KEY = 'ai_resume_text';
const DEFAULT_API_KEY = 'sk-2a293b2cc0cc4b679c6aea6ce82ae7fe';

const DEFAULT_BUCKET = {
  // 基本信息
  '姓名': '刘凌飞',
  '求职意向': '勘探技术开发岗（新疆）',
  '现居城市': '重庆',
  '手机': '181-6797-1790',
  '邮箱': '2489229518@qq.com',
  '到岗时间': '2026.07',
  '驻外意愿备注': '可驻外新疆，接受长期出差',

  // 资格亮点（概述与拆分）
  '资格亮点-概述': '野外地质/样品采集、地质图编制；层序地层课题经验；CAAC 无人机执照；TOEFL 96；校园媒体 4000万+ 播放/5.5万粉。',
  '资格亮点-野外地质': '野外地质观察/样品采集与地质图编制经验',
  '资格亮点-科创课题': '参与层序地层科创课题，完成资料整编与图件绘制',
  '资格亮点-无人机': '持 CAAC 民用无人机执照，能执行航拍/航测数据采集',
  '资格亮点-英语': 'TOEFL 96，具备英文检索与沟通能力',
  '资格亮点-媒体数据': '校园媒体运营：总播放 4000万+、粉丝 5.5万、单条 537.8万播放/15.6万赞',

  // 教育经历
  '教育-学校': '重庆科技大学',
  '教育-专业': '资源勘察工程',
  '教育-学历': '本科',
  '教育-起止': '2022.09–2026.06',
  '教育-完整': '重庆科技大学｜资源勘察工程 本科｜2022.09–2026.06',
  '教育-核心课程': '普通地质学、沉积岩石学、构造地质学、油气地球化学、晶体光学',

  // 实习/实践经历
  '经历-野外地质实习-地点': '重庆市万盛区关坝镇',
  '经历-野外地质实习-时间': '2023.06–2023.07',
  '经历-野外地质实习-描述': '露头记录（岩性/层理/构造）、样品采集；编制小区地质图并完成阶段小结',

  '经历-野外填图实习-地点': '重庆市北碚区天府镇',
  '经历-野外填图实习-时间': '2024.10–2024.11',
  '经历-野外填图实习-描述': '地形地貌、地层分布与构造测量的标准化记录；完成地质图编制与资料整编',

  // 科研/项目
  '项目-科创-角色': '大学生科技创新训练计划｜成员｜2022.11–2023.05',
  '项目-科创-课题': '川中地区震旦系灯影组二段层序地层格架划分及其油气地质意义（资料检索、整编与图件参与）',

  '项目-央视网-名称': '“拜托，我的大学超酷的诶”（B站 @央视网）｜校方联络/剪辑｜2024.01–2024.08',
  '项目-央视网-数据': '播放 25万+、点赞 2万+、收藏 1.2万+、投币 6k+、转发 3k+；覆盖 29校/439名参与者',
  '项目-央视网-链接': 'https://b23.tv/Af03izo',

  '项目-毕业视频-名称': '《成长的故事——重庆科技大学 2025 年毕业视频》｜摄影/航拍/剪辑｜2025.06–2025.07',
  '项目-毕业视频-说明': '多机位拍摄与成片交付，在毕业典礼播放',
  '项目-毕业视频-链接': 'https://mp.weixin.qq.com/s/Ivacd21SS4OU4UZDpRSpiA',

  // 校园媒体运营
  '媒体-概述': '校宣平台运营组&视频组责任编辑（2022.10–至今），16个月产出100+视频；总播放4000万+、总赞70万+；粉丝5.5万；单条537.8万播放/15.6万赞',
  '媒体-活动保障': '运动会、军训、新年晚会、双选会、学科大会、合唱赛等多机位协作与按时交付',

  // 技能与证书
  '技能-地质': '野外观察与记录、样品采集、地质图编制、资料整编',
  '技能-无人机/测绘': 'CAAC 民用无人机执照（可开展航拍/航测数据采集）',
  '技能-软件': 'DaVinci Resolve、Final Cut Pro X（如实可补：ArcGIS/QGIS、AutoCAD、Office）',
  '技能-语言': '英语 TOEFL 96',

  // 荣誉（倒序）
  '荣誉1': '全国大学生数字媒体科技作品及创意竞赛（第12届）全国总决赛 三等奖｜2024.11｜证书号 20241338594',
  '荣誉2': '重庆市第七届大学生艺术展演·微电影（本科甲组） 一等奖｜2024',
  '荣誉3': '2024–2025 年度高校融合创新新闻专题「负责人」｜2025.08（中国青年报·中青校媒）',
  '荣誉4': '2022–2023 年度影响力校园新闻专题「作品作者」｜2023.08（中国青年报·中青校媒）',

  // 作品链接
  '链接-B站作品': 'https://b23.tv/Af03izo',
  '链接-毕业视频（公众号）': 'https://mp.weixin.qq.com/s/Ivacd21SS4OU4UZDpRSpiA'
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
    if (!existingKey) {
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
  function pick(k, def=''){ return (bkt && bkt[k]) ? String(bkt[k]) : (DEFAULT_BUCKET[k] ?? def); }
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
