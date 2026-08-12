const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const IS_VERCEL = !!process.env.VERCEL;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ==================== 数据读写 ====================
// Vercel 用内存存储（serverless 无文件系统），本地用 JSON 文件
let memStore = null;

function readData() {
  if (IS_VERCEL) {
    if (!memStore) memStore = getDefaultData();
    return JSON.parse(JSON.stringify(memStore));
  }
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) { console.error('读取数据失败', e); }
  return getDefaultData();
}

function writeData(data) {
  if (IS_VERCEL) {
    memStore = JSON.parse(JSON.stringify(data));
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getDefaultData() {
  return {
    adminPassword: 'admin123',
    sessions: [],
    published: {}  // { shortCode: { sessionId, createdAt } }
  };
}

// 初始化数据文件
if (!fs.existsSync(DATA_FILE)) {
  writeData(getDefaultData());
}

// ==================== 工具函数 ====================
function generateCode() {
  return crypto.randomBytes(4).toString('hex'); // 8位短码
}

// ==================== API 路由 ====================

// --- 登录 ---
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const data = readData();
  if (password === data.adminPassword) {
    res.json({ success: true, token: 'admin' });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

// --- 修改密码 ---
app.put('/api/password', (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const data = readData();
  if (oldPassword !== data.adminPassword) {
    return res.status(401).json({ success: false, message: '旧密码错误' });
  }
  if (!newPassword) {
    return res.status(400).json({ success: false, message: '新密码不能为空' });
  }
  data.adminPassword = newPassword;
  writeData(data);
  res.json({ success: true });
});

// --- 获取所有轮次 ---
app.get('/api/sessions', (req, res) => {
  const data = readData();
  res.json({ success: true, sessions: data.sessions });
});

// --- 创建轮次 ---
app.post('/api/sessions', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: '请输入轮次名称' });
  }
  const data = readData();
  const session = {
    id: 's' + Date.now(),
    name: name.trim(),
    prizes: [],
    participants: [],
    records: []
  };
  data.sessions.push(session);
  writeData(data);
  res.json({ success: true, session });
});

// --- 更新轮次（奖项、参与者） ---
app.put('/api/sessions/:id', (req, res) => {
  const data = readData();
  const session = data.sessions.find(s => s.id === req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, message: '轮次不存在' });
  }
  const { name, prizes, participants, records } = req.body;
  if (name !== undefined) session.name = name;
  if (prizes !== undefined) session.prizes = prizes;
  if (participants !== undefined) session.participants = participants;
  if (records !== undefined) session.records = records;
  writeData(data);
  res.json({ success: true, session });
});

// --- 删除轮次 ---
app.delete('/api/sessions/:id', (req, res) => {
  const data = readData();
  const idx = data.sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: '轮次不存在' });
  }
  data.sessions.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// --- 重置所有数据 ---
app.post('/api/reset', (req, res) => {
  writeData(getDefaultData());
  res.json({ success: true });
});

// --- 发布轮次（生成短链接） ---
app.post('/api/sessions/:id/publish', (req, res) => {
  const data = readData();
  const session = data.sessions.find(s => s.id === req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, message: '轮次不存在' });
  }
  if (session.prizes.length === 0) {
    return res.status(400).json({ success: false, message: '请先添加奖项' });
  }
  if (session.participants.length === 0) {
    return res.status(400).json({ success: false, message: '请先添加参与者' });
  }

  // 生成短码
  const code = generateCode();
  data.published[code] = {
    sessionId: session.id,
    createdAt: new Date().toISOString()
  };
  writeData(data);

  res.json({
    success: true,
    code,
    url: `${req.protocol}://${req.get('host')}/draw/${code}`
  });
});

// --- 抽奖页面：获取轮次数据 ---
app.get('/api/draw/:code', (req, res) => {
  const data = readData();
  const pub = data.published[req.params.code];
  if (!pub) {
    return res.status(404).json({ success: false, message: '抽奖链接无效或已过期' });
  }
  const session = data.sessions.find(s => s.id === pub.sessionId);
  if (!session) {
    return res.status(404).json({ success: false, message: '轮次不存在' });
  }
  res.json({
    success: true,
    session: {
      name: session.name,
      prizes: session.prizes,
      participants: session.participants,
      records: session.records
    }
  });
});

// --- 执行抽奖 ---
app.post('/api/draw/:code', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: '请输入姓名' });
  }

  const data = readData();
  const pub = data.published[req.params.code];
  if (!pub) {
    return res.status(404).json({ success: false, message: '抽奖链接无效' });
  }
  const session = data.sessions.find(s => s.id === pub.sessionId);
  if (!session) {
    return res.status(404).json({ success: false, message: '轮次不存在' });
  }

  // 检查参与者
  const participant = session.participants.find(p => p.name === name.trim());
  if (!participant) {
    return res.status(400).json({ success: false, message: '你的姓名不在参与者名单中' });
  }
  if (participant.drawn) {
    const record = session.records.find(r => r.name === name.trim());
    return res.json({
      success: true,
      alreadyDrawn: true,
      prize: record ? record.prize : null,
      message: '你已经参与过本轮抽奖'
    });
  }

  // 可用奖品
  const available = session.prizes.filter(p => p.remaining > 0);
  if (available.length === 0) {
    return res.status(400).json({ success: false, message: '所有奖品已被抽完' });
  }

  // 按权重随机
  const totalWeight = available.reduce((s, p) => s + p.weight, 0);
  let rand = Math.random() * totalWeight;
  let selected = available[0];
  for (const p of available) {
    rand -= p.weight;
    if (rand <= 0) { selected = p; break; }
  }

  // 更新数据
  selected.remaining--;
  participant.drawn = true;
  session.records.push({
    name: name.trim(),
    prize: selected.name,
    time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  });
  writeData(data);

  res.json({
    success: true,
    alreadyDrawn: false,
    prize: selected.name
  });
});

// ==================== 前端页面路由 ====================

// 管理后台
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// 参与者抽奖页面（带短码）
app.get('/draw/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 兼容旧链接
app.get('/draw', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 首页重定向
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// 健康检查（CloudRun 需要）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ==================== 启动 ====================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🎰 抽奖服务已启动`);
    console.log(`   管理后台: http://localhost:${PORT}/admin`);
    console.log(`   数据文件: ${DATA_FILE}`);
    console.log(`   默认密码: admin123`);
  });
}

module.exports = app;
