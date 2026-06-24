/**
 * 群本杀 · 微信云函数后端
 * -------------------------------------------------
 * 一个云函数处理所有动作（event.action 分发），房间状态存云数据库 rooms 集合。
 * 玩家身份用微信 OPENID（云函数上下文取，前端无法伪造）。
 *
 * 多本架构：所有剧本放在 SCRIPTS 剧本库里，建房时选一个本（room.script 记下 id），
 * 之后该房间的角色/线索/阶段都取自这个本。以后加本只需往 SCRIPTS 里加一项。
 *
 * 动作：
 *   catalog               返回本子目录（仅公开信息：标题/简介/人数）
 *   create {script}       建房 → 返回房号（建房者记为主持人 host）
 *   join   {code, name}   进房（同一人重复进房幂等）
 *   assign {code}         主持人随机分配角色（服务端洗牌）
 *   myRole {code}         拉取“自己的”角色剧本（按 OPENID，只发本人）
 *   state  {code}         公共状态（不含任何秘密）
 *   stage  {code, dir}    主持人推进/回退阶段
 */

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/* ========================================================================
 * 剧本库：往这里加新本即可。每个本：title 标题 / intro 简介 /
 * roles 角色（数量决定人数）/ stages 幕 / clues 线索。
 * ====================================================================== */
