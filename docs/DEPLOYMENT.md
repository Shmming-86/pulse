# Pulse 看板 · 部署与运维手册

> 适用版本：v1.9.0 ｜ 更新日期：2026-10-30
>
> Pulse 看板是一个面向小团队（5~20 人）的任务跟踪与效能分析系统，对标 JIRA / Plane 的核心能力：看板拖拽、任务键、类型/优先级/难易程度、成员负载、累计流图与吞吐分析、**看板列自定义**。**零 npm 依赖**（SQLite 使用 Node 内置 `node:sqlite`），单进程 Node.js 即可运行，非常适合内网服务器、云主机或 NAS 部署。

```
┌────────────┐     HTTP      ┌─────────────────────────────┐
│  浏览器     │ ───────────▶ │  Node.js 单进程服务          │
│  (SPA)     │ ◀─────────── │  ├─ 静态资源 public/         │
└────────────┘               │  ├─ REST API  /api/*        │
                             │  └─ SQLite 持久化 (WAL) data/│
                             └─────────────────────────────┘
```

---

## 1. 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | **≥ 22.5**（推荐 22 LTS，内置 `node:sqlite`），**无需 npm install** |
| 操作系统 | Linux / Windows / macOS 均可；Docker 部署任意支持 Docker 的系统 |
| 内存 | 128 MB 起步，推荐 512 MB |
| 磁盘 | 程序约 1 MB；数据随任务量增长，小团队一年通常 < 10 MB |
| 端口 | 默认 4173（可配置） |

---

## 2. 部署包内容

```
kanban-pulse-1.0.0/
├── package.json               # 启动脚本入口
├── server/                    # 后端源码（Node 原生 http，零依赖）
├── public/                    # 前端静态资源
├── scripts/
│   ├── reset.js               # 恢复出厂演示数据
│   ├── backup.mjs             # 数据备份（gzip，自动滚动清理）
│   └── restore.mjs            # 数据恢复
├── deploy/
│   ├── kanban-pulse.service   # systemd 服务单元
│   ├── nginx.conf             # Nginx 反向代理示例（含 HTTPS 模板）
│   ├── pm2.config.cjs         # PM2 进程配置
│   └── start.bat              # Windows 一键启动
├── docs/
│   ├── DEPLOYMENT.md          # 本手册
│   └── USER-GUIDE.md          # 产品使用说明
├── Dockerfile / docker-compose.yml / .dockerignore
├── .env.example               # 开发配置模板
├── .env.production.example    # 生产配置模板（含全部配置项说明）
├── data/                      # 空数据目录（运行时生成 kanban.db）
├── BUILD_INFO.txt             # 构建信息
└── README.md
```

---

## 3. 部署方式一：Docker Compose（推荐）

最省心的方式，自带健康检查、日志滚动、数据卷。

```bash
# 1. 解压部署包
tar -xzf kanban-pulse-1.0.0.tar.gz && cd kanban-pulse-1.0.0

# 2. 构建并启动（后台运行）
docker compose up -d --build

# 3. 验证
curl http://127.0.0.1:4173/api/health
# {"data":{"status":"ok","version":"1.0.0",...}}
```

常用运维命令：

```bash
docker compose logs -f kanban     # 跟踪日志
docker compose restart kanban     # 重启
docker compose down               # 停止（数据保留）
docker compose up -d --build      # 升级后重建（数据保留）
```

数据保存在 Docker 卷 `kanban-data` 中；如需与宿主机目录绑定，把 `docker-compose.yml` 中的 `volumes` 改为：

```yaml
    volumes:
      - /opt/kanban-data:/app/data
```

> 注意：宿主机目录方式需保证目录可被容器内 `node` 用户（uid 1000）写入：`chown -R 1000:1000 /opt/kanban-data`。

---

## 4. 部署方式二：systemd（Linux 裸机）

适合直接跑在云主机上，配合 Nginx 反代。

```bash
# 1. 创建运行用户与目录
sudo useradd -r -s /usr/sbin/nologin kanban
sudo mkdir -p /opt/kanban-pulse
sudo tar -xzf kanban-pulse-1.0.0.tar.gz -C /opt/kanban-pulse --strip-components=1
cd /opt/kanban-pulse

# 2. （可选）生成配置
cp .env.production.example .env && vi .env

# 3. 权限
sudo chown -R kanban:kanban /opt/kanban-pulse

# 4. 安装并启动服务
sudo cp deploy/kanban-pulse.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kanban-pulse

# 5. 验证
systemctl status kanban-pulse
curl http://127.0.0.1:4173/api/health
```

常用命令：

```bash
journalctl -u kanban-pulse -f          # 跟踪日志
sudo systemctl restart kanban-pulse    # 重启
```

> 如果 Node 不在 `/usr/bin/node`，修改 service 文件中 `ExecStart=` 的路径（`which node` 查询）。

---

## 5. 部署方式三：Windows 服务器 / PM2

