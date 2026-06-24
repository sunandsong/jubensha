/**
 * 薄荷镇剧本杀 · 首页逻辑（小程序版）
 * 一个页面用 phase 切换三种视图：entry（入口）/ host（主持人）/ player（玩家）。
 * 所有数据走云函数 game，轮询 state 同步。
 */

// 调用云函数的小封装
function call(action, data) {
  return wx.cloud
    .callFunction({ name: "game", data: Object.assign({ action }, data || {}) })
    .then((res) => {
      const r = res.result || {};
      if (!r.ok) throw new Error(r.error || "请求失败");
      return r;
    });
}

function toast(title) {
  wx.showToast({ title, icon: "none", duration: 2000 });
}

Page({
  data: {
    phase: "entry", // entry | host | player

    // 入口
    catalog: [], // 本子目录 [{id,title,intro,players}]
    joinCode: "",
    joinName: "",

    // 主持人
    scriptTitle: "",
    hostCode: "",
    hostCodeSpaced: "",
    seats: [],
    seatCount: 0,
    maxPlayers: 5,
    canAssign: false,
    assigned: false,
    flow: null, // { pips:[], name, desc }

    // 玩家
    waiting: true,
    waitInfo: "房间里已有 0 人……",
    role: null, // { av, name, title, public, scene:{t,b}, secret, mission }
    pFlow: null,
    clues: [],
  },

  onLoad() {
    // 拉取本子目录
    call("catalog")
      .then((r) => this.setData({ catalog: r.catalog }))
      .catch((e) => toast(e.message));
  },

  onUnload() {
    this._stopPoll();
  },
  onHide() {
    this._stopPoll();
  },

  _stopPoll() {
    if (this._poll) {
      clearInterval(this._poll);
      this._poll = null;
    }
  },

  /* ---------- 输入 ---------- */
  onJoinCode(e) {
    this.setData({ joinCode: e.detail.value });
  },
  onJoinName(e) {
    this.setData({ joinName: e.detail.value });
  },

  /* ---------- 主持人 ---------- */
  async hostCreate(e) {
    const script = e.currentTarget.dataset.id; // 选中的本子 id
    wx.showLoading({ title: "建房中…" });
    try {
      const r = await call("create", { script });
      wx.hideLoading();
      this.setData({
        phase: "host",
        scriptTitle: r.scriptTitle,
        hostCode: r.code,
        hostCodeSpaced: r.code.split("").join(" "),
        maxPlayers: r.maxPlayers,
      });
      this._startPoll(() => this.hostRefresh());
      this.hostRefresh();
    } catch (e) {
      wx.hideLoading();
      toast(e.message);
    }
  },

  async hostRefresh() {
    if (!this.data.hostCode) return;
    try {
      const { state: s } = await call("state", { code: this.data.hostCode });
      const seats = [];
      for (let i = 0; i < s.maxPlayers; i++) {
        const p = s.players[i];
        seats.push(
          p
            ? { filled: true, name: p.name, info: s.assigned ? "已分配" : "已进房" }
            : { filled: false, name: "空位 " + (i + 1), info: "等待进房" }
        );
      }
      this.setData({
        seats,
        seatCount: s.playerCount,
        maxPlayers: s.maxPlayers,
        canAssign: s.playerCount === s.maxPlayers && !s.assigned,
        assigned: s.assigned,
        flow: s.assigned ? this._flow(s) : null,
      });
    } catch (e) {
      toast(e.message);
    }
  },

  async hostAssign() {
    try {
      await call("assign", { code: this.data.hostCode });
      toast("角色已随机分配！");
      this.hostRefresh();
    } catch (e) {
      toast(e.message);
    }
  },

  hostNext() {
    this._hostStage("next");
  },
  hostPrev() {
    this._hostStage("prev");
  },
  async _hostStage(dir) {
    try {
      await call("stage", { code: this.data.hostCode, dir });
      this.hostRefresh();
    } catch (e) {
      toast(e.message);
    }
  },

  copyCode() {
    wx.setClipboardData({
      data: this.data.hostCode,
      success: () => toast("房号已复制，发到群里吧"),
    });
  },

  /* ---------- 玩家 ---------- */
  async playerJoin() {
    const code = (this.data.joinCode || "").trim();
    const name = (this.data.joinName || "").trim() || "玩家";
    if (!/^\d{4}$/.test(code)) {
      toast("请输入 4 位房号");
      return;
    }
    wx.showLoading({ title: "进房中…" });
    try {
      await call("join", { code, name });
      wx.hideLoading();
      this._myRoom = code;
      this._gotRole = false;
      this.setData({ phase: "player", waiting: true, role: null });
      this._startPoll(() => this.playerRefresh());
      this.playerRefresh();
    } catch (e) {
      wx.hideLoading();
      toast(e.message);
    }
  },

  async playerRefresh() {
    if (!this._myRoom) return;
    try {
      const { state: s } = await call("state", { code: this._myRoom });
      this.setData({
        scriptTitle: s.scriptTitle,
        waitInfo: "房间里已有 " + s.playerCount + " / " + s.maxPlayers + " 人……",
      });
      if (s.assigned && !this._gotRole) {
        const r = await call("myRole", { code: this._myRoom });
        this._gotRole = true;
        this.setData({ waiting: false, role: r.role });
      }
      if (this._gotRole) {
        this.setData({ pFlow: this._flow(s), clues: s.clues });
      }
    } catch (e) {
      toast(e.message);
    }
  },

  /* ---------- 公共 ---------- */
  _startPoll(fn) {
    this._stopPoll();
    this._poll = setInterval(fn, 1500);
  },

  // 把 state 里的阶段信息整理成进度条展示用结构
  _flow(s) {
    const pips = [];
    for (let i = 0; i < s.totalStages; i++) {
      pips.push({ done: i < s.stage, cur: i === s.stage });
    }
    return {
      pips,
      name: s.stage < 0 ? "尚未开始" : s.stageInfo.n,
      desc: s.stage < 0 ? "等待主持人开始第一幕" : s.stageInfo.d,
    };
  },
});
