/**
 * GameRoom · 一个房间的 Durable Object
 * -------------------------------------------------
 * 每个房号对应一个实例，负责：
 *   - 保存房间状态（玩家列表、分配结果、当前阶段）到 DO storage
 *   - 玩家进房，发放唯一 token
 *   - 随机分配角色（Fisher–Yates 洗牌，在服务端跑，玩家无法预知）
 *   - 按 token 只返回“你自己”的角色，别人的秘密一概不下发
 *   - 主持人推进/回退阶段，前端轮询 state 同步
 *
 * 安全要点：本子里的 secret/mission 只在 /my-role 接口里、
 * 且只对“匹配 token 的那个角色”下发。/state 接口绝不含任何秘密。
 */

import { ROLES, STAGES, CLUES } from "./script.js";

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  // 读取持久化状态（首次为初始值）
  async load() {
    return (await this.ctx.storage.get("data")) || {
      created: false,
      players: [],      // [{ token, name }]
      assignment: [],   // [{ token, roleId }]
      assigned: false,
      stage: -1,        // -1 = 未开始
    };
  }
  async save(data) {
    await this.ctx.storage.put("data", data);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\//, "");
    const data = await this.load();

    try {
      // ---- 初始化房间 ----
      if (action === "init") {
        data.created = true;
        await this.save(data);
        return this.ok({ maxPlayers: ROLES.length });
      }

      // ---- 玩家进房 ----
      if (action === "join") {
        if (data.assigned) return this.err("游戏已开始，无法加入", 403);
        if (data.players.length >= ROLES.length) return this.err("房间已满", 403);
        const body = await this.body(request);
        const name = (body.name || "玩家").slice(0, 12);
        const token = crypto.randomUUID();
        data.players.push({ token, name });
        await this.save(data);
        return this.ok({ token, seat: data.players.length });
      }

      // ---- 随机分配（核心，服务端洗牌）----
      if (action === "assign") {
        if (data.assigned) return this.err("已经分配过了", 403);
        if (data.players.length !== ROLES.length)
          return this.err(`需要正好 ${ROLES.length} 人才能开局`, 400);

        const ids = ROLES.map((r) => r.id);
        // Fisher–Yates 洗牌
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        data.assignment = data.players.map((p, i) => ({
          token: p.token,
          roleId: ids[i],
        }));
        data.assigned = true;
        data.stage = 0; // 分配后自动进入第一幕
        await this.save(data);
        return this.ok({ assigned: true });
      }

      // ---- 玩家拉取自己的角色（只发自己的）----
      if (action === "my-role") {
        const token = url.searchParams.get("token");
        if (!data.assigned) return this.err("还未分配角色", 425);
        const mine = data.assignment.find((a) => a.token === token);
        if (!mine) return this.err("无效的玩家身份", 403);
        const role = ROLES.find((r) => r.id === mine.roleId);
        const player = data.players.find((p) => p.token === token);
        // 注意：这里只返回这一个角色的完整内容
        return this.ok({ playerName: player?.name, role });
      }

      // ---- 公共状态（绝不含任何秘密）----
      if (action === "state") {
        return this.ok({
          created: data.created,
          playerCount: data.players.length,
          maxPlayers: ROLES.length,
          players: data.players.map((p) => ({ name: p.name })), // 只给名字
          assigned: data.assigned,
          stage: data.stage,
          stageInfo: data.stage >= 0 ? STAGES[data.stage] : null,
          totalStages: STAGES.length,
          clues: this.visibleClues(data.stage), // 已解锁线索
        });
      }

      // ---- 主持人推进/回退阶段 ----
      if (action === "stage") {
        const body = await this.body(request);
        const dir = body.dir; // "next" | "prev"
        if (dir === "next" && data.stage < STAGES.length - 1) data.stage++;
        if (dir === "prev" && data.stage > -1) data.stage--;
        await this.save(data);
        return this.ok({ stage: data.stage });
      }

      return this.err("未知操作", 404);
    } catch (e) {
      return this.err("服务器错误：" + e.message, 500);
    }
  }

  // 根据当前阶段返回已解锁的线索（含内容）
  visibleClues(stage) {
    if (stage < 0) return [];
    const openIdx = STAGES[stage].clues;
    return CLUES.map((c, i) => ({
      index: i,
      unlocked: openIdx.includes(i),
      title: openIdx.includes(i) ? c.h : null,
      body: openIdx.includes(i) ? c.b : null,
    }));
  }

  async body(request) {
    try { return JSON.parse(await request.text()); }
    catch { return {}; }
  }
  ok(d) { return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } }); }
  err(msg, status = 400) {
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { "Content-Type": "application/json" },
    });
  }
}
