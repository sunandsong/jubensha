/**
 * 薄荷镇剧本杀 · EdgeOne Pages 边缘函数后端（catch-all 路由）
 * -------------------------------------------------------------
 * EdgeOne Pages 没有 Cloudflare 的 Durable Objects，这里改用 EdgeOne KV
 * 存储房间状态。每个房号 = KV 里的一条记录（key: room_<房号>）。
 *
 * 这个文件挂在 functions/api/[[default]].js，会接管所有 /api/* 请求，
 * 在函数内部按路径分发——逻辑与原 Cloudflare Worker + GameRoom 一致。
 *
 * 路由：
 *   POST /api/room/create                 主持人建房 → 返回房号
 *   POST /api/room/:code/join             玩家进房   → 返回玩家 token
 *   POST /api/room/:code/assign           主持人随机分配角色（服务端洗牌）
 *   GET  /api/room/:code/my-role?token=   玩家拉取“自己的”角色剧本
 *   GET  /api/room/:code/state            拉取公共状态（不含任何秘密）
 *   POST /api/room/:code/stage            主持人推进/回退阶段
 *
 * ⚠️ 部署前必须在 EdgeOne Pages 控制台创建 KV 命名空间，并把变量名绑定为
 *    bohe_kv（见 部署到EdgeOne.md）。
 */

/* ========== 本子数据 ========== */
const ROLES = [
  {
    id: "butler", name: "周明", title: "别墅管家", av: "🤵",
    public: "你在苏家别墅做了十二年管家，沉默、可靠，掌管每一把钥匙。今晚是你把薄荷茶端进书房的——那是夫人睡前的习惯。",
    scene: { t: "当晚", b: "九点，你照例煮了薄荷茶送进书房。夫人正对着一份牛皮纸档案出神，见你进来，慌忙把它压在台灯下。\n十点零五分，你听见书房传来玻璃碎裂声，赶去时门是反锁的。" },
    secret: "十二年前，你并不叫周明。你曾是常青精神病院的护工，因一起'病人意外死亡'被悄悄辞退。苏曼当年是院方的人，她知道真相，以此让你为她免费卖命至今。那份档案，记着你的旧名字。",
    mission: "在不暴露旧身份的前提下，找回或销毁那份档案。",
  },
  {
    id: "sister", name: "苏冷", title: "死者的妹妹", av: "👩",
    public: "你是苏曼同父异母的妹妹，今晚特地从城里赶来，名义上探望，其实为了遗产。你和姐姐已经三年没说过话。",
    scene: { t: "当晚", b: "你八点半到，和姐姐在书房谈崩了——她说要把别墅捐给精神病院。\n你摔门而出，回房间喝闷酒，直到听见管家的呼喊。" },
    secret: "你欠了一身赌债，债主三天后上门。姐姐的死让你成为别墅唯一继承人。你今晚确实带了安眠药，本想掺进她的茶里让她'病一场'好施压，但你发誓没动手。",
    mission: "洗清自己的嫌疑，确保继承权不旁落。",
  },
  {
    id: "doctor", name: "林知远", title: "精神病院医生", av: "👨‍⚕️",
    public: "你是常青精神病院的主治医生，西装革履，谈吐温和。苏曼是医院最大的捐助人，今晚你应邀来商谈捐赠别墅的事。",
    scene: { t: "当晚", b: "你九点二十到书房，和夫人单独谈了二十分钟。\n你说先去花园透气，再回来时，门已反锁，里面没了声音。" },
    secret: "你根本不是真正的林知远。真正的林医生五年前病故，你顶替了他的身份——你是前病人。苏曼最近查出破绽，那份牛皮纸档案里，是你的入院记录。她约你今晚，是来摊牌的。",
    mission: "绝不能让档案曝光，否则身败名裂。",
  },
  {
    id: "gardener", name: "阿青", title: "园丁", av: "🧑‍🌾",
    public: "你照料这座别墅的花园两年，话不多，对薄荷地格外上心——夫人的茶叶全出自你手。今晚本该早走，却被雨困在工具房。",
    scene: { t: "当晚", b: "九点四十，你透过书房落地窗，看见里面两个人影在争执，其中一个举起了手。\n雨太大，你没看清脸。只记得地上的薄荷盆栽被打翻了。" },
    secret: "你是被苏曼安插的眼线，真实身份是记者，正在暗访精神病院的换名丑闻。你早就怀疑林医生有问题。今晚你拍下了书房窗口的一张模糊照片。",
    mission: "找出冒名顶替者，同时保护好自己的记者身份。",
  },
  {
    id: "guest", name: "许文", title: "外来访客", av: "🕴️",
    public: "你自称是苏曼的旧友，临时登门借宿。没人说得清你和这家人到底什么关系。你一直待在客厅，看着雨。",
    scene: { t: "当晚", b: "你十点整起身倒水，路过书房，听见里面有人低声说'档案给我'。\n你没敢停留。等再有动静，已是玻璃碎裂的声音。" },
    secret: "你是十二年前那起'病人意外死亡'者的弟弟。你追查多年，终于查到当年的护工（周明）和涉事院方（苏曼）都在这栋别墅。今晚你来讨真相——也带了复仇的念头。",
    mission: "查清当年哥哥死亡的真相，决定是揭露还是动手。",
  },
];

