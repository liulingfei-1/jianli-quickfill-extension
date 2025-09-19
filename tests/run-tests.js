import { readFileSync, accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectFile(relativePath) {
  const filePath = resolve(process.cwd(), relativePath);
  accessSync(filePath, constants.F_OK);
  return filePath;
}

try {
  const manifestPath = expectFile('manifest.json');
  const manifestRaw = readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    throw new Error('manifest.json 不是有效的 JSON: ' + err.message);
  }
  assert(manifest.manifest_version === 3, 'manifest_version 必须为 3');
  assert(manifest.action?.default_popup, 'manifest.json 缺少 action.default_popup');
  assert(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0, 'manifest.json 缺少 content_scripts 定义');
  assert(manifest.background?.service_worker, 'manifest.json 缺少 background.service_worker');

  const popupHtmlPath = expectFile(manifest.action.default_popup);
  const popupHtml = readFileSync(popupHtmlPath, 'utf8');
  const requiredIds = ['keyInput', 'valueInput', 'saveBtn', 'clearFormBtn', 'keysContainer', 'searchInput'];
  for (const id of requiredIds) {
    const pattern = new RegExp(`id=["']${id}["']`);
    assert(pattern.test(popupHtml), `popup.html 缺少 id="${id}" 元素`);
  }

  const popupJsPath = expectFile('popup.js');
  const popupJs = readFileSync(popupJsPath, 'utf8');
  assert(/fillIntoActiveField/.test(popupJs), 'popup.js 缺少 fillIntoActiveField 定义');

  const contentScriptPath = expectFile('contentScript.js');
  const contentScript = readFileSync(contentScriptPath, 'utf8');
  assert(/resume-bucket-overlay-host/.test(contentScript), 'contentScript.js 未包含悬浮面板 host id');
  assert(/setAiStatus/.test(contentScript), 'contentScript.js 缺少 setAiStatus 函数');

  const backgroundPath = expectFile('background.js');
  const backgroundJs = readFileSync(backgroundPath, 'utf8');
  assert(/DEFAULT_BUCKET/.test(backgroundJs), 'background.js 缺少 DEFAULT_BUCKET 定义');

  console.log('✅ 自检通过：关键文件与标记均存在。');
} catch (err) {
  console.error('❌ 自检失败:', err.message);
  process.exitCode = 1;
}
