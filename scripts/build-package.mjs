/**
 * 生产部署包构建脚本（零依赖，Node 原生实现）。
 *
 * 用法：
 *   node scripts/build-package.mjs
 *   node scripts/build-package.mjs --keep-dist   # 保留解包后的暂存目录
 *
 * 产物（输出到 dist/）：
 *   kanban-pulse-<version>/          暂存目录（--keep-dist 时保留）
 *   kanban-pulse-<version>.tar.gz    Linux 服务器部署包
 *   kanban-pulse-<version>.zip       Windows 部署包
 *   SHA256SUMS.txt                   完整性校验清单
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const keepDist = process.argv.includes('--keep-dist');

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `kanban-pulse-${version}`;
const staging = path.join(distDir, name);

/** 打包内容清单：只包含运行与部署所需文件 */
const INCLUDE_FILES = [
  'package.json',
  'README.md',
  'Dockerfile',
  'docker-compose.yml',
  '.dockerignore',
  '.gitignore',
  '.env.example',
  '.env.production.example',
];
const INCLUDE_DIRS = ['server', 'public', 'deploy', 'docs'];
const INCLUDE_SCRIPTS = ['scripts/reset.js', 'scripts/clear.js', 'scripts/backup.mjs', 'scripts/restore.mjs'];

function copyIncluded() {
  for (const file of INCLUDE_FILES) {
    const src = path.join(root, file);
    if (existsSync(src)) cpSync(src, path.join(staging, file));
  }
  for (const dir of INCLUDE_DIRS) {
    const src = path.join(root, dir);
    if (!existsSync(src)) throw new Error(`缺少目录 ${dir}`);
    cpSync(src, path.join(staging, dir), { recursive: true });
  }
  mkdirSync(path.join(staging, 'scripts'), { recursive: true });
  for (const file of INCLUDE_SCRIPTS) {
    const src = path.join(root, file);
    if (!existsSync(src)) throw new Error(`缺少脚本 ${file}`);
    cpSync(src, path.join(staging, file));
  }
  // 预创建空数据目录，保证挂载点存在
  mkdirSync(path.join(staging, 'data'), { recursive: true });
  writeFileSync(path.join(staging, 'data', '.gitkeep'), '');
}

function dirStats(dir) {
  let count = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = dirStats(full);
      count += sub.count;
      bytes += sub.bytes;
    } else {
      count += 1;
      bytes += statSync(full).size;
    }
  }
  return { count, bytes };
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function run(cmd, args, { cwd } = {}) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'pipe', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} 失败: ${result.stderr?.toString().trim() || result.error?.message}`);
  }
}

function makeArchives() {
  const outputs = [];
  // Linux 部署包：用相对路径 + cwd，避免 Windows 下 GNU tar 把 "D:" 当远程主机
  const tgz = `${name}.tar.gz`;
  run('tar', ['-czf', tgz, name], { cwd: distDir });
  outputs.push(path.join(distDir, tgz));

  // Windows 部署包：优先系统自带 bsdtar（生成标准 zip，路径分隔符兼容 Linux），
  // 其次 PowerShell Compress-Archive，最后 zip 命令
  const zip = path.join(distDir, `${name}.zip`);
  let zipped = false;
  if (process.platform === 'win32') {
    const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(bsdtar)) {
      try {
        run(bsdtar, ['-a', '-cf', zip, name], { cwd: distDir });
        zipped = true;
      } catch (error) {
        console.warn(`[警告] bsdtar 生成 zip 失败: ${error.message}`);
      }
    }
    if (!zipped) {
      const result = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Compress-Archive -Path '${staging.replace(/\//g, '\\')}\\*' -DestinationPath '${zip.replace(/\//g, '\\')}' -Force`,
        ],
        { stdio: 'pipe' },
      );
      zipped = result.status === 0;
      if (!zipped) console.warn(`[警告] PowerShell 压缩失败: ${result.stderr?.toString().trim()}`);
    }
  } else {
    const result = spawnSync('zip', ['-rq', `../${name}.zip`, '.'], { cwd: staging, stdio: 'pipe' });
    zipped = result.status === 0;
  }
  if (zipped && existsSync(zip)) outputs.push(zip);
  else console.warn('[警告] 未能生成 zip 包（不影响 tar.gz 使用）');

  return outputs;
}

function main() {
  console.log(`构建生产部署包 v${version} ...`);
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  copyIncluded();

  const { count, bytes } = dirStats(staging);
  writeFileSync(
    path.join(staging, 'BUILD_INFO.txt'),
    [
      `产品: kanban-pulse (Pulse 看板)`,
      `版本: ${version}`,
      `构建时间: ${new Date().toISOString()}`,
      `构建机 Node: ${process.version}`,
      `文件数: ${count}`,
      `原始大小: ${(bytes / 1024).toFixed(1)} KB`,
      ``,
      `运行要求: Node.js >= 20（零 npm 依赖，无需 npm install）`,
      `快速启动: npm start  （或阅读 docs/DEPLOYMENT.md）`,
      ``,
      `完整性校验见同级 SHA256SUMS.txt`,
    ].join('\n'),
    'utf8',
  );

  const outputs = makeArchives();

  const lines = outputs.map((file) => `${sha256(file)}  ${path.basename(file)}`);
  writeFileSync(path.join(distDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');

  console.log('');
  for (const file of outputs) {
    const size = (statSync(file).size / 1024).toFixed(1);
    console.log(`  ${path.basename(file)}  ${size} KB`);
  }
  console.log(`  SHA256SUMS.txt`);
  if (!keepDist) rmSync(staging, { recursive: true, force: true });
  console.log(`\n完成。产物目录: ${distDir}`);
}

main();