const STAGES = [
  { n: "第一幕 · 雨夜聚首", d: "主持人朗读开场，玩家依次在群里自我介绍（只能说公开身份）。", clues: [0] },
  { n: "第二幕 · 初步搜证", d: "解锁现场线索，围绕死亡时间与现场展开第一轮讨论。", clues: [0, 1, 2] },
  { n: "第三幕 · 秘密交锋", d: "玩家互相盘问，试探破绽。新线索指向那份档案。", clues: [0, 1, 2, 3] },
  { n: "第四幕 · 真相浮现", d: "全部线索解锁。玩家在群内投票，指认凶手与冒名者。", clues: [0, 1, 2, 3, 4] },
  { n: "终幕 · 复盘", d: "主持人公布真相，每位玩家说出自己的秘密与目标完成情况。", clues: [0, 1, 2, 3, 4] },
];

const CLUES = [
  { h: "现场：反锁的书房", b: "书房从内反锁，钥匙插在锁孔内侧。窗户虚掩，雨水浸湿了地毯一角——有人可能从落地窗进出。" },
  { h: "死因：并非中毒", b: "那杯薄荷茶里确有微量安眠药，但不足致命。真正死因是后脑遭钝器击打——凶器是打翻的青瓷花盆。" },
  { h: "消失的档案", b: "台灯下原本压着的牛皮纸档案不见了。残留纸屑显示，它在死亡前后被人抽走。" },
  { h: "窗口的照片", b: "有人拍到书房窗口两个争执的身影，其中一人的侧脸……与某位'医生'的轮廓惊人地相似。" },
  { h: "两个名字", b: "档案残页拼出两行字：一个是十二年前被除名的护工旧名，一个是五年前病故却仍'在职'的医生之名。死者，握着两个人的命门。" },
];

/* ========== HTTP 工具 ========== */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", ...CORS },
  });
}

