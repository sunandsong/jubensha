# 部署到 EdgeOne Pages

本项目原本是 Cloudflare Workers + Durable Objects 架构。EdgeOne Pages **没有 Durable Objects**，
所以 `edgeone/` 目录是为 EdgeOne 重写的版本：**静态前端 + 一个边缘函数 + KV 存储**。

```
edgeone/
├── index.html                  # 前端（与 Cloudflare 版相同，API 改成同源相对路径）
└── functions/
    └── api/
        └── [[default]].js      # 接管所有 /api/* 请求的边缘函数，房间状态存到 KV
```

跟 Cloudflare 版的区别：
- 房间状态从 Durable Object storage 改成 **EdgeOne KV**（key 为 `room_<房号>`）。
- 前端和后端同域，前端 `API = ""` 用相对路径，不再需要填后端地址、也不需要 CORS 配置。

---

## 一、安装并登录 CLI

```bash
npm i -g edgeone        # 或每次用 npx edgeone
edgeone login           # 浏览器扫码登录腾讯云 EdgeOne
edgeone whoami          # 确认已登录
```

## 二、创建并绑定 KV 命名空间（关键，必须先做）

边缘函数里通过全局变量 `bohe_kv` 访问 KV，**没绑定会直接报错**。

1. 进入 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages) → 你的项目 → **KV 存储**。
2. **创建命名空间**（名字随意，例如 `bohe-jubensha`）。
3. 在项目里**绑定该命名空间**，变量名务必填 **`bohe_kv`**（要和代码里一致）。
   - 如果想换变量名，把 `edgeone/functions/api/[[default]].js` 里的 `globalThis.bohe_kv` 一起改掉。

> KV 为最终一致性（60 秒内全球同步），同一边缘节点内读写很快。小规模剧本杀（同一局玩家通常命中同一节点）完全够用。

## 三、部署

在仓库根目录运行（部署 `edgeone/` 目录）：

```bash
edgeone pages deploy ./edgeone -n bohe-jubensha
```

- `-n` 指定项目名；首次部署会创建项目，之后同名即为更新。
- 也可以直接在 EdgeOne Pages 控制台用 **Git 导入**：连接本仓库，构建输出目录设为 `edgeone`，KV 绑定按第二步配置。

部署完成后 CLI 会给出访问地址（`https://<项目>.edgeone.app` 之类）。直接打开即可：
主持人建房 → 把房号/链接发群里 → 玩家进房 → 满 5 人后分配角色。

## 四、本地调试（可选）

```bash
edgeone pages dev ./edgeone
```

本地需要 KV 时，按 CLI 提示配置；或先在线上验证。

---

## 排错

- 接口报 `KV 未绑定`：说明命名空间没绑定或变量名不是 `bohe_kv`，回到第二步。
- 接口 404 `房间不存在`：房号输错，或该房间记录已被清理。
- 满 5 人才能点「随机分配」——角色数量由 `[[default]].js` 里的 `ROLES` 决定（当前 5 人）。
