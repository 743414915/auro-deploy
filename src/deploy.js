const path = require('path');
const fs = require('fs-extra');
const archiver = require('archiver');
const chalk = require('chalk');
const ora = require('ora');
const { SSHClient } = require('./ssh');
const { getBuildDir } = require('./git');

function formatDateTime() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function compress(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(sourceDir)) {
      reject(new Error(`压缩源目录不存在: ${sourceDir}`));
      return;
    }
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('tar', { gzip: true });

    output.on('close', () => resolve(archive.pointer()));
    output.on('error', (err) => reject(new Error(`写入压缩文件失败: ${err.message}`)));
    archive.on('error', (err) => reject(new Error(`压缩失败: ${err.message}`)));
    archive.on('warning', (warn) => console.log(`  [压缩警告] ${warn.message || warn}`));
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function run(config, commitInfo) {
  const { deploy: deployCfg } = config;
  const version = `v${formatDateTime()}_${commitInfo.hash}`;
  const buildDir = getBuildDir(config);
  const localArchive = path.resolve(config.git.cloneDir, '..', `deploy_${version}.tar.gz`);
  const remoteArchive = `/tmp/deploy_${version}.tar.gz`;
  const remotePathQ = `"${deployCfg.remotePath}"`;
  const spinner = ora();

  // 0. 部署前文件覆盖
  if (deployCfg.preDeployFiles && deployCfg.preDeployFiles.length > 0) {
    for (const f of deployCfg.preDeployFiles) {
      if (!f.path) continue;
      const targetFile = path.resolve(buildDir, f.path);
      fs.ensureDirSync(path.dirname(targetFile));
      fs.writeFileSync(targetFile, f.content || '', 'utf8');
      console.log(chalk.gray(`  已覆盖文件: ${f.path}`));
    }
  }

  // 1. 压缩构建产物
  spinner.start(chalk.blue('压缩构建产物...'));
  const size = await compress(buildDir, localArchive);
  spinner.succeed(chalk.green(`压缩完成 (${(size / 1024 / 1024).toFixed(2)} MB)`));

  // 2. 连接服务器
  spinner.start(chalk.blue('连接生产服务器...'));
  const ssh = new SSHClient(config);
  await ssh.connect();
  spinner.succeed();

  try {
    // 3. 备份旧文件（首次部署跳过）
    spinner.start(chalk.blue('备份旧文件...'));
    const backupFile = `${remotePathQ}/.backup/${version}.tar.gz`;
    const hasFiles = await ssh.exec(
      `ls -A ${remotePathQ} | grep -v '^\\.backup$' | head -1 || echo "EMPTY"`
    );
    if (!hasFiles.includes('EMPTY')) {
      await ssh.exec(`mkdir -p ${remotePathQ}/.backup`);
      await ssh.exec(
        `tar -czf ${backupFile} --exclude=.backup -C ${remotePathQ} .`
      );
      spinner.succeed(chalk.green(`备份完成: ${version}.tar.gz`));
    } else {
      spinner.succeed(chalk.gray('远程目录为空，跳过备份'));
    }

    // 4. 上传压缩包
    spinner.start(chalk.blue('上传构建产物...'));
    await ssh.uploadFile(localArchive, remoteArchive);
    spinner.succeed(chalk.green('上传完成'));

    // 5. 执行部署前命令
    if (deployCfg.preDeployCommands.length > 0) {
      spinner.start(chalk.blue('执行部署前命令...'));
      for (const cmd of deployCfg.preDeployCommands) {
        await ssh.exec(cmd);
      }
      spinner.succeed();
    }

    // 6. 解压到目标路径（覆盖旧文件，.backup 由 glob 保护）
    spinner.start(chalk.blue('部署文件...'));
    await ssh.exec(`rm -rf ${remotePathQ}/*`);
    await ssh.exec(`tar -xzf ${remoteArchive} -C ${remotePathQ}`);
    await ssh.exec(`rm -f ${remoteArchive}`);
    spinner.succeed(chalk.green('部署完成'));

    // 7. 执行部署后命令
    if (deployCfg.postDeployCommands.length > 0) {
      spinner.start(chalk.blue('执行部署后命令...'));
      for (const cmd of deployCfg.postDeployCommands) {
        await ssh.exec(cmd);
      }
      spinner.succeed();
    }

    // 8. 清理旧备份
    spinner.start(chalk.blue('清理旧备份...'));
    const listResult = await ssh.exec(`ls -1 ${remotePathQ}/.backup/ | sort -r`);
    const backups = listResult.split('\n').filter(Boolean);
    if (backups.length > deployCfg.backupKeep) {
      const toRemove = backups.slice(deployCfg.backupKeep);
      for (const f of toRemove) {
        await ssh.exec(`rm -f ${remotePathQ}/.backup/${f}`);
      }
      console.log(chalk.gray(`  清理了 ${toRemove.length} 个旧备份`));
    }
    spinner.succeed(chalk.green(`保留最近 ${deployCfg.backupKeep} 个备份`));

  } finally {
    ssh.disconnect();
    // 清理本地压缩包
    fs.removeSync(localArchive);
  }

  console.log('');
  console.log(chalk.green.bold('══════════════════════════════════════'));
  console.log(chalk.green.bold('  ✓ 部署成功!'));
  console.log(chalk.green.bold('══════════════════════════════════════'));
  console.log('');
  console.log(chalk.cyan(`  版本:     ${version}`));
  console.log(chalk.cyan(`  提交:     ${commitInfo.hash} - ${commitInfo.message}`));
  console.log(chalk.cyan(`  分支:     ${commitInfo.branch}`));
  console.log(chalk.cyan(`  远程路径: ${deployCfg.remotePath}`));
  console.log('');
}

module.exports = { run, formatDateTime };