**Windows 一键启动**：双击 `deploy\start.bat`，会自动设置生产环境变量、打开浏览器并启动服务。停止方式：在窗口按 `Ctrl+C`。适合临时或轻量场景；长期运行建议用任务计划程序开机自启。

**PM2 托管（Linux/Windows 通用）**：

```bash
npm install -g pm2        # 仅 PM2 自身需要安装
pm2 start deploy/pm2.config.cjs
pm2 save && pm2 startup   # 开机自启
pm2 logs kanban-pulse
```

> ⚠️ 应用为单进程 SQLite（WAL 模式）存储，**必须单实例**，禁止 cluster 模式。

---

## 6. 配置项一览

通过环境变量或 `.env` 文件配置（完整说明见 `.env.production.example`）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | development | 生产必须为 `production` |
| `HOST` | 127.0.0.1 | 监听地址；容器/局域网访问用 `0.0.0.0` |
| `PORT` | 4173 | 监听端口 |
| `DATA_DIR` | ./data | 数据目录（kanban.db 所在位置） |
| `DB_FILE` | kanban.db | SQLite 数据库文件名（位于 DATA_DIR 下） |
| `LEGACY_JSON_FILE` | db.json | 旧版 JSON 数据文件名；首启时若存在且库为空，自动迁移到 SQLite |
| `SEED_MODE` | 生产 `empty` / 开发 `demo` | 首次启动数据：`empty`=空库（一名管理员）；`demo`=32 条演示任务。仅数据库为空时生效 |
| `CORS_ORIGINS` | localhost:4173 | 允许的跨域来源，逗号分隔；生产禁止 `*` |
| `TRUST_PROXY` | false | 在 Nginx 等反代之后设为 `true`（限流按真实 IP）；直接暴露必须为 `false` |
| `RATE_LIMIT_MAX` | 600 | 每 IP 每分钟请求上限 |
| `BODY_LIMIT_BYTES` | 262144 | 请求体上限（字节） |
| `REQUEST_TIMEOUT_MS` | 30000 | 请求处理超时 |
| `LOG_LEVEL` | info | debug / info / warn / error |

配置校验失败会**快速失败**：启动时直接打印问题并退出（exit 1），不会带病运行。

---

## 7. Nginx 反向代理与 HTTPS

复制 `deploy/nginx.conf` 到 `/etc/nginx/conf.d/kanban.conf`，修改 `server_name` 后：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

要点：
- **TRUST_PROXY**：走 Nginx 后把应用端 `TRUST_PROXY=true`，限流才会按真实客户端 IP 计数
- **CORS_ORIGINS**：同源代理场景下保持默认即可；跨域名访问时填站点地址
- **HTTPS**：配置文件内附 443 + HTTP 跳转的注释模板，取消注释并填入证书路径即可
- Nginx 已开启 gzip；应用未压缩是为了让网关统一处理

---

## 8. 首次启动验证清单

```bash
# 1. 进程健康
curl http://127.0.0.1:4173/api/health
# 期望: {"data":{"status":"ok","version":"1.0.0","env":"production",...}}

# 2. 首屏数据
curl http://127.0.0.1:4173/api/bootstrap | head -c 200
# 期望: {"data":{"project":{...},"members":[...],...}}

# 3. 前端页面
# 浏览器打开 http://<服务器IP>:4173 ，应看到看板界面

# 4. 写入链路（任选）
# 页面上点「新建任务」创建一条任务并拖动到「进行中」
```

生产空库模式首次启动只有一名「管理员」成员：请先进入 **团队** 页完善自己的姓名/角色，再开始建任务。

---

## 9. 数据管理

所有业务数据保存在 `DATA_DIR/kanban.db`（SQLite，WAL 模式，`synchronous=NORMAL` + 每分钟自动 checkpoint，停机时完整 checkpoint 并关闭）。写操作全部走事务，断电不会损坏主库；崩溃后重启会自动通过 `-wal` 文件恢复。

**备份**（服务运行中可直接执行，基于 `VACUUM INTO` 一致性快照）：

```bash
node scripts/backup.mjs                # 备份到 ./backups，默认保留 30 份
node scripts/backup.mjs --keep 14      # 只保留 14 份
```

产物为 gzip 压缩的 SQLite 快照 `backups/kanban-YYYYMMDD-HHMMSS.db.gz`，备份前会校验核心表完整性。建议加入定时任务（每天凌晨）：

```bash
# crontab -e
30 2 * * * cd /opt/kanban-pulse && node scripts/backup.mjs >> backups/backup.log 2>&1
```

**恢复**（先停止服务）：

```bash
systemctl stop kanban-pulse           # 或 docker compose stop / Ctrl+C
node scripts/restore.mjs backups/kanban-20261021-143000.db.gz
systemctl start kanban-pulse
```

恢复前当前数据会自动另存为 `kanban.db.before-restore`，并清理残留的 `-wal`/`-shm` 文件。

