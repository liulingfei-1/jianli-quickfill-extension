// 中文界面脚本：管理键值对（bucket），并与内容脚本通信以填充网页输入框

const STORAGE_KEY = 'bucket';
const keyInput = document.getElementById('keyInput');
const valueInput = document.getElementById('valueInput');
const saveBtn = document.getElementById('saveBtn');
const clearFormBtn = document.getElementById('clearFormBtn');
const keysContainer = document.getElementById('keysContainer');
const searchInput = document.getElementById('searchInput');
const exportBtn = document.getElementById('exportBtn');
const importInput = document.getElementById('importInput');
const clearAllBtn = document.getElementById('clearAllBtn');
const emptyState = document.getElementById('emptyState');
const emptyStateTitle = emptyState?.querySelector('h3');
const emptyStateText = emptyState?.querySelector('p');
const keyCountValue = document.getElementById('keyCountValue');

const PREVIEW_LIMIT = 90;

let bucket = {}; // 本地缓存，加载后与 storage 同步
let editingOriginalKey = null; // 若在编辑，记录原始 key

function loadBucket() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
      bucket = res[STORAGE_KEY] || {};
      resolve(bucket);
    });
  });
}

function saveBucket(newBucket) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: newBucket }, resolve);
  });
}

function formatPreview(value) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '（无内容）';
  if (normalized.length <= PREVIEW_LIMIT) return normalized;
  return normalized.slice(0, PREVIEW_LIMIT) + '…';
}

function updateKeyCount(total) {
  if (keyCountValue) {
    keyCountValue.textContent = String(total);
  }
}

function updateEmptyState(totalKeys, visibleKeys, hasQuery) {
  if (!emptyState) return;
  if (visibleKeys === 0) {
    emptyState.hidden = false;
    if (totalKeys === 0) {
      if (emptyStateTitle) emptyStateTitle.textContent = '还没有保存任何键值';
      if (emptyStateText) emptyStateText.textContent = '先在上方录入常用信息，或通过导入按钮加载已有 JSON 数据。';
    } else if (hasQuery) {
      if (emptyStateTitle) emptyStateTitle.textContent = '没有匹配的键值';
      if (emptyStateText) emptyStateText.textContent = '换个关键词试试，或清空搜索条件查看全部列表。';
    } else {
      if (emptyStateTitle) emptyStateTitle.textContent = '没有可显示的键值';
      if (emptyStateText) emptyStateText.textContent = '尝试刷新或重新导入数据。';
    }
  } else {
    emptyState.hidden = true;
  }
}

function renderList() {
  const query = (searchInput.value || '').trim().toLowerCase();
  const keys = Object.keys(bucket).sort((a, b) => a.localeCompare(b));
  updateKeyCount(keys.length);
  keysContainer.innerHTML = '';

  let visibleCount = 0;
  for (const k of keys) {
    const value = bucket[k] ?? '';
    const matchText = `${k}\n${value}`.toLowerCase();
    if (query && !matchText.includes(query)) continue;
    visibleCount += 1;

    const item = document.createElement('article');
    item.className = 'key-item';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'key-btn';
    trigger.title = '点击将值填入当前页面的输入框';
    trigger.addEventListener('click', () => fillIntoActiveField(value));

    const title = document.createElement('span');
    title.className = 'key-btn__title';
    title.textContent = k;

    const preview = document.createElement('span');
    preview.className = 'key-btn__preview';
    preview.textContent = formatPreview(value);

    trigger.append(title, preview);

    const actions = document.createElement('div');
    actions.className = 'key-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'small secondary';
    edit.textContent = '编辑';
    edit.title = '编辑此键值';
    edit.addEventListener('click', () => beginEdit(k));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'small delete';
    del.textContent = '删除';
    del.title = '删除此键值';
    del.addEventListener('click', () => deleteKey(k));

    actions.append(edit, del);
    item.append(trigger, actions);
    keysContainer.appendChild(item);
  }

  updateEmptyState(keys.length, visibleCount, Boolean(query));
}

async function beginEdit(k) {
  editingOriginalKey = k;
  if (keyInput) keyInput.value = k;
  if (valueInput) valueInput.value = bucket[k] ?? '';
  keyInput?.focus();
}

async function deleteKey(k) {
  if (!confirm(`确定删除“${k}”吗？`)) return;
  delete bucket[k];
  await saveBucket(bucket);
  if (editingOriginalKey === k) {
    editingOriginalKey = null;
    if (keyInput) keyInput.value = '';
    if (valueInput) valueInput.value = '';
  }
  renderList();
}

async function onSave() {
  const rawKey = keyInput ? keyInput.value : '';
  const v = valueInput ? valueInput.value : '';
  const k = rawKey.trim();
  if (!k) {
    alert('请填写键（名称）。');
    keyInput?.focus();
    return;
  }
  if (editingOriginalKey && editingOriginalKey !== k) {
    delete bucket[editingOriginalKey];
  }
  bucket[k] = v;
  await saveBucket(bucket);
  editingOriginalKey = null;
  if (keyInput) keyInput.value = '';
  if (valueInput) valueInput.value = '';
  renderList();
}

function clearForm() {
  editingOriginalKey = null;
  if (keyInput) keyInput.value = '';
  if (valueInput) valueInput.value = '';
  keyInput?.focus();
}

async function fillIntoActiveField(text) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'FILL_TEXT', text });
    window.close();
  } catch (e) {
    alert('当前页面无法填充，或未聚焦到可输入的元素。');
  }
}

function onExport() {
  const data = JSON.stringify(bucket, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bucket.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function onImport(file) {
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('格式错误');
    bucket = { ...bucket, ...obj };
    await saveBucket(bucket);
    renderList();
  } catch (e) {
    alert('导入失败：' + (e?.message || '未知错误'));
  } finally {
    if (importInput) importInput.value = '';
  }
}

async function onClearAll() {
  if (!confirm('确定清空全部键值吗？此操作不可撤销。')) return;
  bucket = {};
  await saveBucket(bucket);
  renderList();
}

saveBtn?.addEventListener('click', onSave);
clearFormBtn?.addEventListener('click', clearForm);
searchInput?.addEventListener('input', renderList);
exportBtn?.addEventListener('click', onExport);
importInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) onImport(file);
});
clearAllBtn?.addEventListener('click', onClearAll);

(async function init() {
  await loadBucket();
  renderList();
})();
