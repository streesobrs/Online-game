// 数据迁移脚本：将users目录迁移到accounts目录
const fs = require('fs').promises;
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const usersDir = path.join(dataDir, 'users');
const accountsDir = path.join(dataDir, 'accounts');

async function migrate() {
  try {
    console.log('=== 开始数据迁移 ===');
    
    // 检查users目录是否存在
    try {
      await fs.access(usersDir);
    } catch (err) {
      console.log('users目录不存在，无需迁移');
      return;
    }

    // 创建accounts目录
    await fs.mkdir(accountsDir, { recursive: true });

    // 读取users目录中的所有文件
    const files = await fs.readdir(usersDir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.backup'));

    console.log(`找到 ${jsonFiles.length} 个用户文件需要迁移`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const file of jsonFiles) {
      try {
        const srcPath = path.join(usersDir, file);
        const destPath = path.join(accountsDir, file);

        // 检查目标文件是否已存在
        try {
          await fs.access(destPath);
          console.log(`跳过 ${file} - 目标文件已存在`);
          skippedCount++;
          continue;
        } catch (err) {
          // 文件不存在，继续迁移
        }

        // 读取源文件
        const data = await fs.readFile(srcPath, 'utf8');
        const account = JSON.parse(data);

        // 确保account结构正确（移除冗余的userId字段）
        if (account.userId && !account.id) {
          account.id = account.userId;
        }
        if (account.account && !account.account.id && account.id) {
          account.account.id = account.id;
        }

        // 写入目标文件
        await fs.writeFile(destPath, JSON.stringify(account, null, 2), 'utf8');
        migratedCount++;

      } catch (err) {
        console.error(`迁移 ${file} 失败: ${err.message}`);
      }
    }

    console.log(`=== 迁移完成 ===`);
    console.log(`迁移成功: ${migratedCount} 个文件`);
    console.log(`跳过（已存在）: ${skippedCount} 个文件`);

    // 询问是否删除旧的users目录
    console.log('');
    console.log('迁移完成！建议在确认数据完整性后手动删除旧的users目录。');

  } catch (err) {
    console.error('迁移过程发生错误:', err.message);
    process.exit(1);
  }
}

// 运行迁移
migrate();
