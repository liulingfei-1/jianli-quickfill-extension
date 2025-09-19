// 中文内容脚本：接收消息并将文本填入当前聚焦的可编辑元素

function isTextInput(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return [
      'text','search','email','url','tel','password','number','date','datetime-local','month','time','week'
    ].includes(type);
  }
  if (el.isContentEditable) return true;
  return false;
}

function fillValue(el, text) {
  const emit = (level, message, detail) => {
    try {
      const fn = window.__resume_bucket_pushLog;
      if (typeof fn === 'function') fn(level, message, detail);
    } catch (_) { /* 忽略日志错误 */ }
  };
  if (!el) return false;
  if (el.isContentEditable) {
    // 对 contenteditable 使用命令插入或直接赋值
    el.focus();
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } catch (_) {
      el.textContent = text;
    }
    // 触发输入事件以兼容前端框架监听
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    emit('success', '填充内容到 contenteditable', {
      length: text.length,
      tag: el.tagName
    });
    return true;
  }
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    el.focus();
    // 通过原型 setter 赋值，兼容 React/Vue 等对 value 的拦截
    try {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
        || (el.tagName === 'TEXTAREA' ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
                                      : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'));
      if (desc && desc.set) {
        desc.set.call(el, text);
      } else {
        el.value = text;
      }
    } catch (_) {
      el.value = text;
    }
    // 触发事件
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    emit('success', '填充内容到输入框', {
      tag: el.tagName,
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      length: text.length
    });
    return true;
  }
  return false;
}

function getElementCurrentText(el) {
  if (!el) return '';
  if (el.isContentEditable) return el.textContent || '';
  if ('value' in el) {
    try { return el.value || ''; } catch (_) { return ''; }
  }
  return '';
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'FILL_TEXT') {
    const el = document.activeElement;
    if (isTextInput(el)) {
      const ok = fillValue(el, message.text ?? '');
      sendResponse({ ok });
    } else {
      sendResponse({ ok: false, reason: 'no-focused-input' });
    }
  }
  // 返回 true 以允许异步 sendResponse（这里同步即可）
});

