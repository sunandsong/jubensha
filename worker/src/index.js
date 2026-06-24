/**
 * 薄荷镇剧本杀 · Cloudflare Worker 后端入口
 * -------------------------------------------------
 * 职责：把外部 HTTP 请求路由到对应房间的 Durable Object。
 * 每个房间（房号）= 一个 GameRoom 实例，状态独立、互不干扰。
 *
 * 路由（全部走 /api/ 前缀，前端 fetch 调用）：
 *   POST /api/room/create                 主持人建房 → 返回房号
 *   POST /api/room/:code/join             玩家进房   → 返回玩家 token
 *   POST /api/room/:code/assign           主持人随机分配角色（洗牌在服务端跑）
 *   GET  /api/room/:code/my-role?token=   玩家拉取“自己的”角色剧本
 *   GET  /api/room/:code/state            拉取公共状态（大厅人数 / 当前幕 / 已解锁线索）
 *   POST /api/room/:code/stage            主持人推进/回退阶段
 */

export { GameRoom } from "./room.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (!path.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }

    // ---- 建房：生成 4 位房号，路由到对应 DO 初始化 ----
    if (path === "/api/room/create" && request.method === "POST") {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const stub = roomStub(env, code);
      const res = await stub.fetch("https://do/init", { method: "POST" });
      const out = await res.json();
      return json({ code, ...out });
    }

    // ---- 其余请求：/api/room/:code/xxx ----
    const m = path.match(/^\/api\/room\/(\d{4})\/(.+)$/);
    if (m) {
      const code = m[1];
      const action = m[2];
      const stub = roomStub(env, code);
      // 把动作和查询参数透传给 DO
      const doUrl = `https://do/${action}${url.search}`;
      const res = await stub.fetch(doUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method === "POST" ? await request.text() : undefined,
      });
      // 给 DO 的响应补上 CORS 头
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    return json({ error: "not found" }, 404);
  },
};

// 通过房号拿到稳定的 Durable Object 实例（同房号永远指向同一个实例）
function roomStub(env, code) {
  const id = env.GAME_ROOM.idFromName(code);
  return env.GAME_ROOM.get(id);
}
