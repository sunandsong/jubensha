# 薄荷镇的最后一夜 · 线上剧本杀

一个 5 人本格推理剧本杀的线上小程序：主持人建房 → 玩家凭房号进房 → 服务端随机分配角色 →
每人只看到**自己的**剧本（含独家秘密与目标）→ 主持人按幕次推进、逐步解锁公共线索。

- 角色私密内容（secret / mission）只在 `/my-role` 接口、且只对匹配 token 的本人下发，`/state` 绝不含任何秘密。
- 随机分配用服务端 Fisher–Yates 洗牌，玩家无法预知。

## 在线体验

**https://bohe-jubensha-mggnokgp.edgeone.cool** （部署在 EdgeOne Pages）

手机打开 → 「我是主持人，建房」→ 把房号或链接发到群里 → 朋友输房号进房 → 满 5 人后点「随机分配角色」。

## 两套部署

本仓库提供三套等价实现，按你的场景选一套：

| 目录 | 平台 | 后端 | 状态存储 | 适用 |
|------|------|------|----------|------|
| [`miniprogram-jubensha/`](miniprogram-jubensha/) | 微信小程序 + 云开发 | 云函数 `game` | 云数据库 rooms | **大陆玩家、免费、免备案**（推荐） |
| [`worker/`](worker/) + [`public/`](public/) | Cloudflare Workers | Worker + Durable Object | DO storage（强一致） | 海外可访问 |
| [`edgeone/`](edgeone/) | EdgeOne Pages | 边缘函数（catch-all） | Blob（strong 一致性） | 备案域名后大陆可用 |

> **大陆访问注意**：网页版（Cloudflare / EdgeOne 默认域名）在中国大陆被墙或受备案限制，普遍打不开。
> 大陆玩家请用**微信小程序版**——跑在微信里免网站备案、云开发免费，群里点开即玩。
> EdgeOne / Cloudflare 三套后端逻辑完全一致，只是托管平台不同。

### 部署 Cloudflare 版
见 [部署指南.md](部署指南.md)。要点：`cd worker && npm i && npx wrangler deploy`，再把 `public/index.html` 里的 `API` 改成你的 Worker 地址后托管前端。

### 部署微信小程序版（大陆推荐）
见 [部署到微信小程序.md](部署到微信小程序.md)。要点：注册个人小程序 → 微信开发者工具导入 `miniprogram-jubensha/` → 开通云开发、建 `rooms` 集合 → 上传部署云函数 `game` → 用体验版加朋友即玩，免备案免费。

### 部署 EdgeOne 版
见 [部署到EdgeOne.md](部署到EdgeOne.md)。要点：
```bash
cd edgeone && npm install && cd ..
edgeone login
edgeone pages deploy /绝对路径/到/edgeone -n bohe-jubensha
```
Blob 首次调用自动创建，无需在控制台开通任何存储服务。

## 接口一览（两套相同）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/room/create` | 建房，返回 4 位房号 |
| POST | `/api/room/:code/join` | 进房，返回玩家 token |
| POST | `/api/room/:code/assign` | 随机分配角色（服务端洗牌） |
| GET  | `/api/room/:code/my-role?token=` | 拉取**自己**的角色剧本 |
| GET  | `/api/room/:code/state` | 公共状态（人数 / 当前幕 / 已解锁线索） |
| POST | `/api/room/:code/stage` | 主持人推进 / 回退阶段 |

## 换本子

改剧本数据即可，角色数量决定房间人数：
- Cloudflare 版：[worker/src/script.js](worker/src/script.js)
- EdgeOne 版：[edgeone/functions/api/\[\[default\]\].js](edgeone/functions/api/) 里的 `ROLES / STAGES / CLUES`