// =============== 悬浮面板（始终可用）===============
(function initFloatingPanel() {
  // 避免重复注入
  if (window.__resume_bucket_injected__) return;
  window.__resume_bucket_injected__ = true;

  const STORAGE_KEY = 'bucket';
  const SETTINGS_KEY = 'bucket_settings';
  const API_KEY_STORAGE = 'qwen_api_key';
  const AI_RESUME_KEY = 'ai_resume_text';
  const DEFAULT_API_KEY = 'sk-2a293b2cc0cc4b679c6aea6ce82ae7fe';
  const POS_KEY = 'overlay_position'; // 记录每站点的位置
  const MAX_DEBUG_LOGS = 200;
  let bucket = {};
  let state = { open: false };
  let settings = { autoSuggestEnabled: true };
  let lastFocusedInput = null; // 记录最近一次聚焦的输入元素（不在面板内）
  let editingOriginalKey = null;
  const debugLogs = [];
  let aiResumeText = '';
  let suppressSuggestionUntil = 0;

  // 容器 + Shadow DOM，避免样式冲突
  const host = document.createElement('div');
  host.id = 'resume-bucket-overlay-host';
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  host.style.right = '32px';
  host.style.bottom = '32px';
  host.style.fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      display: block;
      font: 13px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #1b1c1e;
      -webkit-font-smoothing: antialiased;
      pointer-events: auto;
    }
    *, *::before, *::after { box-sizing: border-box; }
    .stack {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 14px;
      pointer-events: auto;
    }
    .panel {
      display: none;
      flex-direction: column;
      width: 380px;
      max-height: min(72vh, 640px);
      background: rgba(251, 253, 255, 0.98);
      color: #1b1c1e;
      border: 1px solid rgba(96, 112, 140, 0.12);
      border-radius: 26px;
      box-shadow: 0 26px 60px rgba(15, 23, 42, 0.22);
      backdrop-filter: saturate(180%) blur(26px);
      overflow: hidden;
    }
    .panel.open {
      display: flex;
      animation: overlay-in 200ms cubic-bezier(0.35, 0.2, 0.2, 1) both;
    }
    @keyframes overlay-in {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 22px;
      background: linear-gradient(136deg, #0a84ff, #3f9bff);
      color: #f4f8ff;
      cursor: move;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-icon {
      display: inline-flex;
      width: 42px;
      height: 42px;
    }
    .brand-icon svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .brand-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .title {
      font: 600 16px/1.3 "SF Pro Display", -apple-system, sans-serif;
    }
    .subtitle {
      font-size: 12px;
      line-height: 1.45;
      color: rgba(236, 244, 255, 0.8);
    }
    .panel-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 20px 22px 22px;
      overflow-y: auto;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 999px;
      border: 1px solid rgba(98, 116, 146, 0.12);
      background: rgba(244, 247, 252, 0.92);
      font: 500 12px/1 "SF Pro Text", -apple-system, sans-serif;
      color: #1d1f21;
      cursor: pointer;
      transition: transform 0.18s ease, box-shadow 0.24s ease, background 0.2s ease, border-color 0.2s ease;
    }
    .btn:hover {
      box-shadow: 0 10px 22px rgba(15, 23, 42, 0.12);
      transform: translateY(-1px);
    }
    .btn.primary {
      border: none;
      background: linear-gradient(145deg, #0a84ff, #4f9dff);
      color: #ffffff;
      box-shadow: 0 16px 32px rgba(10, 132, 255, 0.22);
    }
    .btn.primary:hover { box-shadow: 0 20px 36px rgba(10, 132, 255, 0.26); }
    .btn.secondary {
      background: rgba(236, 240, 246, 0.92);
      border-color: rgba(96, 112, 140, 0.18);
      color: #1f2024;
    }
    .btn.secondary:hover { border-color: rgba(10, 132, 255, 0.32); }
    .btn.danger {
      border: none;
      background: linear-gradient(140deg, #ff3b30, #ff5e57);
      color: #ffffff;
      box-shadow: 0 14px 30px rgba(255, 59, 48, 0.24);
    }
    .btn.danger:hover { box-shadow: 0 18px 36px rgba(255, 59, 48, 0.3); }
    .btn.ghost {
      background: rgba(255, 255, 255, 0.18);
      border: 1px solid rgba(255, 255, 255, 0.35);
      color: #f4f8ff;
    }
    .btn.small {
      padding: 6px 12px;
      border-radius: 12px;
      font-size: 11px;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 18px;
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(96, 112, 140, 0.12);
      box-shadow: 0 16px 34px rgba(15, 23, 42, 0.12);
    }
    .card h2 {
      margin: 0;
      font: 600 15px/1.35 "SF Pro Text", -apple-system, sans-serif;
      color: #111827;
    }
    .card p {
      margin: 0;
      font-size: 12px;
      line-height: 1.6;
      color: rgba(31, 41, 55, 0.6);
    }
    .form label {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12px;
      color: rgba(31, 41, 55, 0.58);
    }
    .form input, .form textarea {
      width: 100%;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(93, 110, 139, 0.16);
      background: rgba(255, 255, 255, 0.98);
      font: 13px/1.5 -apple-system, sans-serif;
      color: #1c1d1f;
      transition: border 0.2s ease, box-shadow 0.2s ease;
    }
    .form input:focus, .form textarea:focus {
      border-color: rgba(10, 132, 255, 0.45);
      box-shadow: 0 0 0 4px rgba(10, 132, 255, 0.14);
      outline: none;
    }
    .form textarea { min-height: 120px; resize: vertical; }
    .form-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .form-tip {
      font-size: 12px;
      color: rgba(31, 41, 55, 0.5);
      line-height: 1.6;
    }
    .list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .search {
      flex: 1;
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid rgba(93, 110, 139, 0.16);
      background: rgba(244, 246, 250, 0.9);
      font: 13px/1.4 -apple-system, sans-serif;
      color: #1f2937;
    }
    .search::placeholder { color: rgba(93, 110, 139, 0.55); }
    .list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 220px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .item {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
      border-radius: 20px;
      border: 1px solid rgba(96, 112, 140, 0.14);
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 16px 30px rgba(30, 41, 59, 0.12);
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    }
    .item:hover {
      transform: translateY(-2px);
      box-shadow: 0 24px 46px rgba(31, 41, 55, 0.16);
      border-color: rgba(10, 132, 255, 0.28);
    }
    .item.editing {
      border-color: rgba(10, 132, 255, 0.6);
      box-shadow: 0 26px 52px rgba(10, 132, 255, 0.24);
    }
    .item-main { display: flex; flex-direction: column; gap: 6px; text-align: left; cursor: pointer; }
    .item-key { font: 600 13px/1.4 -apple-system, sans-serif; color: #1c1d1f; }
    .item-preview { font-size: 12px; color: rgba(60, 60, 67, 0.64); line-height: 1.55; max-height: 3.8em; overflow: hidden; }
    .item-actions { display: flex; gap: 10px; }
    .mini-btn {
      flex: 1;
      border-radius: 999px;
      padding: 7px 12px;
      font: 500 12px/1 -apple-system, sans-serif;
      border: 1px solid rgba(96, 112, 140, 0.16);
      background: rgba(244, 247, 252, 0.92);
      color: #1f2023;
      transition: border 0.2s ease, color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
    }
    .mini-btn:hover {
      border-color: rgba(10, 132, 255, 0.36);
      color: #0a84ff;
      box-shadow: 0 6px 14px rgba(10, 132, 255, 0.16);
    }
    .mini-btn.danger { border-color: rgba(255, 99, 71, 0.32); color: #ff3b30; }
    .mini-btn.danger:hover { background: rgba(255, 99, 71, 0.12); box-shadow: 0 6px 14px rgba(255, 99, 71, 0.18); }
    .list-empty {
      display: none;
      align-items: center;
      justify-content: center;
      border-radius: 18px;
      border: 1px dashed rgba(96, 112, 140, 0.24);
      background: rgba(235, 239, 249, 0.82);
      color: rgba(60, 60, 67, 0.48);
      padding: 16px;
      font-size: 12px;
    }
    .utilities { display: flex; flex-direction: column; gap: 12px; }
    .utilities-header { display: flex; flex-direction: column; gap: 6px; }
    .utility-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .utility-row.primary .btn,
    .utility-row.secondary .btn { width: 100%; justify-content: center; }
    .utility-row.secondary .btn.danger { grid-column: 3; }
    .file-btn { position: relative; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
    .file-btn input { display: none; }
    .settings-actions, .ai-resume-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .ai-resume textarea {
      width: 100%;
      min-height: 160px;
      border-radius: 16px;
      border: 1px solid rgba(93, 110, 139, 0.18);
      background: rgba(255, 255, 255, 0.98);
      padding: 12px;
      font: 13px/1.6 -apple-system, sans-serif;
      color: #1c1d1f;
      resize: vertical;
    }
    .debug-details { font-size: 12px; color: rgba(28, 28, 30, 0.7); }
    .debug-details summary { font-weight: 600; cursor: pointer; margin-bottom: 8px; }
    .debug-actions { display: flex; gap: 8px; margin-bottom: 8px; }
    .debug-log {
      max-height: 200px;
      overflow: auto;
      background: rgba(17, 24, 39, 0.92);
      color: #f8fafc;
      border-radius: 16px;
      padding: 12px;
      font: 12px/1.5 "SFMono-Regular", Consolas, monospace;
      display: flex; flex-direction: column; gap: 6px;
    }
    .log-entry { display: block; color: #e2e8f0; }
    .log-entry .ts { color: #94a3b8; margin-right: 6px; }
    .log-entry .lvl { text-transform: uppercase; font-weight: 600; margin-right: 6px; }
    .log-entry.level-info .lvl { color: #0a84ff; }
    .log-entry.level-success .lvl { color: #34c759; }
    .log-entry.level-warn .lvl { color: #ff9500; }
    .log-entry.level-error .lvl { color: #ff3b30; }
    .log-entry .detail { color: #cbd5f5; margin-top: 2px; display: block; white-space: pre-wrap; word-break: break-word; }
    .log-empty { font-size: 12px; color: rgba(148, 163, 184, 0.9); text-align: center; padding: 12px 0; }
    .ai-status { display: none; padding: 9px 14px; border-radius: 999px; font: 12px/1.3 -apple-system, sans-serif; color: #1d1d1f; background: rgba(210, 240, 255, 0.72); border: 1px solid rgba(10, 132, 255, 0.35); align-self: flex-start; }
    .ai-status.show { display: inline-flex; align-items: center; gap: 6px; }
    .ai-status::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: 0.75; }
    .ai-status.type-success { background: rgba(209, 250, 229, 0.78); border-color: rgba(52, 199, 89, 0.45); color: #1f9d57; }
    .ai-status.type-error { background: rgba(255, 220, 220, 0.82); border-color: rgba(255, 59, 48, 0.45); color: #d93025; }
    .ai-status.type-warn { background: rgba(255, 244, 214, 0.82); border-color: rgba(255, 149, 0, 0.45); color: #b15d00; }
    .ai-status.type-info { background: rgba(225, 239, 255, 0.82); border-color: rgba(10, 132, 255, 0.42); color: #0a84ff; }
    .ai-toast {
      position: absolute;
      bottom: calc(100% + 12px);
      right: 0;
      padding: 10px 16px;
      border-radius: 16px;
      font: 12px/1.3 -apple-system, sans-serif;
      box-shadow: 0 24px 56px rgba(15, 23, 42, 0.32);
      display: none;
      background: rgba(10, 132, 255, 0.95);
      color: #fefefe;
      backdrop-filter: blur(10px);
    }
    .ai-toast.type-success { background: rgba(52, 199, 89, 0.95); }
    .ai-toast.type-error { background: rgba(255, 59, 48, 0.95); }
    .ai-toast.type-loading { background: rgba(10, 132, 255, 0.95); }
    .ai-toast.type-warn { background: rgba(255, 149, 0, 0.95); }
    .ai-toast.type-info { background: rgba(90, 200, 250, 0.95); }
    .fab {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(145deg, #0a84ff, #4f9dff);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.45);
      box-shadow: 0 20px 44px rgba(10, 132, 255, 0.24);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      transition: transform 0.3s cubic-bezier(0.33, 0.21, 0.2, 1), box-shadow 0.3s ease, opacity 0.25s ease;
    }
    .fab:hover { box-shadow: 0 26px 60px rgba(10, 132, 255, 0.3); transform: translateY(-1px); }
    :host(.open) .fab { opacity: 0; pointer-events: none; transform: scale(0.82); }
  `;
  shadow.appendChild(style);

  // FAB 按钮
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.type = 'button';
  fab.title = '打开简历助手面板';
  fab.setAttribute('aria-label', '打开简历助手面板');
  fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="7" width="20" height="14" rx="6" fill="url(#grad)"/>
      <path d="M9.6 4.5c.8-1.8 4-1.8 4.8 0l.35.79a1 1 0 0 0 .92.62h2.15c1.93 0 3.5 1.57 3.5 3.5V15c0 1.93-1.57 3.5-3.5 3.5H6.2A3.7 3.7 0 0 1 2.5 14.8l.06-4.84A3.5 3.5 0 0 1 6.06 6.5h2.15a1 1 0 0 0 .91-.62L9.6 4.5Z" fill="white" fill-opacity="0.28"/>
      <path d="M12 10.2a1 1 0 0 0-1 1v1.3H9.7a1 1 0 1 0 0 2H11v1.3a1 1 0 0 0 2 0v-1.3h1.3a1 1 0 1 0 0-2H13v-1.3a1 1 0 0 0-1-1Z" fill="white"/>
      <defs>
        <linearGradient id="grad" x1="2" y1="7" x2="22" y2="21" gradientUnits="userSpaceOnUse">
          <stop stop-color="#0A84FF"/>
          <stop offset="1" stop-color="#5AC8FA"/>
        </linearGradient>
      </defs>
    </svg>
  `;
  const toast = document.createElement('div');
  toast.className = 'ai-toast';

  // 面板
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="header">
      <div class="brand">
        <span class="brand-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="28" height="28" rx="9" fill="url(#brandGradient)"/>
            <path d="M13.96 7c2.4 0 4.34 1.1 5.36 3.06a.9.9 0 0 1-1.6.84c-.68-1.28-2.02-2-3.76-2-2.64 0-4.53 1.72-4.53 4.29 0 2.54 1.9 4.28 4.53 4.28 1.74 0 3.08-.72 3.75-2a.9.9 0 0 1 1.61.83C18.3 18.9 16.36 20 13.96 20c-3.68 0-6.4-2.58-6.4-6.8C7.56 9 10.28 7 13.96 7Z" fill="white"/>
            <defs>
              <linearGradient id="brandGradient" x1="4" y1="2" x2="24" y2="26" gradientUnits="userSpaceOnUse">
                <stop stop-color="#0A84FF"/>
                <stop offset="1" stop-color="#5AC8FA"/>
              </linearGradient>
            </defs>
          </svg>
        </span>
        <div class="brand-text">
          <div class="title">简历助手</div>
          <p class="subtitle">智能管理常用简历字段，随时随地一键填充。</p>
        </div>
      </div>
      <button class="btn ghost small close" title="收起" type="button">收起</button>
    </div>
    <div class="panel-body">
      <div class="ai-status"></div>
      <section class="form card">
        <div>
          <h2>快速录入</h2>
          <p>保存常用的简历字段，稍后可直接注入网页表单。</p>
        </div>
        <label>
          键（名称）
          <input class="key-input" type="text" placeholder="例如：姓名、邮箱、求职意向" />
        </label>
        <label>
          值（内容）
          <textarea class="value-input" rows="3" placeholder="在此输入要保存的内容"></textarea>
        </label>
        <div class="form-actions">
          <button class="btn primary" data-action="save-key" type="button">添加/更新</button>
          <button class="btn secondary" data-action="clear-form" type="button">清空输入</button>
        </div>
        <p class="form-tip">先在网页上点击一个输入框，再点下方键按钮即可填入保存的值。</p>
      </section>
      <section class="list-section card">
        <div class="list-header">
          <div>
            <h2>键值列表</h2>
            <p>支持名称与内容模糊搜索，点击条目即可回填。</p>
          </div>
          <input class="search" type="text" placeholder="搜索键或内容..." />
        </div>
        <div class="list"></div>
        <div class="list-empty">暂无键值，请先添加。</div>
      </section>
      <section class="utilities card">
        <div class="utilities-header">
          <h2>常用操作</h2>
          <p>调用 AI、同步数据或导入导出键值。</p>
        </div>
        <div class="utility-row primary">
          <button class="btn primary" data-action="run-ai" type="button">AI 自动填写</button>
          <button class="btn secondary" data-action="toggle-suggest" type="button">自动建议：加载中</button>
          <button class="btn secondary" data-action="refresh" type="button">刷新</button>
        </div>
        <div class="utility-row secondary">
          <button class="btn secondary" data-action="export" type="button">导出</button>
          <label class="btn secondary file-btn">导入
            <input class="import-input" type="file" accept="application/json" />
          </label>
          <button class="btn danger" data-action="clear-all" type="button">清空全部</button>
        </div>
      </section>
      <section class="settings card">
        <h2>阿里云百炼 API Key</h2>
        <p>密钥仅保存在本地浏览器，用于调用生成式能力。</p>
        <input class="api-key-input" type="password" placeholder="sk-..." autocomplete="off" />
        <div class="settings-actions">
          <button class="btn primary" data-action="save-api-key" type="button">保存密钥</button>
          <button class="btn secondary" data-action="clear-api-key" type="button">清除密钥</button>
        </div>
      </section>
      <section class="ai-resume card">
        <h2>AI 简历文本</h2>
        <p>若填写内容，AI 优先使用；留空则根据键值自动拼接。</p>
        <textarea class="ai-resume-input" placeholder="在此粘贴或编辑完整简历文本，保存后用于 AI 回答。"></textarea>
        <div class="ai-resume-actions">
          <button class="btn primary" data-action="save-ai-resume" type="button">保存文本</button>
          <button class="btn secondary" data-action="regen-ai-resume" type="button">重新生成</button>
          <button class="btn secondary" data-action="clear-ai-resume" type="button">恢复自动生成</button>
          <button class="btn secondary" data-action="split-ai-resume" type="button">拆分为键值</button>
        </div>
      </section>
      <section class="debug card">
        <h2>调试日志</h2>
        <p>用于排查问题，可复制并发送给技术支持。</p>
        <details class="debug-details" open>
          <summary>查看日志</summary>
          <div class="debug-actions">
            <button class="btn secondary small" data-action="copy-log" type="button">复制日志</button>
            <button class="btn secondary small" data-action="clear-log" type="button">清空日志</button>
          </div>
          <div class="debug-log"></div>
          <div class="log-empty">暂无日志</div>
        </details>
      </section>
    </div>
  `;
;
  const stack = document.createElement('div');
  stack.className = 'stack';
  stack.appendChild(panel);
  stack.appendChild(toast);
  stack.appendChild(fab);
  shadow.appendChild(stack);

  const closeBtn = panel.querySelector('.close');
  const keyInput = panel.querySelector('.key-input');
  const valueInput = panel.querySelector('.value-input');
  const search = panel.querySelector('.search');
  const list = panel.querySelector('.list');
  const listEmpty = panel.querySelector('.list-empty');
  const aiStatus = panel.querySelector('.ai-status');
  const saveKeyBtn = panel.querySelector('[data-action="save-key"]');
  const importInput = panel.querySelector('.import-input');
  const apiKeyInput = panel.querySelector('.api-key-input');
  const aiResumeInput = panel.querySelector('.ai-resume-input');
  const debugLogContainer = panel.querySelector('.debug-log');
  const debugEmpty = panel.querySelector('.log-empty');
  const debugDetails = panel.querySelector('.debug-details');
  const debugCopyBtn = panel.querySelector('[data-action="copy-log"]');
  const debugClearBtn = panel.querySelector('[data-action="clear-log"]');
  let lastStatus = { message: '', type: 'loading', autoHide: 0, timestamp: 0 };

  renderDebugLog();
  pushLog('info', '内容脚本已注入', { url: location.href });

  function formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderDebugLog() {
    if (!debugLogContainer || !debugEmpty) return;
    debugLogContainer.innerHTML = '';
    if (!debugLogs.length) {
      debugEmpty.style.display = 'block';
      return;
    }
    debugEmpty.style.display = 'none';
    for (let i = debugLogs.length - 1; i >= 0; i--) {
      const entry = debugLogs[i];
      const el = document.createElement('div');
      const levelClass = `level-${entry.level}`;
      el.className = `log-entry ${levelClass}`;
      const detailText = entry.detail !== undefined && entry.detail !== null && entry.detail !== ''
        ? (typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail, null, 2))
        : '';
      el.innerHTML = `
        <span class="ts">${escapeHtml(formatTime(entry.timestamp))}</span>
        <span class="lvl">${escapeHtml(entry.level)}</span>
        <span class="msg">${escapeHtml(entry.message)}</span>
        ${detailText ? `<span class="detail">${escapeHtml(detailText)}</span>` : ''}
      `;
      debugLogContainer.appendChild(el);
    }
  }

  function pushLog(level, message, detail) {
    const lvl = (level || 'info').toLowerCase();
    const entry = {
      level: ['error', 'warn', 'success', 'info'].includes(lvl) ? lvl : 'info',
      message: message || '',
      detail,
      timestamp: new Date()
    };
    debugLogs.push(entry);
    if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.shift();
    renderDebugLog();
    if (debugDetails && !debugDetails.open) {
      debugDetails.open = true;
    }
    if (entry.level === 'error') {
      console.error('[简历助手]', entry.message, detail);
    } else if (entry.level === 'warn') {
      console.warn('[简历助手]', entry.message, detail);
    } else {
      console.log('[简历助手]', entry.message, detail ?? '');
    }
  }

  window.__resume_bucket_pushLog = pushLog;

  function composeResumeFromBucket(data) {
    const src = data || {};
    const pick = (key, fallback = '') => {
      if (src[key]) return String(src[key]);
      return fallback;
    };
    const parts = [];
    const name = pick('姓名','');
    const intent = pick('求职意向','');
    if (name || intent) parts.push(`${name}｜求职意向：${intent}`.trim());
    const contactBits = [
      pick('现居城市',''),
      pick('手机','') ? `手机：${pick('手机','')}` : '',
      pick('邮箱','') ? `邮箱：${pick('邮箱','')}` : ''
    ].filter(Boolean);
    if (contactBits.length) parts.push(contactBits.join('｜'));
    const onboard = [pick('到岗时间',''), pick('驻外意愿备注','')].filter(Boolean).join('｜');
    if (onboard) parts.push(`到岗时间：${onboard}`);
    const highlights = [
      pick('资格亮点-野外地质',''),
      pick('资格亮点-科创课题',''),
      pick('资格亮点-无人机',''),
      pick('资格亮点-英语',''),
      pick('资格亮点-媒体数据','')
    ].filter(Boolean).join('；');
    if (highlights) parts.push(`资格亮点：${highlights}`);
    const edu = pick('教育-完整','');
    if (edu) parts.push(`教育经历：${edu}`);
    const exp1 = pick('经历-野外地质实习-地点','') ? `野外地质实习（${pick('经历-野外地质实习-地点','')}｜${pick('经历-野外地质实习-时间','')}）：${pick('经历-野外地质实习-描述','')}` : '';
    const exp2 = pick('经历-野外填图实习-地点','') ? `野外填图实习（${pick('经历-野外填图实习-地点','')}｜${pick('经历-野外填图实习-时间','')}）：${pick('经历-野外填图实习-描述','')}` : '';
    const practice = [exp1, exp2].filter(Boolean).join('；');
    if (practice) parts.push(`实践经历：${practice}`);
    const projects = [
      pick('项目-科创-课题',''),
      pick('项目-央视网-名称',''),
      pick('项目-毕业视频-说明','')
    ].filter(Boolean).join('；');
    if (projects) parts.push(`项目经历：${projects}`);
    const skills = [
      pick('技能-地质',''),
      pick('技能-无人机/测绘',''),
      pick('技能-软件',''),
      pick('技能-语言','')
    ].filter(Boolean).join('；');
    if (skills) parts.push(`技能证书：${skills}`);
    const honors = [pick('荣誉1',''), pick('荣誉2',''), pick('荣誉3',''), pick('荣誉4','')].filter(Boolean).join('；');
    if (honors) parts.push(`荣誉奖励：${honors}`);
    return parts.filter(Boolean).join('\n');
  }

  function composeFallbackResume() {
    try {
      return composeResumeFromBucket(bucket);
    } catch (err) {
      pushLog('warn', '自动拼接简历失败', err?.message || err);
      return '';
    }
  }

  function applyAiResumeToInput(text, source='load') {
    aiResumeText = text || '';
    if (aiResumeInput) aiResumeInput.value = aiResumeText;
    pushLog('info', 'AI 简历文本更新', { source, length: aiResumeText.length });
  }

  function logContextDetails(el, ctx) {
    if (!el) return;
    const normalizeText = (txt) => (txt || '').replace(/\s+/g, ' ').trim();
    const info = {
      tag: el.tagName,
      type: el.getAttribute?.('type') || '',
      name: el.getAttribute?.('name') || '',
      id: el.id || '',
      placeholder: el.getAttribute?.('placeholder') || '',
      title: el.getAttribute?.('title') || '',
      ariaLabel: el.getAttribute?.('aria-label') || '',
      ariaLabelledby: el.getAttribute?.('aria-labelledby') || '',
      maxLength: el.getAttribute?.('maxlength') || '',
      contextPreview: (ctx || '').slice(0, 200)
    };
    const labelledBy = el.getAttribute?.('aria-labelledby');
    if (labelledBy) {
      info.labelledText = labelledBy.split(/\s+/).map((id) => {
        const node = id && document.getElementById(id);
        return node ? normalizeText(node.textContent) : '';
      }).filter(Boolean);
    }
    const nearest = el.closest('label,[data-label],[data-field-label],th,td,dt,dd,li,section,article');
    if (nearest) {
      info.nearestText = normalizeText(nearest.textContent).slice(0, 200);
    }
    const prevTexts = [];
    let prev = el.previousSibling;
    while (prev && prevTexts.length < 3) {
      const text = normalizeText(prev.textContent || '');
      if (text) prevTexts.push(text.slice(0, 120));
      prev = prev.previousSibling;
    }
    if (prevTexts.length) info.previousTexts = prevTexts;
    const nearby = collectNearbyTexts(el).map((item) => ({ text: item.text, point: item.point }));
    if (nearby.length) info.nearbyTexts = nearby;
    pushLog('info', '输入框上下文详情', info);
  }

  function buildFieldHints(target, ctx, typed, maxLength) {
    const attrParts = [
      ctx || '',
      target?.getAttribute?.('name') || '',
      target?.getAttribute?.('id') || '',
      target?.getAttribute?.('placeholder') || '',
      target?.getAttribute?.('title') || '',
      target?.getAttribute?.('aria-label') || ''
    ].join(' ').replace(/\s+/g, ' ').trim();
    const labelTexts = collectLabelTexts(target).map((entry) => entry.text).filter(Boolean);
    const nearby = collectNearbyTexts(target).map((entry) => entry.text).filter(Boolean);
    return {
      attrSummary: attrParts.slice(0, 200),
      labelTexts: labelTexts.slice(0, 5),
      nearbyTexts: nearby.slice(0, 5),
      typedPreview: (typed || '').slice(0, 160),
      contextPreview: (ctx || '').slice(0, 200),
      maxLength: maxLength || 0
    };
  }

  function collectLabelTexts(el) {
    const texts = [];
    const normalize = (txt) => (txt || '').replace(/\s+/g, ' ').trim();
    const ariaLabel = el.getAttribute?.('aria-label');
    if (ariaLabel) texts.push({ text: normalize(ariaLabel), weight: 6, source: 'aria-label' });
    const ariaLabelledby = el.getAttribute?.('aria-labelledby');
    if (ariaLabelledby) {
      ariaLabelledby.split(/\s+/).forEach((id) => {
        const node = id && document.getElementById(id);
        const text = node ? normalize(node.textContent) : '';
        if (text) texts.push({ text, weight: 6, source: `aria-labelledby:${id}` });
      });
    }
    const directLabel = el.closest('label');
    if (directLabel) {
      const text = normalize(directLabel.textContent);
      if (text) texts.push({ text, weight: 8, source: 'closest-label' });
    }
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 5) {
      const parent = node.parentNode;
      if (!parent) break;
      const children = Array.from(parent.childNodes);
      const index = children.indexOf(node);
      for (let i = index - 1; i >= 0; i--) {
        const text = normalize(children[i].textContent || '');
        if (text) {
          texts.push({ text, weight: Math.max(4 - depth, 1), source: `sibling-${depth}` });
          break;
        }
      }
      node = parent;
      depth += 1;
    }
    return texts;
  }

  function collectNearbyTexts(el) {
    const results = [];
    const rect = el.getBoundingClientRect();
    if (!rect || !isFinite(rect.left) || !isFinite(rect.top)) return results;
    const samplePoints = [
      { x: rect.left - 12, y: rect.top + rect.height / 2 },
      { x: rect.left + rect.width / 2, y: rect.top - 10 },
      { x: rect.left + rect.width + 12, y: rect.top + rect.height / 2 }
    ];
    const normalize = (txt) => (txt || '').replace(/\s+/g, ' ').trim();
    for (const point of samplePoints) {
      if (point.x < 0 || point.y < 0 || point.x > window.innerWidth || point.y > window.innerHeight) continue;
      const elements = document.elementsFromPoint(point.x, point.y) || [];
      for (const elAtPoint of elements) {
        if (elAtPoint === el) continue;
        const text = normalize(elAtPoint?.textContent || '');
        if (text && text.length <= 120) {
          results.push({ text, point });
          break;
        }
      }
    }
    return results;
  }

  function copyDebugLog() {
    const text = debugLogs.map((entry) => {
      const detailText = entry.detail !== undefined && entry.detail !== null && entry.detail !== ''
        ? (typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail, null, 2))
        : '';
      return `[${formatTime(entry.timestamp)}] ${entry.level.toUpperCase()} ${entry.message}${detailText ? `\n${detailText}` : ''}`;
    }).join('\n');
    if (!text) {
      setAiStatus('暂无日志可复制', 'loading', 1800);
      return;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setAiStatus('日志已复制到剪贴板', 'success', 2000);
      }).catch((err) => {
        setAiStatus('复制失败：' + (err?.message || err), 'error', 3000);
        pushLog('warn', '复制日志失败', err?.message || err);
      });
    } else {
      setAiStatus('当前环境不支持自动复制', 'warn', 2500);
      pushLog('warn', 'navigator.clipboard 不可用');
    }
  }

  function clearDebugLog() {
    debugLogs.length = 0;
    renderDebugLog();
    setAiStatus('日志已清空', 'success', 1800);
    console.log('[简历助手] 调试日志已清空');
  }

  function formatBucketPreview(value) {
    const normalized = (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
    if (!normalized) return '（无内容）';
    if (normalized.length <= 90) return normalized;
    return normalized.slice(0, 90) + '…';
  }

  function renderKeys() {
    const query = (search?.value || '').trim().toLowerCase();
    list.innerHTML = '';
    let visibleCount = 0;
    const keys = Object.keys(bucket).sort((a, b) => a.localeCompare(b));
    for (const k of keys) {
      const value = bucket[k] ?? '';
      const haystack = `${k}
${value}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      visibleCount++;
      const row = document.createElement('div');
      row.className = 'item';
      if (editingOriginalKey === k) row.classList.add('editing');

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'item-main';
      main.title = '点击填入当前聚焦输入框';
      main.addEventListener('click', () => {
        let el = null;
        const ae = document.activeElement;
        if (ae && isTextInput(ae) && !host.contains(ae)) el = ae;
        else if (lastFocusedInput && isTextInput(lastFocusedInput)) el = lastFocusedInput;
        if (el) {
          fillValue(el, value ?? '');
        } else {
          alert('请先在页面上点击一个可输入的框，然后再点键名。');
        }
      });

      const keyName = document.createElement('span');
      keyName.className = 'item-key';
      keyName.textContent = k;

      const preview = document.createElement('span');
      preview.className = 'item-preview';
      preview.textContent = formatBucketPreview(value);

      main.appendChild(keyName);
      main.appendChild(preview);

      const actions = document.createElement('div');
      actions.className = 'item-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'mini-btn';
      editBtn.textContent = '编辑';
      editBtn.title = '编辑此键值';
      editBtn.addEventListener('click', () => beginEdit(k));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'mini-btn danger';
      deleteBtn.textContent = '删除';
      deleteBtn.title = '删除此键值';
      deleteBtn.addEventListener('click', () => deleteKey(k));

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      row.appendChild(main);
      row.appendChild(actions);
      list.appendChild(row);
    }

    if (listEmpty) {
      if (visibleCount === 0) {
        listEmpty.style.display = 'flex';
        listEmpty.textContent = keys.length === 0
          ? '暂无键值，请先添加。'
          : '没有匹配的键值，请调整搜索关键字。';
      } else {
        listEmpty.style.display = 'none';
      }
    }
  }


  function setOpen(open) {
    state.open = open;
    panel.classList.toggle('open', open);
    host.classList.toggle('open', open);
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    // 保存开关状态（按域名区分）
    const originKey = POS_KEY + ':' + location.origin;
    chrome.storage.local.set({ [originKey]: { ...(host._pos || {}), open } });
    if (toast && open) toast.style.display = 'none';
    if (lastStatus.message) {
      const elapsed = Date.now() - lastStatus.timestamp;
      const remaining = lastStatus.autoHide > 0 ? Math.max(lastStatus.autoHide - elapsed, 0) : 0;
      setAiStatus(lastStatus.message, lastStatus.type, remaining);
    } else if (aiStatus) {
      setAiStatus('', 'loading', 0);
    }
    pushLog('info', open ? '面板打开' : '面板关闭');
  }

  fab.addEventListener('click', () => {
    setOpen(true);
    resetForm();
    renderKeys();
  });
  closeBtn.addEventListener('click', () => {
    setOpen(false);
    resetForm();
    renderKeys();
  });
  search.addEventListener('input', renderKeys);
  function updateSuggestToggleText(){
    const btn = panel.querySelector('[data-action="toggle-suggest"]');
    if (btn) btn.textContent = `自动建议：${settings.autoSuggestEnabled ? '开' : '关'}`;
  }

  panel.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.dataset.action;
    if (!action) return;
    e.preventDefault();
    if (action === 'toggle-suggest') {
      settings.autoSuggestEnabled = !settings.autoSuggestEnabled;
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      updateSuggestToggleText();
    } else if (action === 'refresh') {
      reloadBucket();
    } else if (action === 'save-key') {
      handleSaveKey();
    } else if (action === 'clear-form') {
      resetForm();
      renderKeys();
    } else if (action === 'export') {
      handleExport();
    } else if (action === 'clear-all') {
      handleClearAll();
    } else if (action === 'save-api-key') {
      handleSaveApiKey();
    } else if (action === 'clear-api-key') {
      handleClearApiKey();
    } else if (action === 'copy-log') {
      copyDebugLog();
    } else if (action === 'clear-log') {
      clearDebugLog();
    } else if (action === 'run-ai') {
      aiSuggestForTarget();
    } else if (action === 'save-ai-resume') {
      handleSaveAiResume();
    } else if (action === 'regen-ai-resume') {
      handleRegenAiResume();
    } else if (action === 'clear-ai-resume') {
      handleClearAiResume();
    } else if (action === 'split-ai-resume') {
      handleSplitAiResume();
    }
  });

  if (importInput) {
    importInput.addEventListener('change', (event) => {
      const inputEl = event.target;
      if (inputEl && inputEl.files && inputEl.files[0]) {
        handleImport(inputEl.files[0]);
      }
    });
  }

  // 监听页面上的聚焦事件（捕获阶段），记录最近一次聚焦的输入框
  function onFocusIn(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (host.contains(t)) return; // 忽略面板内部
    if (isSelectLike(t)) {
      pushLog('info', '检测到下拉选择控件，关闭建议以免遮挡', { tag: t.tagName, type: t.getAttribute?.('type') });
      closeSuggest({ suppress: true });
      suppressSuggestionUntil = Date.now() + 800;
      return;
    }
    if (isTextInput(t)) {
      lastFocusedInput = t;
      const ctxSnapshot = buildContext(t);
      pushLog('info', '捕获输入焦点', {
        tag: t.tagName,
        name: t.getAttribute('name') || '',
        id: t.id || '',
        placeholder: t.getAttribute('placeholder') || '',
        contextPreview: ctxSnapshot.slice(0, 120)
      });
      logContextDetails(t, ctxSnapshot);
      if (settings.autoSuggestEnabled) openSuggestFor(t); else closeSuggest();
    } else {
      closeSuggest();
    }
  }
  window.addEventListener('focusin', onFocusIn, true);

  // 简单拖拽，拖动 header 移动面板/按钮
  (function enableDrag() {
    const header = panel.querySelector('.header');
    let startX = 0, startY = 0, startLeft = 0, startTop = 0, dragging = false;
    function onDown(e) {
      dragging = true;
      const rect = host.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
      startX = e.clientX; startY = e.clientY;
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - startX; const dy = e.clientY - startY;
      const left = Math.max(0, Math.min(window.innerWidth - rectWidth(), startLeft + dx));
      const top = Math.max(0, Math.min(window.innerHeight - rectHeight(), startTop + dy));
      host.style.left = left + 'px';
      host.style.top = top + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      // 保存位置
      const rect = host.getBoundingClientRect();
      host._pos = { left: rect.left, top: rect.top };
      const originKey = POS_KEY + ':' + location.origin;
      chrome.storage.local.set({ [originKey]: { ...(host._pos || {}), open: state.open } });
    }
    function rectWidth(){
      const stackRect = stack.getBoundingClientRect();
      if (stackRect.width) return stackRect.width;
      return fab.getBoundingClientRect().width || 72;
    }
    function rectHeight(){
      const stackRect = stack.getBoundingClientRect();
      if (stackRect.height) return stackRect.height;
      return fab.getBoundingClientRect().height || 72;
    }
    header.addEventListener('mousedown', onDown);
    header.addEventListener('touchstart', (e)=>onDown(e.touches[0]));
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', (e)=>onMove(e.touches[0]));
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  })();

  // 加载存储数据与位置
  function loadAll() {
    return new Promise((resolve) => {
      const originKey = POS_KEY + ':' + location.origin;
      chrome.storage.local.get([STORAGE_KEY, originKey, SETTINGS_KEY, API_KEY_STORAGE, AI_RESUME_KEY], (res) => {
        bucket = res[STORAGE_KEY] || {};
        settings = Object.assign({ autoSuggestEnabled: true }, res[SETTINGS_KEY] || {});
        let storedApiKey = res[API_KEY_STORAGE] || '';
        if (!storedApiKey) {
          storedApiKey = DEFAULT_API_KEY;
          chrome.storage.local.set({ [API_KEY_STORAGE]: storedApiKey });
          pushLog('info', 'API 密钥使用默认值', { length: storedApiKey.length });
        }
        if (apiKeyInput) apiKeyInput.value = storedApiKey;
        const pos = res[originKey];
        if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
          host.style.left = pos.left + 'px';
          host.style.top = pos.top + 'px';
          host.style.right = 'auto';
          host.style.bottom = 'auto';
          host._pos = { left: pos.left, top: pos.top };
        }
        setOpen(Boolean(pos?.open));
        updateSuggestToggleText();
        renderKeys();
        const storedResume = res[AI_RESUME_KEY];
        if (typeof storedResume === 'string' && storedResume.trim()) {
          applyAiResumeToInput(storedResume, 'storage');
        } else {
          applyAiResumeToInput(composeFallbackResume(), 'auto');
        }
        pushLog('info', '数据加载完成', {
          keyCount: Object.keys(bucket).length,
          autoSuggestEnabled: settings.autoSuggestEnabled,
          hasApiKey: Boolean(storedApiKey)
        });
        resolve();
      });
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) {
      bucket = changes[STORAGE_KEY].newValue || {};
      if (editingOriginalKey && !(editingOriginalKey in bucket)) {
        resetForm();
      }
      renderKeys();
      pushLog('info', '检测到键值存储变更', {
        keyCount: Object.keys(bucket).length
      });
    }
    if (changes[SETTINGS_KEY]) {
      settings = Object.assign({ autoSuggestEnabled: true }, changes[SETTINGS_KEY].newValue || {});
      updateSuggestToggleText();
      pushLog('info', '自动建议设置更新', { autoSuggestEnabled: settings.autoSuggestEnabled });
    }
    if (changes[API_KEY_STORAGE]) {
      if (apiKeyInput) apiKeyInput.value = changes[API_KEY_STORAGE].newValue || '';
      pushLog('info', 'API 密钥已更新（长度）', { length: (changes[API_KEY_STORAGE].newValue || '').length });
    }
    if (changes[AI_RESUME_KEY]) {
      const newText = changes[AI_RESUME_KEY].newValue;
      if (typeof newText === 'string' && newText.trim()) {
        applyAiResumeToInput(newText, 'storage-change');
      } else {
        applyAiResumeToInput(composeFallbackResume(), 'storage-change-auto');
      }
    }
  });

  loadAll().catch(()=>{});

  // =============== 输入框模糊匹配建议 =================
  // 在输入框聚焦/输入时，根据 placeholder/label/name 等与已保存键做模糊匹配，显示下拉建议
  let suggestHost = null;
  let suggestShadow = null;
  let suggestBox = null;
  let suggestList = null;
  let suggestItems = [];
  let suggestIndex = -1;
  let suggestTarget = null;
  let repositionTimer = null;
  let aiLoading = false;
  let aiStatusTimer = null;

  function setAiStatus(message, type = 'loading', autoHideMs = 0) {
    if (aiStatusTimer) {
      clearTimeout(aiStatusTimer);
      aiStatusTimer = null;
    }

    const normalizedType = type && ['loading','success','error','warn','info'].includes(type) ? type : 'loading';

    if (message) {
      lastStatus = { message, type: normalizedType, autoHide: autoHideMs, timestamp: Date.now() };
    } else {
      lastStatus = { message: '', type: 'loading', autoHide: 0, timestamp: 0 };
    }

    // 面板内状态
    if (aiStatus) {
      if (state.open && message) {
        aiStatus.className = `ai-status show type-${normalizedType}`;
        aiStatus.textContent = message;
      } else {
        aiStatus.className = 'ai-status';
        aiStatus.textContent = '';
      }
    }

    // FAB 附近的 toast（面板未打开时提示）
    if (toast) {
      if (!state.open && message) {
        toast.className = `ai-toast type-${normalizedType}`;
        toast.textContent = message;
        toast.style.display = 'block';
      } else {
        toast.style.display = 'none';
      }
    }

    if (message && autoHideMs > 0) {
      aiStatusTimer = setTimeout(() => {
        if (aiStatus) {
          aiStatus.className = 'ai-status';
          aiStatus.textContent = '';
        }
        if (toast) {
          toast.style.display = 'none';
        }
        lastStatus = { message: '', type: 'loading', autoHide: 0, timestamp: 0 };
        aiStatusTimer = null;
      }, autoHideMs);
    }
  }

  function persistBucket() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: bucket }, resolve);
    });
  }

  function reloadBucket() {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
      bucket = res[STORAGE_KEY] || {};
      renderKeys();
      pushLog('info', '手动刷新键值', { keyCount: Object.keys(bucket).length });
    });
  }

  function resetForm() {
    editingOriginalKey = null;
    if (keyInput) keyInput.value = '';
    if (valueInput) valueInput.value = '';
    if (saveKeyBtn) saveKeyBtn.textContent = '添加/更新';
    if (state.open && keyInput) keyInput.focus();
  }

  function beginEdit(k) {
    editingOriginalKey = k;
    if (keyInput) keyInput.value = k;
    if (valueInput) valueInput.value = bucket[k] ?? '';
    if (saveKeyBtn) saveKeyBtn.textContent = '保存修改';
    if (keyInput) keyInput.focus();
    renderKeys();
    pushLog('info', '编辑键', { key: k });
  }

  async function handleSaveKey() {
    const key = (keyInput?.value || '').trim();
    if (!key) {
      alert('请填写键（名称）。');
      keyInput?.focus();
      pushLog('warn', '保存键失败：缺少名称');
      return;
    }
    const value = valueInput?.value ?? '';
    if (editingOriginalKey && editingOriginalKey !== key) {
      delete bucket[editingOriginalKey];
    }
    bucket[key] = value;
    await persistBucket();
    setAiStatus(`已保存“${key}”`, 'success', 1800);
    pushLog('success', '保存键成功', { key, valueLength: value.length });
    resetForm();
    renderKeys();
  }

  async function deleteKey(key) {
    if (!key) return;
    if (!confirm(`确定删除“${key}”吗？`)) return;
    delete bucket[key];
    await persistBucket();
    if (editingOriginalKey === key) {
      resetForm();
    }
    setAiStatus(`已删除“${key}”`, 'success', 1800);
    pushLog('warn', '删除键', { key });
    renderKeys();
  }

  function handleExport() {
    const data = JSON.stringify(bucket, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bucket.json';
    a.click();
    URL.revokeObjectURL(url);
    setAiStatus('已导出键值文件', 'success', 1800);
    pushLog('info', '导出键值文件', { keyCount: Object.keys(bucket).length });
  }

  async function handleImport(file) {
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) throw new Error('格式错误');
      let count = 0;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof k !== 'string') continue;
        bucket[k] = typeof v === 'string' ? v : JSON.stringify(v);
        count += 1;
      }
      await persistBucket();
      setAiStatus(count ? `导入成功（${count} 项）` : '导入成功', 'success', 2000);
      pushLog('success', '导入键值完成', { count });
      renderKeys();
    } catch (e) {
      const msg = e?.message || '未知错误';
      setAiStatus('导入失败：' + msg, 'error', 4000);
      alert('导入失败：' + msg);
      pushLog('error', '导入键值失败', msg);
    } finally {
      if (importInput) importInput.value = '';
    }
  }

  async function handleClearAll() {
    if (!Object.keys(bucket).length) {
      setAiStatus('当前没有键值', 'loading', 1500);
      return;
    }
    if (!confirm('确定清空全部键值吗？此操作不可撤销。')) return;
    bucket = {};
    await persistBucket();
    resetForm();
    renderKeys();
    setAiStatus('已清空全部键值', 'success', 2000);
    pushLog('warn', '清空全部键值');
  }

  async function handleSaveApiKey() {
    const value = apiKeyInput?.value?.trim() || '';
    await chrome.storage.local.set({ [API_KEY_STORAGE]: value });
    setAiStatus(value ? 'API 密钥已保存' : 'API 密钥已清空', 'success', 2000);
    pushLog(value ? 'success' : 'warn', value ? '保存 API 密钥' : '清空 API 密钥', { length: value.length });
  }

  async function handleClearApiKey() {
    if (apiKeyInput) apiKeyInput.value = '';
    await chrome.storage.local.set({ [API_KEY_STORAGE]: '' });
    setAiStatus('API 密钥已清空', 'success', 2000);
    pushLog('warn', '手动清空 API 密钥');
  }

  async function handleSaveAiResume() {
    const text = aiResumeInput?.value?.trim() || '';
    await chrome.storage.local.set({ [AI_RESUME_KEY]: text });
    applyAiResumeToInput(text, 'manual-save');
    setAiStatus(text ? 'AI 简历已保存，将优先使用该文本。' : 'AI 简历已清空，将使用自动生成。', text ? 'success' : 'warn', 2600);
  }

  function handleRegenAiResume() {
    const generated = composeFallbackResume();
    applyAiResumeToInput(generated, 'regenerate');
    setAiStatus('已根据键值重新生成 AI 简历文本，请确认后保存。', 'info', 2600);
  }

  async function handleClearAiResume() {
    await chrome.storage.local.set({ [AI_RESUME_KEY]: '' });
    const fallback = composeFallbackResume();
    applyAiResumeToInput(fallback, 'clear');
    setAiStatus('已恢复自动生成的 AI 简历文本。', 'warn', 2500);
  }

  async function handleSplitAiResume() {
    const text = aiResumeInput?.value?.trim() || '';
    if (!text) {
      setAiStatus('AI 简历文本为空，无法拆分。', 'warn', 2600);
      pushLog('warn', '拆分简历失败：文本为空');
      return;
    }
    setAiStatus('AI 正在拆分简历文本…', 'loading');
    pushLog('info', 'AI 拆分请求开始', { length: text.length });
    try {
      const rsp = await sendRuntimeMessage({
        type: 'AI_SPLIT_RESUME',
        resumeText: text
      });
      if (!rsp?.ok) {
        const err = rsp?.error || '未知错误';
        setAiStatus('AI 拆分失败：' + err, 'error', 3800);
        pushLog('error', 'AI 拆分失败', err);
        return;
      }
      const entries = Array.isArray(rsp.entries) ? rsp.entries : [];
      if (!entries.length) {
        setAiStatus('AI 未返回有效键值，请尝试手动调整文本。', 'warn', 3200);
        pushLog('warn', 'AI 拆分结果为空', rsp.raw || '');
        return;
      }
      const preview = entries.map(({ key, value }) => `${key}：${value}`).join('\n\n');
      const confirmed = confirm(`将根据 AI 拆分结果更新键值，共 ${entries.length} 项。是否继续？\n\n${preview}`);
      if (!confirmed) {
        setAiStatus('已取消导入 AI 拆分结果。', 'info', 2000);
        pushLog('info', '用户取消导入 AI 拆分结果');
        return;
      }
      let updates = 0;
      for (const { key, value } of entries) {
        if (!key) continue;
        bucket[key] = value;
        updates += 1;
      }
      await persistBucket();
      renderKeys();
      setAiStatus(`已导入 AI 拆分结果（${updates} 项）。`, 'success', 2600);
      pushLog('success', 'AI 拆分并更新键值成功', { updates, durationMs: rsp?.durationMs });
    } catch (error) {
      const msg = error?.message || String(error);
      setAiStatus('AI 拆分异常：' + msg, 'error', 3800);
      pushLog('error', 'AI 拆分异常', msg);
    }
  }

  function ensureSuggestUI() {
    if (suggestHost) return;
    suggestHost = document.createElement('div');
    suggestHost.id = 'resume-bucket-suggest-host';
    suggestHost.style.all = 'initial';
    suggestHost.style.position = 'absolute';
    suggestHost.style.zIndex = '2147483646';
    suggestHost.style.pointerEvents = 'none'; // 容器不拦截
    document.documentElement.appendChild(suggestHost);
    suggestShadow = suggestHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif; color: #0f172a; }
      .box { all: initial; display: inline-flex; flex-direction: column; gap: 6px; padding: 6px; min-width: 220px; max-width: 380px; max-height: 240px;
        background: rgba(255, 255, 255, 0.98); color:#0f172a; border-radius: 12px; border: 1px solid rgba(15, 23, 42, 0.06);
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16); pointer-events: none; opacity: 0; visibility: hidden;
        transform: translateY(6px); transition: opacity 0.18s ease, transform 0.2s ease, visibility 0.2s ease; }
      .box.visible { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0); }
      .list-inner { all: initial; display: flex; flex-direction: column; gap: 4px; overflow: auto; }
      .item { all: initial; display:flex; flex-direction:column; gap:4px; padding:8px 10px; border-radius: 10px; cursor:pointer;
        transition: background 0.18s ease, color 0.18s ease; }
      .item:hover, .item.active { background: rgba(10, 132, 255, 0.12); }
      .item.ai-item { all: initial; border-radius: 10px; display:flex; align-items:center; justify-content:center; padding:9px 10px; font-weight:600;
        background: rgba(10, 132, 255, 0.1); color:#0a84ff; }
      .item.ai-item.loading { opacity:0.55; cursor:default; }
      .k { all: initial; display:block; font-weight:600; color:#0f172a; }
      .v { all: initial; display:block; color:rgba(71, 85, 105, 0.68); font-size:12px; line-height:1.45; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    `;
    suggestShadow.appendChild(style);
    suggestBox = document.createElement('div');
    suggestBox.className = 'box';
    suggestList = document.createElement('div');
    suggestList.className = 'list-inner';
    suggestBox.appendChild(suggestList);
    suggestShadow.appendChild(suggestBox);
  }

  function getLabelText(el){
    try {
      // for= 关联
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) return lab.innerText.trim();
      }
      // 包裹 label
      let p = el.parentElement;
      const limit = 3;
      let depth = 0;
      while (p && depth < limit) {
        if (p.tagName === 'LABEL') return p.innerText.trim();
        p = p.parentElement; depth++;
      }
    } catch(_){}
    return '';
  }

  function buildContext(el){
    if (!el) return '';
    const parts = [];
  const attrs = ['placeholder','aria-label','name','id','title','data-field'];
  for (const a of attrs){
    const v = el.getAttribute && el.getAttribute(a);
    if (v) parts.push(v);
  }
  const lab = getLabelText(el); if (lab) parts.push(lab);
  const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
  if (labelledBy) {
    labelledBy.split(/\s+/).forEach((id) => {
      const node = id && document.getElementById(id);
      const text = node?.textContent?.trim();
      if (text) parts.push(text);
    });
  }
  const nearest = el.closest('[data-label],[data-field-label],[role="group"],[role="textbox"],label,th,td,dd,dt,li,section,article,div');
  if (nearest) {
    const clone = nearest.cloneNode(true);
    clone.querySelectorAll('input,textarea,select,button').forEach((node) => node.remove());
    const text = clone.textContent?.trim()?.replace(/\s+/g, ' ');
    if (text) parts.push(text);
  }
  let prev = el.previousSibling;
  let prevTextCount = 0;
  while (prev && prevTextCount < 2) {
    let text = '';
    if (prev.nodeType === Node.TEXT_NODE) {
      text = prev.textContent || '';
    } else if (prev.nodeType === Node.ELEMENT_NODE) {
      text = prev.textContent || '';
    }
    text = text.trim().replace(/\s+/g, ' ');
    if (text) {
      parts.push(text);
      prevTextCount++;
    }
    prev = prev.previousSibling;
  }
  return parts.join(' ').trim();
}

  function deriveMaxLength(el, ctx){
    if (!el) return 0;
    let max = Number(el.getAttribute('maxlength')) || 0;
    const base = ((ctx || '') + ' ' + (el.getAttribute('placeholder') || '')).replace(/\s+/g,'');
    const m = base.match(/(最多|不超过|上限|至多|限制|不得超过)(\d{1,4})(字|字符|个字)?/);
    if (m) {
      const n = Number(m[2]);
      if (n && (!max || n < max)) max = n;
    }
    return max;
  }

  function normalize(s){
    return (s||'').toLowerCase().replace(/\s+/g,'').replace(/[\-_:/\\|]+/g,'');
  }

  function bigrams(s){
    const arr = [];
    for (let i=0;i<s.length-1;i++) arr.push(s.slice(i,i+2));
    return arr;
  }

  function dice(a,b){
    if (!a || !b) return 0;
    if (a === b) return 1;
    const A = bigrams(a), B = bigrams(b);
    if (A.length === 0 || B.length === 0) return 0;
    let inter = 0;
    const map = new Map();
    for (const x of A) map.set(x, (map.get(x)||0)+1);
    for (const y of B) {
      const n = map.get(y)||0; if (n>0){ inter++; map.set(y, n-1); }
    }
    return (2*inter) / (A.length + B.length);
  }

  function scoreKey(key, ctx, typed){
    const k = normalize(key);
    const c = normalize(ctx);
    const t = normalize(typed||'');
    let s = 0;
    if (c.includes(k) || k.includes(c)) s += 0.6;
    s += 0.5 * dice(k, c);
    if (t) {
      if (k.includes(t) || t.includes(k)) s += 0.3;
      s += 0.3 * dice(k, t);
    }
    return s;
  }

  function scoreValue(value, ctx, typed){
    const v = normalize(value||'');
    const c = normalize(ctx||'');
    const t = normalize(typed||'');
    let s = 0;
    if (t) {
      if (v.includes(t) || t.includes(v)) s += 0.45;
      s += 0.25 * dice(v, t);
    }
    // 值与上下文的弱关联（例如“北京”与“城市”匹配较弱），给一点点分值
    s += 0.1 * dice(v, c);
    return s;
  }

  function getSuggestionsFor(el){
    const ctx = buildContext(el);
    const typed = getElementCurrentText(el);
    const keys = Object.keys(bucket);
    const scored = keys.map(k=>({ key:k, score: scoreKey(k, ctx, typed) + scoreValue(bucket[k], ctx, typed) }))
      .filter(x=>x.score >= 0.25)
      .sort((a,b)=>b.score - a.score)
      .slice(0, 8);
    return scored;
  }

  function placeSuggest(el){
    const rect = el.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 4;
    const left = rect.left + window.scrollX;
    const width = Math.max(rect.width, 240);
    suggestHost.style.left = left + 'px';
    suggestHost.style.top = top + 'px';
    suggestBox.style.minWidth = width + 'px';
  }

  function openSuggestFor(el){
    if (Date.now() < suppressSuggestionUntil) {
      pushLog('info', '当前仍在下拉交互抑制期，跳过建议打开');
      return;
    }
    if (!settings.autoSuggestEnabled) { closeSuggest(); return; }
    ensureSuggestUI();
    suggestTarget = el;
    pushLog('info', '打开建议列表', {
      tag: el?.tagName,
      name: el?.getAttribute?.('name') || '',
      placeholder: el?.getAttribute?.('placeholder') || ''
    });
    updateSuggestList();
    if (suggestList && suggestList.children.length > 0) {
      placeSuggest(el);
      suggestBox.classList.add('visible');
      if (suggestHost) suggestHost.style.pointerEvents = 'auto';
      suggestIndex = -1;
      scheduleReposition();
    } else {
      pushLog('warn', '无匹配建议，已关闭列表');
      closeSuggest();
    }
  }

  function updateSuggestList(){
    const items = getSuggestionsFor(suggestTarget);
    suggestItems = items;
    suggestList.innerHTML = '';

    // 顶部 AI 自动填写入口
    const aiRow = document.createElement('div');
    aiRow.className = `item ai-item${aiLoading ? ' loading' : ''}`;
    aiRow.textContent = aiLoading ? 'AI 生成中…' : '用 AI 自动填写（基于简历）';
    aiRow.addEventListener('mousedown', (e)=> e.preventDefault());
    aiRow.addEventListener('click', ()=> {
      pushLog('info', '点击 AI 建议入口', { aiLoading });
      if (!aiLoading) aiSuggestForTarget();
    });
    suggestList.appendChild(aiRow);

    for (let i=0;i<items.length;i++){
      const it = items[i];
      const row = document.createElement('div');
      row.className = 'item';
      const k = document.createElement('div'); k.className = 'k'; k.textContent = it.key;
      const v = document.createElement('div'); v.className = 'v'; v.textContent = (bucket[it.key]||'').replace(/\s+/g,' ').slice(0, 80);
      row.appendChild(k); row.appendChild(v);
      row.addEventListener('mouseenter', ()=>setActiveIndex(i));
      row.addEventListener('mouseleave', ()=>setActiveIndex(-1));
      row.addEventListener('mousedown', (e)=>{ e.preventDefault(); });
      row.addEventListener('click', ()=>{
        pushLog('info', '点击建议项', { key: it.key });
        applySuggestion(i);
      });
      suggestList.appendChild(row);
    }

    pushLog('info', '更新建议列表', { count: items.length });
  }

  function setActiveIndex(i){
    const children = suggestList.children; // 包含 AI 行
    const max = children.length - 1;
    if (i > max) i = max;
    suggestIndex = i;
    for (let j=0;j<children.length;j++){
      const el = children[j];
      if (el.classList) el.classList.toggle('active', j===i);
    }
  }

  function applySuggestion(i){
    if (i<0 || i>=suggestItems.length) return;
    const key = suggestItems[i].key;
    const val = bucket[key] ?? '';
    if (suggestTarget) fillValue(suggestTarget, val);
    closeSuggest({ suppress: true });
  }

  function closeSuggest(options = {}){
    const { suppress = false } = options;
    if (!suggestBox) return;
    suggestBox.classList.remove('visible');
    if (suggestHost) {
      suggestHost.style.pointerEvents = 'none';
      suggestHost.style.left = '-9999px';
      suggestHost.style.top = '-9999px';
    }
    suggestItems = [];
    suggestIndex = -1;
    if (!aiLoading) {
      suggestTarget = null;
    }
    if (repositionTimer) { cancelAnimationFrame(repositionTimer); repositionTimer = null; }
    if (suppress) {
      suppressSuggestionUntil = Date.now() + 600;
    }
  }

  function scheduleReposition(){
    if (repositionTimer) cancelAnimationFrame(repositionTimer);
    const step = ()=>{
      if (suggestTarget && suggestBox && suggestBox.classList.contains('visible')) {
        placeSuggest(suggestTarget);
        repositionTimer = requestAnimationFrame(step);
      }
    };
    repositionTimer = requestAnimationFrame(step);
  }

  // 事件：在输入框聚焦/输入时触发建议
  window.addEventListener('focusin', (e)=>{
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (host.contains(t)) return; // 忽略面板内部
    if (isTextInput(t)) {
      lastFocusedInput = t;
      pushLog('info', '捕获输入焦点', {
        tag: t.tagName,
        name: t.getAttribute('name') || '',
        id: t.id || '',
        placeholder: t.getAttribute('placeholder') || ''
      });
      if (settings.autoSuggestEnabled) openSuggestFor(t); else closeSuggest();
    } else {
      closeSuggest();
    }
  }, true);

  window.addEventListener('input', (e)=>{
    if (e.target === suggestTarget) {
      updateSuggestList();
      if (suggestItems.length === 0) closeSuggest();
    }
  }, true);

  window.addEventListener('keydown', (e)=>{
    if (!suggestTarget) return;
    // 仅当焦点仍在目标输入框时处理快捷键
    if (document.activeElement !== suggestTarget) return;
    const openKeys = (e.ctrlKey || e.metaKey) && e.key === ' ' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'Down'));
    if (openKeys) {
      if (!settings.autoSuggestEnabled) return;
      openSuggestFor(suggestTarget);
      e.preventDefault();
      return;
    }
    if (suggestBox && suggestBox.classList.contains('visible')) {
      if (e.key === 'ArrowDown' || e.key === 'Down') {
        const total = suggestItems.length + 1; // 包括 AI 行
        const next = (suggestIndex < 0 ? 0 : Math.min(total - 1, suggestIndex + 1));
        setActiveIndex(next);
        e.preventDefault();
      } else if (e.key === 'ArrowUp' || e.key === 'Up') {
        const prev = (suggestIndex <= 0 ? -1 : Math.max(0, suggestIndex - 1));
        setActiveIndex(prev);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        if (suggestIndex === 0) { aiSuggestForTarget(); e.preventDefault(); }
        else if (suggestIndex >= 1) { applySuggestion(suggestIndex-1); e.preventDefault(); }
      } else if (e.key === 'Escape' || e.key === 'Esc') {
        closeSuggest();
        e.preventDefault();
      } else if (e.key === 'Tab') {
        if (suggestIndex === 0) { aiSuggestForTarget(); e.preventDefault(); }
        else if (suggestIndex >= 1) { applySuggestion(suggestIndex-1); e.preventDefault(); }
      }
    }
  }, true);

  // 点击页面其他位置关闭
  window.addEventListener('mousedown', (e)=>{
    // 点击建议框内部不关闭（shadow 内部的事件 target 不同源，这里简单判断位置）
    // 若点击目标不是当前输入框，也不是建议框（无法直接判断），则尝试关闭
    const t = e.target;
    if (t instanceof Node) {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path && path.includes(suggestHost)) {
        pushLog('info', '点击发生在建议浮层内，保持打开');
        return;
      }
      if (path.some((node) => node instanceof HTMLElement && isSelectLike(node))) {
        pushLog('info', '点击下拉控件，关闭建议避免遮挡');
        closeSuggest();
        suppressSuggestionUntil = Date.now() + 800;
        return;
      }
      if (suggestTarget && !suggestTarget.contains(t)) {
        // 粗略关闭，若实际点在建议上，click 选择后也会关闭
        setTimeout(()=>closeSuggest(), 0);
      }
    }
  }, true);

  const STRONG_KEY_PATTERNS = [
    { key: '邮箱', patterns: ['邮箱', 'email', 'e-mail', 'mail'] },
    { key: '手机', patterns: ['手机号', '手机号码', '手机', 'mobile', 'telephone', 'tel', 'phone', '联系电话'] },
    { key: '身份证号', patterns: ['身份证', 'idcard', 'id card', '证件号'] },
    { key: '姓名', patterns: ['姓名', 'name', 'full name', '真实姓名'] }
  ];

  function extractStrongKey(text) {
    if (!text) return null;
    const normalized = text.toLowerCase();
    const hits = STRONG_KEY_PATTERNS.filter((entry) =>
      entry.patterns.some((pattern) => pattern && normalized.includes(pattern))
    );
    if (hits.length === 1) {
      return hits[0].key;
    }
    return null;
  }

  function detectStrongKey(target, attrParts, labelTexts, nearby, typedLower) {
    const candidates = [];
    const pushCandidate = (text) => {
      if (!text) return;
      const normalized = String(text).toLowerCase().trim();
      if (normalized) candidates.push(normalized);
    };

    // 高优先级：显式的输入类型和输入模式
    const typeAttr = target.getAttribute?.('type')?.toLowerCase();
    if (typeAttr === 'email') return '邮箱';
    if (typeAttr === 'tel' || typeAttr === 'phone') return '手机';
    const inputMode = target.getAttribute?.('inputmode')?.toLowerCase();
    if (inputMode === 'email') return '邮箱';
    if (inputMode === 'tel' || inputMode === 'numeric') {
      if (typedLower && typedLower.replace(/[^0-9]/g, '').length >= 7) return '手机';
    }

    if (typedLower) {
      if (typedLower.includes('@')) return '邮箱';
      if (typedLower.replace(/[^0-9]/g, '').length >= 7) return '手机';
    }

    if (Array.isArray(labelTexts) && labelTexts.length) {
      const sortedLabels = [...labelTexts].sort((a, b) => (b.weight || 0) - (a.weight || 0));
      sortedLabels.forEach((entry) => pushCandidate(entry.text));
    }
    if (Array.isArray(nearby) && nearby.length) {
      nearby.forEach((entry) => pushCandidate(entry.text));
    }
    pushCandidate(target.getAttribute?.('placeholder'));
    pushCandidate(target.getAttribute?.('aria-label'));
    pushCandidate(target.getAttribute?.('name'));
    pushCandidate(target.getAttribute?.('id'));
    pushCandidate(attrParts);
    pushCandidate(typedLower);

    for (const text of candidates) {
      const forced = extractStrongKey(text);
      if (forced) return forced;
    }
    return null;
  }

  function resolveQuickFill(target, ctx, typed, maxLength) {
    if (!target) return null;
    const attrParts = [
      ctx || '',
      target.getAttribute?.('name') || '',
      target.getAttribute?.('id') || '',
      target.getAttribute?.('placeholder') || '',
      target.getAttribute?.('title') || '',
      target.getAttribute?.('aria-label') || ''
    ].join(' ').toLowerCase();
    const typedLower = (typed || '').toLowerCase();
    const labelTexts = collectLabelTexts(target);
    const nearby = collectNearbyTexts(target);

    const forcedKey = detectStrongKey(target, attrParts, labelTexts, nearby, typedLower);
    if (forcedKey && bucket[forcedKey] !== undefined) {
      pushLog('info', '快速填充强匹配', { key: forcedKey });
      return {
        key: forcedKey,
        value: bucket[forcedKey],
        reason: `strong:${forcedKey}`,
        message: `已填入“${forcedKey}”`
      };
    }

    const contextSegments = [];
    const pushSegment = (text, weight, source) => {
      if (!text) return;
      const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!normalized) return;
      contextSegments.push({ text: normalized, weight, source });
    };
    pushSegment(attrParts, 6, 'attr');
    pushSegment(typedLower, 6, 'typed');
    pushSegment(ctx ? ctx.toLowerCase() : '', 7, 'context');
    labelTexts.forEach((entry, index) => pushSegment(entry.text.toLowerCase(), entry.weight, entry.source));
    nearby.forEach((entry, index) => pushSegment(entry.text.toLowerCase(), 5 - index, `nearby-${index}`));
    const textByAncestry = [];
    let node = target.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 5) {
      const text = (node.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (text) textByAncestry.push({ text, weight: Math.max(4 - depth, 1), source: `ancestor-${depth}` });
      node = node.parentElement;
      depth += 1;
    }
    textByAncestry.forEach((entry) => pushSegment(entry.text, entry.weight, entry.source));
    const typedDigits = typedLower.replace(/[^0-9]/g, '');
    if (typedDigits.length >= 7) contextSegments.push({ text: 'phone', weight: 10, source: 'typed-digits' });
    const logPreview = contextSegments.slice(0, 6).map((seg) => ({ source: seg.source, snippet: seg.text.slice(0, 80), weight: seg.weight }));
    pushLog('info', '快速填充上下文', {
      segments: logPreview,
      maxLength
    });

    const keywordScore = (keywords) => {
      let total = 0;
      for (const seg of contextSegments) {
        for (const kw of keywords) {
          if (seg.text.includes(kw)) total += seg.weight;
        }
      }
      return total;
    };

    const overrideOrder = [
      { key: '教育-学校', keywords: ['学校名称', '学校', 'school', 'university', 'college', '学院'] },
      { key: '教育-专业', keywords: ['专业', 'major', 'discipline', '方向'] },
      { key: '教育-学历', keywords: ['学历', 'degree', 'education level'] },
      { key: '期望工作地点', keywords: ['期望工作地点', '地点', 'location', 'city'] }
    ];
    for (const override of overrideOrder) {
      const score = keywordScore(override.keywords.map((w) => w.toLowerCase()));
      if (score >= 6 && bucket[override.key] !== undefined) {
        return {
          key: override.key,
          value: bucket[override.key],
          reason: `override:${override.key}:${score.toFixed(2)}`,
          message: `已填入“${override.key}”`
        };
      }
    }
    const mappings = [
      { key: '姓名', keywords: ['姓名', 'name', 'full name', '真实姓名'] },
      { key: '手机', keywords: ['手机号', '手机', 'mobile', 'phone', 'telephone', 'tel', 'phone number'] },
      { key: '邮箱', keywords: ['邮箱', 'email', 'mail'] },
      { key: '求职意向', keywords: ['意向', 'position', '岗位', '职位', 'role'] },
      { key: '到岗时间', keywords: ['到岗', '入职', 'availability', 'start date'] },
      { key: '驻外意愿备注', keywords: ['驻外', '外派', '出差', 'travel'] },
      { key: '身份证号', keywords: ['身份证', 'idcard', '身份证号'] },
      { key: '教育-学校', keywords: ['学校名称', '学校', 'school', 'university', 'college', '学院', '院校', 'campus'] },
      { key: '教育-专业', keywords: ['专业', 'major', 'discipline', '方向', '专业方向'] },
      { key: '教育-学历', keywords: ['学历', 'degree', 'education level', 'education'] },
      { key: '期望工作地点', keywords: ['期望工作地点', '期望地点', 'location preference', 'preferred location', '工作地点', '城市', '期望城市', '愿意去的城市'] }
    ];
    const keywordMap = new Map(mappings.map((m) => [m.key, m.keywords.map((k) => k.toLowerCase())]));
    const scores = mappings.map((mapping) => {
      let totalScore = 0;
      let hits = [];
      for (const segment of contextSegments) {
        for (const kw of mapping.keywords) {
          const idx = segment.text.indexOf(kw);
          if (idx >= 0) {
            const weight = segment.weight * (1 / Math.max(idx + 1, 1));
            totalScore += weight;
            hits.push({ kw, source: segment.source, weight });
          }
        }
      }
      return { key: mapping.key, score: totalScore, hits };
    }).filter((entry) => entry.score > 0);
    if (!scores.length) return null;
    scores.sort((a, b) => b.score - a.score);
    const scoreMap = new Map(scores.map((s) => [s.key, s]));
    const best = scores[0];
    const second = scores[1];
    const bestValue = bucket[best.key];
    const threshold = 0.8;
    if (bestValue && best.score >= threshold && (!second || best.score - second.score >= 0.4)) {
      return {
        key: best.key,
        value: bestValue,
        reason: `score:${best.key}:${best.score.toFixed(2)}`,
        message: `已填入“${best.key}”`
      };
    }

    function scoreForKey(candidateKey) {
      const direct = scoreMap.get(candidateKey);
      if (direct) return direct.score;
      const keywords = keywordMap.get(candidateKey) || [(candidateKey || '').toLowerCase()];
      let accum = 0;
      for (const segment of contextSegments) {
        for (const kw of keywords) {
          if (kw && segment.text.includes(kw)) {
            accum += segment.weight;
          }
        }
      }
      return accum;
    }

    function suggestionFallback(key, reasonPrefix) {
      if (!key) return null;
      const value = bucket[key];
      if (value === undefined) return null;
      const score = scoreForKey(key);
      if (score < 0.5) return null;
      if (second && second.key !== key && score < second.score) return null;
      return { key, value, reason: `${reasonPrefix}:${key}:${score.toFixed(2)}`, message: `已填入“${key}”` };
    }

    const effectiveMax = maxLength || 20;
    if (effectiveMax <= 20) {
      const suggestions = getSuggestionsFor(target) || [];
      if (suggestions.length) {
        const preferredOrder = ['姓名', '手机', '邮箱', '教育-学校'];
        for (const pref of preferredOrder) {
          const hit = suggestions.find((s) => s.key === pref);
          const res = suggestionFallback(hit?.key, 'suggest');
          if (res) return res;
        }
        for (const candidate of suggestions) {
          const res = suggestionFallback(candidate.key, 'suggest-top');
          if (res) return res;
        }
      }
    }
    return null;
  }

  function isSelectLike(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['date','datetime-local','month','week','time','color'].includes(type)) return true;
    }
    if (el.getAttribute && el.getAttribute('role') === 'combobox') return true;
    if (el.classList && Array.from(el.classList).some((cls) => /select|dropdown|combobox|picker/i.test(cls))) return true;
    return false;
  }

  async function aiSuggestForTarget(){
    if (!suggestTarget || aiLoading) {
      const fallback = lastFocusedInput && isTextInput(lastFocusedInput) ? lastFocusedInput : null;
      if (fallback && !aiLoading) {
        suggestTarget = fallback;
      } else {
        pushLog('warn', 'AI 请求被忽略', {
          hasTarget: Boolean(suggestTarget),
          fallback: Boolean(fallback),
          aiLoading
        });
        if (!fallback) {
          setAiStatus('请先点击网页中的输入框，再使用 AI。', 'warn', 3200);
        }
        return;
      }
    }
    const currentApiKey = apiKeyInput?.value?.trim();
    if (!currentApiKey) {
      setAiStatus('请先在面板底部保存阿里云百炼 API Key。', 'warn', 3500);
      pushLog('warn', 'AI 请求被阻止：缺少 API Key');
      return;
    }
    const target = suggestTarget || (lastFocusedInput && isTextInput(lastFocusedInput) ? lastFocusedInput : null);
    if (!target) {
      pushLog('warn', 'AI 请求终止：无有效目标');
      setAiStatus('找不到可填写的输入框，请先点击页面上的输入区域。', 'warn', 3200);
      return;
    }
    suggestTarget = target;
    const ctx = buildContext(target);
    const typed = getElementCurrentText(target);
    const maxLength = deriveMaxLength(target, ctx);
    const hints = buildFieldHints(target, ctx, typed, maxLength);
    const quickResult = resolveQuickFill(target, ctx, typed, maxLength);
    if (quickResult) {
      fillValue(target, quickResult.value ?? '');
      closeSuggest({ suppress: true });
      setAiStatus(quickResult.message || '已填入匹配内容。', 'success', 2200);
      pushLog('info', 'AI 快速填充命中', quickResult);
      return;
    }
    setAiStatus('AI 正在生成…', 'loading');
    pushLog('info', 'AI 请求开始', {
      fieldContext: ctx ? ctx.slice(0, 200) : '',
      typedPreview: typed ? typed.slice(0, 200) : '',
      maxLength
    });
    aiLoading = true;
    updateSuggestList();
    try {
      const rsp = await sendRuntimeMessage({
        type: 'AI_SUGGEST_FIELD',
        fieldContext: ctx,
        typed,
        constraints: { maxLength },
        hints
      });
      aiLoading = false;
      updateSuggestList();
      if (rsp && rsp.ok && rsp.text) {
        setAiStatus('AI 填写完成', 'success', 2000);
        pushLog('success', 'AI 请求成功', {
          durationMs: rsp?.durationMs,
          resultPreview: String(rsp.text).slice(0, 200)
        });
        // 将 AI 结果插入到列表最前，作为一个可选项
        const aiText = String(rsp.text).trim();
        if (aiText) {
          // 直接应用，也可以改为插入建议项供选择
          fillValue(target, aiText);
          closeSuggest();
        } else {
          alert('AI 未返回可用结果');
        }
      } else {
        const errMsg = rsp?.error || '未知错误';
        setAiStatus('AI 生成失败：' + errMsg, 'error', 4000);
        alert('AI 生成失败：' + errMsg);
        pushLog('error', 'AI 请求失败', errMsg);
      }
    } catch (e) {
      aiLoading = false;
      updateSuggestList();
      const errMsg = e?.message || String(e);
      setAiStatus('AI 生成异常：' + errMsg, 'error', 4000);
      alert('AI 生成异常：' + errMsg);
      pushLog('error', 'AI 请求异常', errMsg);
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            const error = new Error(err.message || '消息发送失败');
            pushLog('error', '消息发送失败', error.message);
            if (/Extension context invalidated/i.test(error.message)) {
              setAiStatus('扩展已更新或重载，请刷新页面后再试。', 'warn', 5000);
            }
            reject(error);
          } else {
            if (response === undefined) {
              const warnMsg = '后台响应为空（可能 service worker 已重启），请刷新页面。';
              pushLog('warn', warnMsg, message);
              setAiStatus('后台无响应，请刷新页面后重试。', 'warn', 4000);
              reject(new Error('后台未响应'));
            } else {
              resolve(response);
            }
          }
        });
      } catch (error) {
        pushLog('error', '消息发送异常', error?.message || error);
        if (error && /Extension context invalidated/i.test(String(error.message))) {
          setAiStatus('扩展已更新或重载，请刷新页面后再试。', 'warn', 5000);
        }
        reject(error);
      }
    });
  }
})();