**重置**：`npm run reset`（删除 kanban.db 及其 -wal/-shm，下次启动按 SEED_MODE 重新初始化）。

**清空任务与动态**（保留成员、看板列、项目信息）：

```bash
node scripts/clear.js --dry-run   # 只统计，不改数据
node scripts/clear.js --yes       # 执行清空（先停服务更稳妥）
```

脚本会先把当前库复制为 `data/kanban.db.before-clear`，然后在事务内清空
`tasks`（级联清理标签/子项/历史）与 `activity`，并把任务编号计数器复位（新任务从 PLS-1 开始）。
适用于「演示数据用完、要正式开始记录」或「批量导入前清场」的场景。

**迁移/搬家**：停止服务后拷贝 `data/kanban.db` 到新机器同位置即可，跨平台通用（不必带 -wal/-shm）。

**从旧版 JSON 升级（v1.0 → v1.1）**：把旧版的 `data/db.json` 放进 `data/` 后直接启动新版本，首次启动会自动把 JSON 数据迁移到 SQLite（日志输出「已从旧版 JSON 数据迁移到 SQLite」），迁移后原 `db.json` 保留作存档，可自行删除。若 JSON 损坏会跳过迁移改用初始数据，并在日志中记录错误。

---

## 10. 升级与回滚

```bash
# 升级（Docker）
docker compose down && docker compose up -d --build

# 升级（裸机）
systemctl stop kanban-pulse
cp -r data /tmp/kanban-data-backup        # 数据先备份
tar -xzf kanban-pulse-1.9.0.tar.gz -C /opt/kanban-pulse --strip-components=1
systemctl start kanban-pulse

# 回滚：换回旧版本包重新解压启动即可；数据库 schema 通过版本化迁移管理，向前兼容
```

升级前建议先执行一次 `node scripts/backup.mjs`。

**关于 schema 迁移**：启动时自动执行，日志会打印 `数据库迁移已应用`（含 version 与 name）：

- version=2：新增 `tasks.started_at`，从任务历史回填「首次进入开始列」的时间
- version=3（v1.9.0）：新增 `tasks.difficulty`，把旧的数字 `estimate` 折算为难度档位
  （≤2 简单 / ≤4 一般 / ≤6 较难 / >6 困难）；`estimate` 列保留但不再使用

回填不修改原有数据，可安全重复执行。

---

## 11. 日志与监控

- **日志**：结构化 JSON 输出（含 requestId、耗时、状态码），写 stdout/stderr，由 systemd journald / Docker json-file / PM2 统一收集
- **健康检查**：`GET /api/health` 返回版本、运行时长、内存、任务量，可直接对接负载均衡探活、UptimeRobot 等拨测
- **关键指标**：进程内存（health 的 memoryMb）、接口 5xx 比例（日志 grep `"level":"error"`）

---

## 12. 常见问题排查

| 现象 | 排查 |
|------|------|
| 启动即退出，日志出现「配置校验失败」 | 按日志提示修正 `.env`，常见是 CORS_ORIGINS 含 `*` 或数值越界 |
| `EADDRINUSE` 端口被占 | `lsof -i:4173`（Windows: `netstat -ano | findstr 4173`）找到进程，或改 PORT |
| 外部无法访问 | HOST 是 127.0.0.1 时只监听本机；容器/局域网需 HOST=0.0.0.0 并放行防火墙 |
| 界面打开但请求全部失败 | 检查浏览器控制台；多为 CORS_ORIGINS 未包含实际访问地址 |
| 限流 429 频繁触发 | 调大 RATE_LIMIT_MAX；若在反代后确认 TRUST_PROXY=true（否则所有人共享代理 IP 计数） |
| 数据库异常（磁盘满等） | 服务启动失败并打印原因；修复磁盘后重启即可。恢复数据用 restore.mjs 从备份还原（先停服务） |
| 升级后界面没变化 | 应用使用 ETag 协商缓存，正常刷新即可；极旧浏览器可 Ctrl+F5 |

---

## 13. 安全加固建议

1. **不要直接对公网暴露 4173**：用 Nginx 反代并启用 HTTPS（内网部署也建议）
2. **TRUST_PROXY 原则**：只在确有反代时开启，避免限流被 X-Forwarded-For 伪造绕过
3. **备份异地化**：定时备份后同步到对象存储/另一台机器
4. **最小权限**：systemd 单元已内置 NoNewPrivileges、ProtectSystem 等加固；数据目录仅对运行用户可写
5. **已知边界**：当前版本无登录鉴权（操作人以 `X-Actor-Id` 标识，仅用于活动流归属），因此**必须部署在内网或网关认证之后**（如 Nginx basic auth、VPN、公司 SSO）。接入正式登录体系在路线图中
6. 建议团队规模超过 20 人或数据量显著增长时，规划迁移 PostgreSQL（仓储层已隔离，替换存储实现即可）