/* ========== KV 房间状态读写 ========== */
// KV 键名只允许数字/字母/下划线，所以用 room_<房号>
function roomKey(code) {
  return "room_" + code;
}
async function loadRoom(kv, code) {
  const raw = await kv.get(roomKey(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function saveRoom(kv, code, data) {
  await kv.put(roomKey(code), JSON.stringify(data));
}
function newRoom() {
  return {
    created: true,
    players: [],    // [{ token, name }]
    assignment: [], // [{ token, roleId }]
    assigned: false,
    stage: -1,      // -1 = 未开始
  };
}

// 根据当前阶段返回已解锁的线索（含内容）
function visibleClues(stage) {
  if (stage < 0) return [];
  const openIdx = STAGES[stage].clues;
  return CLUES.map((c, i) => ({
    index: i,
    unlocked: openIdx.includes(i),
    title: openIdx.includes(i) ? c.h : null,
    body: openIdx.includes(i) ? c.b : null,
  }));
}

async function readBody(request) {
  try {
    return JSON.parse(await request.text());
  } catch {
    return {};
  }
}

/* ========== 入口 ========== */
export async function onRequest(context) {
  const { request } = context;

  // 预检
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // 取得 KV 绑定（控制台里把命名空间变量名绑定为 bohe_kv）
  const kv = globalThis.bohe_kv;
  if (!kv) {
    return json(
      { error: "KV 未绑定：请在 EdgeOne Pages 控制台创建 KV 命名空间并绑定变量名 bohe_kv" },
      500
    );
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    // ---- 建房 ----
    if (path === "/api/room/create" && request.method === "POST") {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      await saveRoom(kv, code, newRoom());
      return json({ code, maxPlayers: ROLES.length });
    }

    // ---- /api/room/:code/:action ----
    const m = path.match(/^\/api\/room\/(\d{4})\/(.+)$/);
    if (m) {
      const code = m[1];
      const action = m[2].split("?")[0];
      const data = await loadRoom(kv, code);
      if (!data) return json({ error: "房间不存在或已过期" }, 404);

      // 玩家进房
      if (action === "join" && request.method === "POST") {
        if (data.assigned) return json({ error: "游戏已开始，无法加入" }, 403);
        if (data.players.length >= ROLES.length) return json({ error: "房间已满" }, 403);
        const body = await readBody(request);
        const name = (body.name || "玩家").slice(0, 12);
        const token = crypto.randomUUID();
        data.players.push({ token, name });
        await saveRoom(kv, code, data);
        return json({ token, seat: data.players.length });
      }

      // 随机分配（服务端 Fisher–Yates 洗牌）
      if (action === "assign" && request.method === "POST") {
        if (data.assigned) return json({ error: "已经分配过了" }, 403);
        if (data.players.length !== ROLES.length)
          return json({ error: `需要正好 ${ROLES.length} 人才能开局` }, 400);
        const ids = ROLES.map((r) => r.id);
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        data.assignment = data.players.map((p, i) => ({ token: p.token, roleId: ids[i] }));
        data.assigned = true;
        data.stage = 0;
        await saveRoom(kv, code, data);
        return json({ assigned: true });
      }

      // 玩家拉取自己的角色（只发自己的）
      if (action === "my-role" && request.method === "GET") {
        const token = url.searchParams.get("token");
        if (!data.assigned) return json({ error: "还未分配角色" }, 425);
        const mine = data.assignment.find((a) => a.token === token);
        if (!mine) return json({ error: "无效的玩家身份" }, 403);
        const role = ROLES.find((r) => r.id === mine.roleId);
        const player = data.players.find((p) => p.token === token);
        return json({ playerName: player?.name, role });
      }

      // 公共状态（绝不含任何秘密）
      if (action === "state" && request.method === "GET") {
        return json({
          created: data.created,
          playerCount: data.players.length,
          maxPlayers: ROLES.length,
          players: data.players.map((p) => ({ name: p.name })),
          assigned: data.assigned,
          stage: data.stage,
          stageInfo: data.stage >= 0 ? STAGES[data.stage] : null,
          totalStages: STAGES.length,
          clues: visibleClues(data.stage),
        });
      }

      // 主持人推进/回退阶段
      if (action === "stage" && request.method === "POST") {
        const body = await readBody(request);
        const dir = body.dir; // "next" | "prev"
        if (dir === "next" && data.stage < STAGES.length - 1) data.stage++;
        if (dir === "prev" && data.stage > -1) data.stage--;
        await saveRoom(kv, code, data);
        return json({ stage: data.stage });
      }

      return json({ error: "未知操作" }, 404);
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: "服务器错误：" + e.message }, 500);
  }
}
