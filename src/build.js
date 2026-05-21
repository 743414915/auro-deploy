const { spawn } = require('child_process');
const path = require('path');

function run(config, onLog) {
  const { cloneDir } = config.git;
  const { command, outputDir } = config.build;

  const buildOutput = path.resolve(cloneDir, outputDir);
  const log = onLog || console.log;

  log('▶ 执行构建...');
  log(`  命令: ${command}`);
  log(`  目录: ${cloneDir}`);

  return new Promise((resolve, reject) => {
    // Parse command into shell-executable form
    const child = spawn(command, {
      cwd: cloneDir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    child.stdout.on('data', (d) => {
      const text = d.toString();
      log(text);
    });

    child.stderr.on('data', (d) => {
      const text = d.toString();
      log(text);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`构建失败: 退出码 ${code}`));
        return;
      }

      if (!require('fs-extra').existsSync(buildOutput)) {
        reject(new Error(`构建产物目录不存在: ${buildOutput}`));
        return;
      }

      const files = require('fs-extra').readdirSync(buildOutput);
      if (files.length === 0) {
        reject(new Error('构建产物目录为空'));
        return;
      }

      log(`  ✓ 构建完成，产物: ${buildOutput} (${files.length} 个文件)`);
      resolve();
    });

    child.on('error', (err) => {
      reject(new Error(`无法执行构建命令: ${err.message}`));
    });
  });
}

module.exports = { run };
