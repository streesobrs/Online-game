const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const htmlPath = path.join(__dirname, 'index.html');
const tempJsPath = path.join(__dirname, 'temp-script.js');

const content = fs.readFileSync(htmlPath, 'utf8');

// 查找<script>标签
const scriptStart = content.indexOf('<script>');
const scriptEnd = content.lastIndexOf('</script>');

if (scriptStart === -1 || scriptEnd === -1) {
  console.error('未找到<script>标签');
  process.exit(1);
}

const scriptContent = content.substring(scriptStart + '<script>'.length, scriptEnd);

// 写入临时JS文件
fs.writeFileSync(tempJsPath, scriptContent, 'utf8');

console.log('正在用Node.js检查语法...');

try {
  // 使用node --check来检查语法
  execSync(`node --check "${tempJsPath}"`, { stdio: 'inherit' });
  console.log('✅ JavaScript语法检查通过！');
} catch (e) {
  console.log('❌ JavaScript语法检查失败！');
} finally {
  // 清理临时文件
  fs.unlinkSync(tempJsPath);
}