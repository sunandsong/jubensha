/**
 * 薄荷镇剧本杀 · 微信云函数后端
 * -------------------------------------------------
 * 一个云函数处理所有动作（event.action 分发），房间状态存云数据库 rooms 集合。
 * 玩家身份用微信的 OPENID（云函数上下文里取，前端无法伪造）——比自发 token 更安全。
 *
 * 动作（前端 wx.cloud.callFunction({ name:'game', data:{ action, ... } })）：
 *   create                建房 → 返回 4 位房号（建房者记为主持人 host）
 *   join   {code, name}   进房（同一人重复进房幂等）
 *   assign {code}         主持人随机分配角色（服务端洗牌）
 *   myRole {code}         拉取“自己的”角色剧本（按 OPENID，只发本人）
 *   state  {code}         公共状态（不含任何秘密；含 isHost / joined 供前端判断）
 *   stage  {code, dir}    主持人推进/回退阶段（dir: "next" | "prev"）
 *
 * 安全：secret / mission 只在 myRole 里、且只发给匹配 OPENID 的本人。
 *       assign / stage 只有 host 能调用。state 绝不含秘密。
 */

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

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
  { n: "第一幕 · 雨夜聚首", d: "主持人朗读开场，玩家依次自我介绍（只能说公开身份）。", clues: [0] },
  { n: "第二幕 · 初步搜证", d: "解锁现场线索，围绕死亡时间与现场展开第一轮讨论。", clues: [0, 1, 2] },
  { n: "第三幕 · 秘密交锋", d: "玩家互相盘问，试探破绽。新线索指向那份档案。", clues: [0, 1, 2, 3] },
  { n: "第四幕 · 真相浮现", d: "全部线索解锁。玩家投票，指认凶手与冒名者。", clues: [0, 1, 2, 3, 4] },
  { n: "终幕 · 复盘", d: "主持人公布真相，每位玩家说出自己的秘密与目标完成情况。", clues: [0, 1, 2, 3, 4] },
];

const CLUES = [
  { h: "现场：反锁的书房", b: "书房从内反锁，钥匙插在锁孔内侧。窗户虚掩，雨水浸湿了地毯一角——有人可能从落地窗进出。" },
  { h: "死因：并非中毒", b: "那杯薄荷茶里确有微量安眠药，但不足致命。真正死因是后脑遭钝器击打——凶器是打翻的青瓷花盆。" },
  { h: "消失的档案", b: "台灯下原本压着的牛皮纸档案不见了。残留纸屑显示，它在死亡前后被人抽走。" },
  { h: "窗口的照片", b: "有人拍到书房窗口两个争执的身影，其中一人的侧脸……与某位'医生'的轮廓惊人地相似。" },
  { h: "两个名字", b: "档案残页拼出两行字：一个是十二年前被除名的护工旧名，一个是五年前病故却仍'在职'的医生之名。死者，握着两个人的命门。" },
];

function visibleClues(stage) {
  if (stage < 0) return [];
  const openIdx = STAGES[stage].clues;
  return CLUES.map((c, i) => ({
    index: i,
    unlocked: openIdx.indexOf(i) !== -1,
    title: openIdx.indexOf(i) !== -1 ? c.h : null,
    body: openIdx.indexOf(i) !== -1 ? c.b : null,
  }));
}

function randCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;
  const rooms = db.collection("rooms");

  try {
    // ---- 建房 ----
    if (action === "create") {
      // 尽量生成不重复的房号
      let code = randCode();
      for (let i = 0; i < 6; i++) {
        const exist = await rooms.doc(code).get().catch(() => null);
        if (!exist || !exist.data) break;
        code = randCode();
      }
      await rooms.doc(code).set({
        data: {
          host: OPENID,
          created: true,
          players: [],
          assignment: [],
          assigned: false,
          stage: -1,
          createdAt: db.serverDate(),
        },
      });
      return { ok: true, code, maxPlayers: ROLES.length };
    }

    // ---- 以下都需要房号 ----
    const code = event.code;
    const res = await rooms.doc(code).get().catch(() => null);
    if (!res || !res.data) return { ok: false, error: "房间不存在或已过期" };
    const data = res.data;

    // 玩家进房（同一人重复进房幂等）
    if (action === "join") {
      if (data.assigned) return { ok: false, error: "游戏已开始，无法加入" };
      if (data.players.find((p) => p.openid === OPENID)) {
        return { ok: true, rejoined: true };
      }
      if (data.players.length >= ROLES.length) return { ok: false, error: "房间已满" };
      const name = (event.name || "玩家").slice(0, 12);
      // 原子追加，避免并发进房互相覆盖
      await rooms.doc(code).update({
        data: { players: _.push([{ openid: OPENID, name }]) },
      });
      return { ok: true };
    }

    // 随机分配（仅主持人）
    if (action === "assign") {
      if (data.host !== OPENID) return { ok: false, error: "只有主持人能分配角色" };
      if (data.assigned) return { ok: false, error: "已经分配过了" };
      if (data.players.length !== ROLES.length)
        return { ok: false, error: "需要正好 " + ROLES.length + " 人才能开局" };
      const ids = ROLES.map((r) => r.id);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
      }
      const assignment = data.players.map((p, i) => ({ openid: p.openid, roleId: ids[i] }));
      await rooms.doc(code).update({ data: { assignment, assigned: true, stage: 0 } });
      return { ok: true };
    }

    // 拉取自己的角色（只发本人）
    if (action === "myRole") {
      if (!data.assigned) return { ok: false, error: "还未分配角色" };
      const mine = data.assignment.find((a) => a.openid === OPENID);
      if (!mine) return { ok: false, error: "你不在本房间" };
      const role = ROLES.find((r) => r.id === mine.roleId);
      const player = data.players.find((p) => p.openid === OPENID);
      return { ok: true, playerName: player && player.name, role };
    }

    // 公共状态（绝不含秘密）
    if (action === "state") {
      return {
        ok: true,
        state: {
          playerCount: data.players.length,
          maxPlayers: ROLES.length,
          players: data.players.map((p) => ({ name: p.name })),
          assigned: data.assigned,
          stage: data.stage,
          stageInfo: data.stage >= 0 ? STAGES[data.stage] : null,
          totalStages: STAGES.length,
          clues: visibleClues(data.stage),
          isHost: data.host === OPENID,
          joined: !!data.players.find((p) => p.openid === OPENID),
        },
      };
    }

    // 主持人推进/回退阶段
    if (action === "stage") {
      if (data.host !== OPENID) return { ok: false, error: "只有主持人能控场" };
      let stage = data.stage;
      if (event.dir === "next" && stage < STAGES.length - 1) stage++;
      if (event.dir === "prev" && stage > -1) stage--;
      await rooms.doc(code).update({ data: { stage } });
      return { ok: true, stage };
    }

    return { ok: false, error: "未知操作" };
  } catch (e) {
    return { ok: false, error: "服务器错误：" + e.message };
  }
};
