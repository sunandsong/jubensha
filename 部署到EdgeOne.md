# 部署到 EdgeOne Pages

本项目原本是 Cloudflare Workers + Durable Objects 架构。EdgeOne Pages **没有 Durable Objects**，
所以 `edgeone/` 目录是为 EdgeOne 重写的版本：**静态前端 + 一个边缘函数 + Blob 存储**。

```
edgeone/
├── package.json                # 声明 @edgeone/pages-blob 依赖
├── index.html                  # 前端（与 Cloudflare 版相同，API 改成同源相对路径）
└── functions/
    └── api/
        └── [[default]].js      # 接管所有 /api/* 请求的边缘函数，房间状态存到 Blob
```

跟 Cloudflare 版的区别：
- 房间状态从 Durable Object storage 改成 **EdgeOne Blob**（store: `bohe-rooms`，key: `room_<房号>`）。
- 前端和后端同域，前端 `API = ""` 用相对路径，不再需要填后端地址、也不需要 CORS 配置。

### 为什么用 Blob 而不是 KV？
- **Blob 首次调用即自动创建，无需在控制台开通/创建命名空间/绑定**（KV 需要先开通服务、建命名空间、再绑定变量名，流程更繁琐，且开通偶尔会卡住）。
- 读取用 `consistency: "strong"`（代码里已设为默认），建房后玩家能**立即**读到、进房后主持人能**立即**看到——比 KV 的 60 秒最终一致更适合实时建房/进房。

---

## 一、安装并登录 CLI

```bash
npm i -g edgeone        # 或每次用 npx edgeone
edgeone login           # 浏览器扫码登录腾讯云 EdgeOne
edgeone whoami          # 确认已登录
```

## 二、安装依赖

边缘函数用到 `@edgeone/pages-blob`，部署前先在 `edgeone/` 里装好（已在仓库 .gitignore 忽略 node_modules，clone 后需自己装）：

```bash
cd edgeone && npm install && cd ..
```

## 三、部署

在仓库根目录运行（用绝对路径最稳，避免 CLI 把相对路径解析错）：

```bash
edgeone pages deploy /绝对路径/到/edgeone -n bohe-jubensha
```

- `-n` 指定项目名；首次部署会创建项目，之后同名即为更新。
- Blob 存储**无需任何控制台配置**，函数第一次写入时自动创建 `bohe-rooms` 这个 store。
- 也可在控制台用 **Git 导入**：连接本仓库，构建输出目录设为 `edgeone`，安装命令 `npm install`。

部署完成后 CLI 会输出访问地址（形如 `https://bohe-jubensha-xxxx.edgeone.cool`）。
直接打开即可：主持人建房 → 把房号/链接发群里 → 玩家进房 → 满 5 人后分配角色。

## 四、本地调试（可选）

```bash
edgeone pages dev ./edgeone
```

---

## 当前线上地址

- 站点：https://bohe-jubensha-mggnokgp.edgeone.cool
- 控制台项目：bohe-jubensha（Project ID: makers-m9schhpmljkj）

## 排错

- 接口报 `房间不存在或已过期`：房号输错，或该房间记录被清理。
- 满 5 人才能点「随机分配」——角色数量由 `[[default]].js` 里的 `ROLES` 决定（当前 5 人）。
- 想换本子：改 `[[default]].js` 里的 `ROLES / STAGES / CLUES`，重新部署即可。