const SCRIPTS = {
  /* ---------- 本 1：薄荷镇的最后一夜 ---------- */
  bohe: {
    title: "薄荷镇的最后一夜",
    intro: "山坡上的白色别墅，一杯薄荷茶，一桩反锁书房里的命案。",
    roles: [
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
    ],
    stages: [
      { n: "第一幕 · 雨夜聚首", d: "主持人朗读开场，玩家依次自我介绍（只能说公开身份）。", clues: [0] },
      { n: "第二幕 · 初步搜证", d: "解锁现场线索，围绕死亡时间与现场展开第一轮讨论。", clues: [0, 1, 2] },
      { n: "第三幕 · 秘密交锋", d: "玩家互相盘问，试探破绽。新线索指向那份档案。", clues: [0, 1, 2, 3] },
      { n: "第四幕 · 真相浮现", d: "全部线索解锁。玩家投票，指认凶手与冒名者。", clues: [0, 1, 2, 3, 4] },
      { n: "终幕 · 复盘", d: "主持人公布真相，每位玩家说出自己的秘密与目标完成情况。", clues: [0, 1, 2, 3, 4] },
    ],
    clues: [
      { h: "现场：反锁的书房", b: "书房从内反锁，钥匙插在锁孔内侧。窗户虚掩，雨水浸湿了地毯一角——有人可能从落地窗进出。" },
      { h: "死因：并非中毒", b: "那杯薄荷茶里确有微量安眠药，但不足致命。真正死因是后脑遭钝器击打——凶器是打翻的青瓷花盆。" },
      { h: "消失的档案", b: "台灯下原本压着的牛皮纸档案不见了。残留纸屑显示，它在死亡前后被人抽走。" },
      { h: "窗口的照片", b: "有人拍到书房窗口两个争执的身影，其中一人的侧脸……与某位'医生'的轮廓惊人地相似。" },
      { h: "两个名字", b: "档案残页拼出两行字：一个是十二年前被除名的护工旧名，一个是五年前病故却仍'在职'的医生之名。死者，握着两个人的命门。" },
    ],
  },

  /* ---------- 本 2：末班地铁 ---------- */
  metro: {
    title: "末班地铁",
    intro: "凌晨的末班地铁，一节封闭车厢，五个陌生人，和一个攥着所有人把柄的死者。",
    roles: [
      {
        id: "driver", name: "老吴", title: "末班列车员", av: "🚇",
        public: "你开了二十年末班车，话很少。今晚到终点站清车厢时，发现末节车厢瘫着一个不会再醒来的人。",
        scene: { t: "当晚", b: "末班车过了倒数第二站，车厢里就剩这几个人。你在驾驶室透过反光，隐约看见后面有人起身又坐下。\n到站开门那一刻，灯闪了一下，那人已经歪在座位上。" },
        secret: "三年前你儿子因为高利贷走投无路，从这条线的站台跳了下去。放贷的人，就是今晚死的'老钱'。你今晚一眼认出了他，二十年没动过的手，攥紧了那条制服围巾。",
        mission: "别让任何人把你和死者、和你儿子的旧事联系起来。",
      },
      {
        id: "nurse", name: "林姐", title: "夜班护士", av: "👩‍⚕️",
        public: "你刚下夜班，累得只想回家。你坐在死者斜对面，全程戴着口罩闭目养神——至少你想让别人这么以为。",
        scene: { t: "当晚", b: "你上车时老钱已经在了，他朝你笑了一下，那种笑你太熟悉。\n车厢晃，你的包没拉好，一支安瓿瓶滚了出来，你慌忙捡了回去。" },
        secret: "为了救重病的母亲，你偷拿了医院的管制药品，老钱不知怎么拿到了证据，按月敲诈你。今晚你确实带着一支足以致命的药剂——你想过用它，对他，或对自己。",
        mission: "拿回他手里的证据，别让那支药剂暴露。",
      },
      {
        id: "driver2", name: "阿强", title: "网约车司机", av: "🚗",
        public: "你刚还完今天的份子钱，收车坐地铁回家。你一上车就盯着手机，谁也不看。",
        scene: { t: "当晚", b: "老钱凑过来跟你低声说了句什么，你脸一下白了，攥着扶手站起来又坐下。\n后来灯闪的时候，你说你在看手机，没注意他那边。" },
        secret: "三年前一个雨夜，你开车撞了人后没停车——那是一桩至今没破的肇事逃逸案。老钱手里有当时的行车记录仪片段，捏着你三年。",
        mission: "拿到或毁掉那段行车记录，别让旧案翻出来。",
      },
      {
        id: "blogger", name: "小鹿", title: "爆料博主", av: "📱",
        public: "你是个靠扒隐私、蹭热点涨粉的自媒体博主，举着手机像在直播。你说你只是碰巧坐这趟车。",
        scene: { t: "当晚", b: "你和老钱并不像陌生人——你们对了个眼神。你假装刷手机，其实在等他把东西给你。\n灯闪那下，你的镜头'恰好'对着别处。" },
        secret: "你和老钱是一伙的：你负责帮他挖各路人的把柄，今晚本是来分赃、顺便拿那个记录了所有人秘密的U盘。但你早就想甩开他，独吞这门生意。",
        mission: "拿到U盘，并撇清你和死者是同伙的关系。",
      },
      {
        id: "student", name: "小满", title: "大学生", av: "🎧",
        public: "你戴着耳机，背着书包，像个跟这趟车上任何人都没关系的局外人。",
        scene: { t: "当晚", b: "其实你从三站前就一直在偷瞄老钱。他下不下车、跟谁说话，你都记着。\n灯闪的时候，你的手正伸向他放在身边的那个包。" },
        secret: "老钱敲诈的下一个目标，是你身居要职、收了不该收的钱的父亲。你跟踪老钱上了车，想抢在他动手前偷走那个U盘，保住你的家。",
        mission: "拿到U盘，保护家人，别暴露你跟踪而来的事。",
      },
    ],
    stages: [
      { n: "第一幕 · 终点到站", d: "主持人朗读开场，列车员发现死者。玩家自我介绍（只说公开身份）。", clues: [0] },
      { n: "第二幕 · 封闭车厢", d: "确认这是一节没人上下的封闭车厢，凶手就在车上。展开第一轮搜证。", clues: [0, 1] },
      { n: "第三幕 · 把柄浮现", d: "死者身份与那些敲诈短信曝光，每个人的动机开始藏不住。", clues: [0, 1, 2] },
      { n: "第四幕 · U盘之争", d: "众人意识到消失的U盘是关键。全部线索解锁，投票指认凶手。", clues: [0, 1, 2, 3, 4] },
      { n: "终幕 · 复盘", d: "主持人公布真相，每位玩家亮出自己的秘密与目标完成情况。", clues: [0, 1, 2, 3, 4] },
    ],
    clues: [
      { h: "封闭的车厢", b: "末两站之间无人上下，车门记录显示中途未开。凶手一定还在这节车厢里。" },
      { h: "死因：勒杀", b: "死者颈部有明显勒痕，凶器是一条深色织物——纤维与铁路制服的围巾一致。" },
      { h: "群发的短信", b: "死者手机里有多条发出的敲诈短信，收件人备注潦草，却能和车上好几个人对上号。" },
      { h: "消失的U盘", b: "死者随身的包被翻动过，一截断掉的U盘挂绳还攥在他手里——U盘本体不翼而飞。" },
      { h: "三年前的站台", b: "一则旧新闻：三年前有青年在本线站台轻生，家属姓吴，曾到处控诉一个放贷的人逼死了他儿子。" },
    ],
  },

  /* ---------- 本 3：杀青夜 ---------- */
  crew: {
    title: "杀青夜",
    intro: "剧组杀青当晚，当红女主角死在化妆间。光鲜的片场，每个人都欠她一笔账。",
    roles: [
      {
        id: "director", name: "陈默", title: "导演", av: "🎬",
        public: "你是这部戏的导演，才华横溢却始终没能熬出头。杀青宴上你举杯笑着，心里堵得慌。",
        scene: { t: "当晚", b: "宴席间你去化妆间找林雪谈下一部戏的事，她正对着镜子卸妆，话说得很难听。\n你摔门出来，二十分钟后，有人尖叫化妆间出事了。" },
        secret: "这部戏让你成名的剧本，其实是你抄来的。林雪不知怎么拿到了证据，逼你把下一部的导筒让给别人，否则就公开。她手里那个U盘，是你的命门。",
        mission: "拿回或销毁那个U盘，保住你的名声。",
      },
      {
        id: "actor", name: "高扬", title: "男主角", av: "🕶️",
        public: "你是顶流小生，戏里戏外都是焦点。杀青宴上你被一群人围着敬酒，笑得疲惫。",
        scene: { t: "当晚", b: "你借口透气离了席，其实是去化妆间见林雪——你们有旧账要算。\n她冷笑着把你推出门。你回到宴席不久，出事了。" },
        secret: "你和林雪曾是恋人，分手后她攥着你出道前的黑料威胁你。今晚你去，是想求她、也想吓她，让她把东西交出来。你承认你恨她，但你说你没动手。",
        mission: "摆脱嫌疑，绝不能让那些黑料曝光。",
      },
      {
        id: "double", name: "苏苏", title: "替身演员", av: "🎭",
        public: "你给林雪做了三年替身，所有危险镜头都是你完成的，可镜头前的光永远属于她。没人记得你的名字。",
        scene: { t: "当晚", b: "你照例最后一个收拾道具。路过化妆间时，门虚掩着，里面飘出林雪那瓶你再熟悉不过的香水味。\n你站了很久，才走开。" },
        secret: "你查到一个被掩埋的真相：你和林雪是同父异母的姐妹，你是当年被抛弃的那个。她抢走的不只是镜头，还有本该属于你的人生。而你，比任何人都清楚她对什么过敏。",
        mission: "讨回属于你的真相与公道——以你选择的方式。",
      },
      {
        id: "producer", name: "老赵", title: "制片人", av: "💼",
        public: "你是管钱的制片人，剧组上上下下都得看你脸色。杀青宴是你张罗的，你忙着应酬各路投资人。",
        scene: { t: "当晚", b: "宴会中途你接了个电话，脸色不太好，去后台待了一会儿。\n你说你一直在打电话，没靠近过化妆间。" },
        secret: "你挪用了一大笔投资款填自己的窟窿，账目快瞒不住了。林雪偶然撞破，开始要挟你追加她的片酬，否则就捅给投资方。",
        mission: "掩盖财务窟窿，别让任何人查那本账。",
      },
      {
        id: "script", name: "小敏", title: "场记", av: "📋",
        public: "你是剧组打杂的场记，端茶递水、记场记板，存在感低到几乎透明。",
        scene: { t: "当晚", b: "你一直在化妆间附近收拾。出事前后，你都在走廊那头，手机举着。\n你说你什么都没看见——但你的手在抖。" },
        secret: "你偷偷给八卦媒体供料赚外快，今晚正蹲在化妆间外，拍下了案发前后进出那扇门的人影。另外，你暗恋高扬，不想看他出事。",
        mission: "保住你'线人'的身份，同时尽量替高扬开脱。",
      },
    ],
    stages: [
      { n: "第一幕 · 杀青宴", d: "主持人朗读开场，发现林雪死在化妆间。玩家自我介绍（只说公开身份）。", clues: [0] },
      { n: "第二幕 · 化妆间", d: "勘查现场，确认死亡时间与死因方向，展开第一轮讨论。", clues: [0, 1] },
      { n: "第三幕 · 各怀鬼胎", d: "每个人与死者的旧账浮出水面，动机一一显形。", clues: [0, 1, 2] },
      { n: "第四幕 · 门外的影子", d: "偷拍的照片与一份旧档案改变局势。全部线索解锁，投票指认凶手。", clues: [0, 1, 2, 3, 4] },
      { n: "终幕 · 复盘", d: "主持人公布真相，每位玩家亮出自己的秘密与目标完成情况。", clues: [0, 1, 2, 3, 4] },
    ],
    clues: [
      { h: "现场：镜前的人", b: "林雪倒在化妆镜前，妆才卸了一半。桌上一杯没喝完的香槟，化妆品摆得整整齐齐，不像有过打斗。" },
      { h: "死因：急性过敏", b: "并非外伤。死者死于急性过敏性休克，某样化妆品里被掺进了她严重过敏的成分——只有极亲近的人才知道她对什么过敏。" },
      { h: "消失的U盘", b: "林雪向来贴身收着一个U盘，里面据说存了不少人的把柄。案发后，U盘不见了。" },
      { h: "门外的照片", b: "有人在化妆间外偷拍：案发前后，先后有不止一个人影进出过那扇门，其中一个身形纤细、动作熟门熟路。" },
      { h: "被尘封的亲子档案", b: "一份旧档案显示：林雪有一个同父异母、自幼被送走的妹妹。年龄、籍贯，与剧组里某个最不起眼的人对得上。" },
    ],
  },
};

const DEFAULT_SCRIPT = "bohe";

function getScript(id) {
  return SCRIPTS[id] || SCRIPTS[DEFAULT_SCRIPT];
}

function visibleClues(S, stage) {
  if (stage < 0) return [];
  const openIdx = S.stages[stage].clues;
  return S.clues.map((c, i) => ({
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
    // ---- 本子目录（只给公开信息）----
    if (action === "catalog") {
      const list = Object.keys(SCRIPTS).map((id) => ({
        id,
        title: SCRIPTS[id].title,
        intro: SCRIPTS[id].intro,
        players: SCRIPTS[id].roles.length,
      }));
      return { ok: true, catalog: list };
    }

    // ---- 建房 ----
    if (action === "create") {
      const scriptId = SCRIPTS[event.script] ? event.script : DEFAULT_SCRIPT;
      let code = randCode();
      for (let i = 0; i < 6; i++) {
        const exist = await rooms.doc(code).get().catch(() => null);
        if (!exist || !exist.data) break;
        code = randCode();
      }
      await rooms.doc(code).set({
        data: {
          host: OPENID,
          script: scriptId,
          created: true,
          players: [],
          assignment: [],
          assigned: false,
          stage: -1,
          createdAt: db.serverDate(),
        },
      });
      return {
        ok: true,
        code,
        scriptId,
        scriptTitle: SCRIPTS[scriptId].title,
        maxPlayers: SCRIPTS[scriptId].roles.length,
      };
    }

    // ---- 以下都需要房号 ----
    const code = event.code;
    const res = await rooms.doc(code).get().catch(() => null);
    if (!res || !res.data) return { ok: false, error: "房间不存在或已过期" };
    const data = res.data;
    const S = getScript(data.script);

    // 玩家进房（同一人重复进房幂等）
    if (action === "join") {
      if (data.assigned) return { ok: false, error: "游戏已开始，无法加入" };
      if (data.players.find((p) => p.openid === OPENID)) {
        return { ok: true, rejoined: true };
      }
      if (data.players.length >= S.roles.length) return { ok: false, error: "房间已满" };
      const name = (event.name || "玩家").slice(0, 12);
      await rooms.doc(code).update({
        data: { players: _.push([{ openid: OPENID, name }]) },
      });
      return { ok: true };
    }

    // 随机分配（仅主持人）
    if (action === "assign") {
      if (data.host !== OPENID) return { ok: false, error: "只有主持人能分配角色" };
      if (data.assigned) return { ok: false, error: "已经分配过了" };
      if (data.players.length !== S.roles.length)
        return { ok: false, error: "需要正好 " + S.roles.length + " 人才能开局" };
      const ids = S.roles.map((r) => r.id);
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
      const role = S.roles.find((r) => r.id === mine.roleId);
      const player = data.players.find((p) => p.openid === OPENID);
      return { ok: true, playerName: player && player.name, role, scriptTitle: S.title };
    }

    // 公共状态（绝不含秘密）
    if (action === "state") {
      return {
        ok: true,
        state: {
          scriptTitle: S.title,
          playerCount: data.players.length,
          maxPlayers: S.roles.length,
          players: data.players.map((p) => ({ name: p.name })),
          assigned: data.assigned,
          stage: data.stage,
          stageInfo: data.stage >= 0 ? S.stages[data.stage] : null,
          totalStages: S.stages.length,
          clues: visibleClues(S, data.stage),
          isHost: data.host === OPENID,
          joined: !!data.players.find((p) => p.openid === OPENID),
        },
      };
    }

    // 主持人推进/回退阶段
    if (action === "stage") {
      if (data.host !== OPENID) return { ok: false, error: "只有主持人能控场" };
      let stage = data.stage;
      if (event.dir === "next" && stage < S.stages.length - 1) stage++;
      if (event.dir === "prev" && stage > -1) stage--;
      await rooms.doc(code).update({ data: { stage } });
      return { ok: true, stage };
    }

    return { ok: false, error: "未知操作" };
  } catch (e) {
    return { ok: false, error: "服务器错误：" + e.message };
  }
};
