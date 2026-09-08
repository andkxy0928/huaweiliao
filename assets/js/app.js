/* 花未了：Canvas 物理互动、随机语音与本地状态。 */
(() => {
'use strict';
/* ============================================================
   花未了 —— 未花头像互动
   物理：甩杆(指针) → 绳系头像(质点, 重力+弹性绳+阻力)
   语音：assets/Audio 内的三段录音随机逐条播放，飘字与当前语音同步
   ============================================================ */

// roundRect 需 Safari 16+/Chrome 99+，旧内核补一个 arcTo 实现避免整页崩掉
if(!('roundRect' in CanvasRenderingContext2D.prototype)){
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r){
    r = Math.min(Math.abs(+r) || 0, w/2, h/2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const FONT = '"Segoe UI","Microsoft YaHei",sans-serif';
const config = window.HWL_CONFIG;

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;

/* ---------- 玩具参数 ---------- */
let ROPE_LEN = 150;       // 绳长 px（随屏幕尺寸调整）
let AUTO_R   = 58;        // 自动甩画圈半径（随屏幕尺寸调整）
const ROPE_K   = 2600;    // 绳弹性 (加速度/px)
const ROPE_D   = 14;      // 绳径向阻尼
const GRAV     = 1150;    // 重力 px/s^2
const AIR_DRAG = 0.35;    // 空气阻力系数

/* ---------- 状态 ---------- */
const stick  = { x: 0, y: 0 };            // 甩杆杆梢
const target = { x: 0, y: 0 };            // 指针目标
const tube   = { x: 0, y: 0, vx: 0, vy: 0 }; // 头像(质点)
const pointer = { down: false, id: null, lift: 0 };  // lift: 触摸时锚点上移量
const auto = { on: false, rps: 0, phase: 0, cx: 0, cy: 0 };
let interacted = false;                   // 玩家是否已上手

function recenterToy(){
  target.x = stick.x = W*(W > 900 ? 0.59 : 0.5);
  target.y = stick.y = H*(H < 560 ? 0.30 : 0.38);
  tube.x = stick.x + 8;
  tube.y = stick.y + ROPE_LEN*0.92;
  tube.vx = 34; tube.vy = 0;
  prevTheta = Math.atan2(tube.y - stick.y, tube.x - stick.x);
}

let theta = 0, prevTheta = 0, omega = 0;  // 绳方向角与角速度
let ropeDist = ROPE_LEN, taut = 0;
let rps = 0, drive = 0, active = 0;       // 声音驱动量 0~1
let singTime = 0, hintGone = false;
let swinging = false, stillTime = 0;      // 甩动表情状态；停稳后恢复
let revAccum = 0;                         // 手动甩的角度累计(每 2π 记一圈)
let needSoundTime = 0;                    // "想出声却出不了"的持续时长

/* ---------- 头像与响应式画布 ---------- */
let stickGrad = null;
const portraits = {};
for(const [name, src] of Object.entries(config.portraits)){
  const img = new Image();
  img.src = src;
  portraits[name] = img;
}
function resize(){
  if(!(window.innerWidth > 0 && window.innerHeight > 0)) return;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W*DPR; cv.height = H*DPR;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const minDim = Math.min(W, H);
  ROPE_LEN = Math.min(clamp(minDim*0.26, 70, 150), Math.max(58, (H - 230)*0.28));
  AUTO_R = clamp(ROPE_LEN*0.39, 26, 58);
  if(!interacted) recenterToy();
  else {
    target.x = clamp(target.x, 24, W - 24);
    target.y = clamp(target.y, 80, Math.max(100, H - 180));
  }
  if(auto.on){
    auto.cx = clamp(auto.cx, W*0.28, W*0.72);
    auto.cy = clamp(auto.cy, H*0.26, H*0.55);
  }
}

/* ============================================================
   语音 —— 原速随机播放，保留本地 file:// 直接打开的能力
   ============================================================ */
const AUDIO_CLIPS = config.audioFiles.map(filename => ({
  name: filename.replace(/\.[^.]+$/, ''),
  src: config.audioDirectory + encodeURIComponent(filename)
}));
const voicePlayer = new Audio();
voicePlayer.preload = 'auto';
voicePlayer.src = AUDIO_CLIPS[0].src;
voicePlayer.volume = 0.85;
let audioMuted = false;
try{ audioMuted = localStorage.getItem('hwl_muted') === '1'; }catch(_){}
voicePlayer.setAttribute('playsinline', '');
let audioUnlocked = false, audioBlocked = false;
let audioPriming = false, audioPending = false, voicePlaying = false;
let currentClip = null, lastClip = null, playbackToken = 0, retryAfter = 0;
const failedClips = new Set();

function clearVoiceCaption(){
  voicePlaying = false;
  cries.length = 0;
}

function stopAudio(){
  playbackToken++;                       // 失效的 play() 回调不能恢复旧语音/旧字幕
  voicePlayer.pause();
  try{ voicePlayer.currentTime = 0; }catch(_){}
  voicePlayer.muted = false;
  audioPriming = audioPending = false;
  currentClip = null;
  clearVoiceCaption();
}

function handleAudioError(error, token){
  if(token !== playbackToken) return;
  const failedClip = currentClip;
  stopAudio();
  if(error && error.name === 'NotAllowedError'){
    audioBlocked = true;
    audioUnlocked = false;
  }else if(!error || error.name !== 'AbortError'){
    if(failedClip) failedClips.add(failedClip.name);
    retryAfter = performance.now() + 500;
  }
}

function startRandomVoice(){
  let choices = AUDIO_CLIPS.filter(clip => !failedClips.has(clip.name));
  if(choices.length > 1) choices = choices.filter(clip => clip.name !== lastClip);
  if(!choices.length) return;
  currentClip = choices[Math.floor(Math.random()*choices.length)];
  lastClip = currentClip.name;
  const token = ++playbackToken;
  audioPending = true;
  clearVoiceCaption();
  voicePlayer.muted = false;
  voicePlayer.src = currentClip.src;
  voicePlayer.playbackRate = 1;          // 人声保持原速，不跟随转速变调
  voicePlayer.play().then(() => {
    if(token !== playbackToken) return;
    audioPending = false;
    audioUnlocked = true;
    audioBlocked = false;
  }).catch(error => handleAudioError(error, token));
}

function ensureAudio(fromGesture){
  if(document.hidden || audioMuted) return;
  if(fromGesture){
    audioBlocked = false;
    if(failedClips.size === AUDIO_CLIPS.length) failedClips.clear();
  }
  if(swinging){ updateAudio(); return; }
  if(!fromGesture || audioUnlocked || audioPriming || audioPending) return;
  // 首次点击/触摸时静音启动并暂停同一个播放器，后续换片沿用已解锁的元素。
  const token = ++playbackToken;
  audioPriming = true;
  voicePlayer.muted = true;
  voicePlayer.play().then(() => {
    if(token !== playbackToken) return;
    stopAudio();
    audioUnlocked = true;
    audioBlocked = false;
    updateAudio();
  }).catch(error => handleAudioError(error, token));
}

function updateAudio(){
  if(document.hidden || audioMuted){ if(currentClip || audioPriming) stopAudio(); return; }
  if(audioPriming) return;
  if(!swinging){ if(currentClip) stopAudio(); return; }
  if(audioBlocked || audioPending || currentClip || performance.now() < retryAfter) return;
  startRandomVoice();
}

// 字幕只在实际开始播放时出现，加载、缓冲和暂停时不产生错配的飘字。
voicePlayer.addEventListener('playing', () => {
  if(audioPriming || !currentClip || document.hidden) return;
  voicePlaying = true;
  cries.length = 0;
  cryTimer = 0;
});
voicePlayer.addEventListener('waiting', clearVoiceCaption);
voicePlayer.addEventListener('pause', () => {
  clearVoiceCaption();
  if(currentClip && !audioPending && !audioPriming && !voicePlayer.ended){
    currentClip = null;
    retryAfter = performance.now() + 250;
  }
});
voicePlayer.addEventListener('ended', () => {
  currentClip = null;
  audioPending = false;
  clearVoiceCaption();
  updateAudio();                         // 持续甩动时再随机选下一条，不叠加播放
});
voicePlayer.addEventListener('error', () => {
  if(currentClip || audioPriming) handleAudioError(voicePlayer.error, playbackToken);
});

/* ============================================================
   物理
   ============================================================ */
function physStep(h){
  const dx = tube.x - stick.x, dy = tube.y - stick.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const ux = dx/d, uy = dy/d;
  let ax = 0, ay = GRAV;
  if(d > ROPE_LEN){                       // 绳只拉不推
    const vrad = tube.vx*ux + tube.vy*uy;
    const f = -ROPE_K*(d - ROPE_LEN) - ROPE_D*vrad;
    ax += f*ux; ay += f*uy;
  }
  ax -= AIR_DRAG*tube.vx;
  ay -= AIR_DRAG*tube.vy;
  tube.vx += ax*h; tube.vy += ay*h;
  tube.x += tube.vx*h; tube.y += tube.vy*h;
}

function update(dt){
  // 甩杆目标：手动指针 / 自动画圈 / 甩手机体感
  if(auto.on){
    auto.rps += (3.4 - auto.rps)*Math.min(1, dt*1.1);
    auto.phase += auto.rps*TAU*dt;
    target.x = auto.cx + AUTO_R*Math.cos(auto.phase);
    target.y = auto.cy + AUTO_R*Math.sin(auto.phase);
  }else{
    auto.rps *= Math.max(0, 1 - dt*3);
    if(motion.on && !pointer.down){
      // 开了体感却收不到传感器事件(权限/环境问题)，2.5s 后自动退出并提示
      if(!motion.gotEvent && performance.now() - motion.enabledAt > 2500){
        setMotion(false);
        flashBtn(motionBtn, '不可用');
      }else{
        const cx = W*0.5, cy = H*0.42;
        const R = Math.min(W, H)*0.22;
        target.x = clamp(cx + motion.ax*16, cx - R, cx + R);
        target.y = clamp(cy - motion.ay*16, cy - R, cy + R);
      }
    }
  }
  const k = 1 - Math.exp(-dt*26);
  stick.x += (target.x - stick.x)*k;
  stick.y += (target.y - stick.y)*k;

  // 定步长积分
  let acc = dt;
  const h = 1/240;
  while(acc > 1e-6){ const s = Math.min(h, acc); physStep(s); acc -= s; }

  // 角速度(发声核心)：绳方向的转动快慢
  theta = Math.atan2(tube.y - stick.y, tube.x - stick.x);
  let dth = theta - prevTheta;
  while(dth >  Math.PI) dth -= TAU;
  while(dth < -Math.PI) dth += TAU;
  omega += (dth/dt - omega)*Math.min(1, dt*9);
  prevTheta = theta;
  rps = Math.abs(omega)/TAU;

  // 手动甩出的圈数计入圈数——自动甩不算数
  if(!auto.on && active > 0.3){
    revAccum += Math.abs(dth);
    if(revAccum >= TAU){
      const n = Math.floor(revAccum/TAU);
      revAccum -= n*TAU;
      addTurns(n);
    }
  }else{
    revAccum = 0;
  }

  ropeDist = Math.hypot(tube.x - stick.x, tube.y - stick.y);
  taut = clamp((ropeDist/ROPE_LEN - 0.88)/0.12, 0, 1);
  drive = clamp((rps - 1.1)/2.6, 0, 1);
  const tgt = Math.pow(drive, 1.25)*taut;
  active += (tgt - active)*Math.min(1, dt*(tgt > active ? 10 : 3.2));

  // 用实际运动判断表情，初始的轻微自然晃动不算甩动。
  // 起停使用不同阈值，并留 0.45s 缓冲，避免经过摆动端点时表情闪烁。
  const speed = Math.hypot(tube.vx, tube.vy);
  const moving = interacted && (rps > (swinging ? 0.15 : 0.3) || speed > (swinging ? 55 : 100));
  if(moving){
    swinging = true;
    stillTime = 0;
  }else if(swinging){
    stillTime += dt;
    if(stillTime > 0.45) swinging = false;
  }
  updateAudio();

  if(swinging && !audioMuted && audioBlocked) needSoundTime += dt;
  else needSoundTime = 0;

  stEls.mineWrap.classList.toggle('hot', active > 0.3);
  if(active > 0.3){
    singTime += dt;
    if(!hintGone && singTime > 1.0){
      hintGone = true;
      document.getElementById('hint').classList.add('gone');
    }
  }
  spawnFx(dt);
}

/* ============================================================
   视觉特效粒子
   ============================================================ */
const ripples = [];   // 声波涟漪
const cries = [];     // 飘出的当前语音名称
const trail = [];     // 头像运动轨迹
let rippleTimer = 0, cryTimer = 0;

function spawnFx(dt){
  trail.unshift({ x: tube.x, y: tube.y });
  if(trail.length > 16) trail.pop();

  rippleTimer -= dt; cryTimer -= dt;
  if(active > 0.15 && rippleTimer <= 0){
    rippleTimer = 0.09;
    ripples.push({ x: tube.x, y: tube.y, r: 16, age: 0, life: 0.7, str: active });
  }
  if(voicePlaying && currentClip && !voicePlayer.paused && cryTimer <= 0 && cries.length < 8){
    cryTimer = 0.65;
    const ux = (tube.x - stick.x)/(ropeDist || 1);
    const uy = (tube.y - stick.y)/(ropeDist || 1);
    const sgn = omega >= 0 ? 1 : -1;
    // 切向飞出
    const tx = -uy*sgn, ty = ux*sgn;
    const sp = 90 + Math.random()*60;
    cries.push({
      x: tube.x + ux*14, y: tube.y + uy*14,
      vx: tx*sp + ux*30, vy: ty*sp + uy*30 - 20,
      age: 0, life: 1.5,
      text: currentClip.name,
      size: clamp(W*0.05, 18, 26) + 6*active,
      rot: (Math.random() - 0.5)*0.45
    });
  }
  for(let i = ripples.length - 1; i >= 0; i--){
    const p = ripples[i];
    p.age += dt; p.r += (200 + 160*p.str)*dt;
    if(p.age >= p.life) ripples.splice(i, 1);
  }
  for(let i = cries.length - 1; i >= 0; i--){
    const p = cries[i];
    p.age += dt;
    p.x += p.vx*dt; p.y += p.vy*dt;
    p.vx *= (1 - dt*1.2); p.vy = p.vy*(1 - dt*1.2) - 26*dt;
    if(p.age >= p.life) cries.splice(i, 1);
  }
}

/* ============================================================
   绘制
   ============================================================ */
function draw(now, dt){
  ctx.clearRect(0, 0, W, H);
  // 声波涟漪
  for(const p of ripples){
    const t = p.age/p.life;
    ctx.globalAlpha = (1 - t)*0.35*p.str;
    ctx.strokeStyle = '#c1f4ff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 运动残影：渐隐光点（高速下连线会成折线，点更好看）
  const spNorm = clamp(rps/4, 0, 1);
  if(spNorm > 0.05 && trail.length > 2){
    ctx.fillStyle = '#a7ecff';
    for(let i = 1; i < trail.length; i++){
      const f = 1 - i/trail.length;
      ctx.globalAlpha = f*0.3*spNorm;
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, 1.5 + 3.5*f, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawToy(now);

  // 飘出的语音名称
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for(const p of cries){
    const t = p.age/p.life;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot*t);
    ctx.globalAlpha = (1 - t)*(1 - t)*0.95;
    ctx.font = `${(p.size*(1 + 0.5*t)).toFixed(1)}px ${FONT}`;
    ctx.shadowColor = 'rgba(22,83,173,0.7)';
    ctx.shadowBlur = 18*(1 - t);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(23,61,105,0.65)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(p.text, 0, 0, W*0.7);
    ctx.fillText(p.text, 0, 0, W*0.7);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  ctx.globalAlpha = 1;

}

function drawToy(now){
  const dx = tube.x - stick.x, dy = tube.y - stick.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const ux = dx/d, uy = dy/d;

  // 连接线：松则垂，紧则直。
  ctx.strokeStyle = 'rgba(190,239,255,0.95)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(stick.x, stick.y);
  if(d < ROPE_LEN*0.97){
    const sag = (ROPE_LEN - d)*0.55;
    ctx.quadraticCurveTo((stick.x + tube.x)/2, (stick.y + tube.y)/2 + sag, tube.x, tube.y);
  }else{
    ctx.lineTo(tube.x, tube.y);
  }
  ctx.stroke();

  // 甩杆沿用原来的物理锚点，配色改为冰蓝。
  const sa = 1.15;                 // 杆的固定倾角
  const sdx = Math.cos(sa), sdy = Math.sin(sa);
  ctx.save();
  ctx.translate(stick.x, stick.y);
  if(!stickGrad){
    stickGrad = ctx.createLinearGradient(0, 0, sdx*88, sdy*88);
    stickGrad.addColorStop(0, '#f4fdff'); stickGrad.addColorStop(1, '#57bce8');
  }
  ctx.strokeStyle = stickGrad;
  ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sdx*8, sdy*8);
  ctx.lineTo(sdx*88, sdy*88);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sdx*12 - sdy*1.4, sdy*12 + sdx*1.4);
  ctx.lineTo(sdx*76 - sdy*1.4, sdy*76 + sdx*1.4);
  ctx.stroke();
  // 锚点
  const bead = (bx, by, r) => {
    ctx.fillStyle = '#3ac8f5';
    ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(bx - r*0.3, by - r*0.35, r*0.32, 0, TAU); ctx.fill();
  };
  bead(sdx*14, sdy*14, 4.6);
  bead(sdx*4,  sdy*4,  6);
  ctx.restore();

  // 头像随绳方向甩动：不动 mika1，甩动 mika2；保持原图比例。
  const portrait = portraits[swinging ? 'mika2' : 'mika1'];
  if(!portrait.complete || !portrait.naturalWidth) return;
  const height = Math.min(clamp(Math.min(W, H)*0.25, 76, 122), H*0.2);
  const width = height*portrait.naturalWidth/portrait.naturalHeight;
  ctx.save();
  ctx.translate(tube.x, tube.y);
  ctx.rotate(Math.atan2(uy, ux) - Math.PI/2);
  ctx.drawImage(portrait, -width/2, -height*0.12, width, height);
  ctx.restore();
}

/* ============================================================
   主循环 & 交互
   ============================================================ */
let last = performance.now();
let hudTimer = 0;
const rpsEl = document.getElementById('rps');
const autoBtn = document.getElementById('autoBtn');

function frame(now){
  // 有些嵌入环境不派发 resize 事件，每帧自查尺寸变化（0 尺寸视为瞬态，忽略）
  if(window.innerWidth > 0 &&
     (window.innerWidth !== W || window.innerHeight !== H)) resize();
  const dt = Math.min(0.05, (now - last)/1000) || 0.016;
  last = now;
  update(dt);
  draw(now/1000, dt);
  hudTimer -= dt;
  if(hudTimer <= 0){
    hudTimer = 0.15;
    rpsEl.textContent = rps.toFixed(1);
    syncUnlock();
    syncHud();
  }
  requestAnimationFrame(frame);
}

function setAuto(on){
  auto.on = on;
  autoBtn.classList.toggle('on', on);
  autoBtn.setAttribute('aria-pressed', String(on));
  autoBtn.textContent = on ? '停一停' : '自动甩';
  if(on){
    interacted = true;
    if(motion.on) setMotion(false);
    auto.cx = clamp(stick.x, W*0.28, W*0.72);
    auto.cy = clamp(stick.y, H*0.26, H*0.6);
    auto.phase = Math.atan2(stick.y - auto.cy, stick.x - auto.cx);
    ensureAudio(true);
  }
}

autoBtn.addEventListener('click', e => {
  e.stopPropagation();
  setAuto(!auto.on);
});

/* —— 甩手机体感模式：握住手机划圈，重力方向在机身坐标里转动 —— */
const motion = { on: false, ax: 0, ay: 0, bx: 0, by: 0,
                 handler: null, gotEvent: false, enabledAt: 0 };
const motionBtn = document.getElementById('motionBtn');
// devicemotion 只在安全上下文(HTTPS/file)派发，http 下不显示按钮免得点了没反应
if(typeof DeviceMotionEvent !== 'undefined' && 'ontouchstart' in window && window.isSecureContext){
  motionBtn.style.display = '';
}

function flashBtn(btn, text){
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = '甩手机'; btn.disabled = false; }, 1600);
}

async function setMotion(on){
  if(on && typeof DeviceMotionEvent !== 'undefined'
        && typeof DeviceMotionEvent.requestPermission === 'function'){
    try{
      const r = await DeviceMotionEvent.requestPermission();  // iOS 需授权
      if(r !== 'granted'){ flashBtn(motionBtn, '未授权'); return; }
    }catch(_){ flashBtn(motionBtn, '未授权'); return; }
  }
  motion.on = on;
  motionBtn.classList.toggle('on', on);
  motionBtn.setAttribute('aria-pressed', String(on));
  motionBtn.textContent = on ? '停一停' : '甩手机';
  if(on){
    interacted = true;
    if(auto.on) setAuto(false);
    ensureAudio(true);
    motion.ax = motion.ay = motion.bx = motion.by = 0;
    motion.gotEvent = false;
    motion.enabledAt = performance.now();
    if(!motion.handler){
      motion.handler = e => {
        const g = e.accelerationIncludingGravity;
        if(!g || g.x == null) return;
        motion.gotEvent = true;
        // 慢基线滤掉静止重力，留下随挥舞转动的分量
        motion.bx += (g.x - motion.bx)*0.02;
        motion.by += (g.y - motion.by)*0.02;
        motion.ax += ((g.x - motion.bx) - motion.ax)*0.35;
        motion.ay += ((g.y - motion.by) - motion.ay)*0.35;
      };
    }
    window.addEventListener('devicemotion', motion.handler);
  }else if(motion.handler){
    window.removeEventListener('devicemotion', motion.handler);
  }
}
motionBtn.addEventListener('click', e => {
  e.stopPropagation();
  setMotion(!motion.on);
});

cv.addEventListener('pointerdown', e => {
  if(pointer.down) return;                 // 已有手指在甩，忽略误触的第二指
  pointer.down = true;
  pointer.id = e.pointerId;
  // 拇指按住时玩具画在指尖正下会被手挡住，触摸输入把锚点抬到指尖上方
  pointer.lift = e.pointerType === 'touch' ? Math.min(110, ROPE_LEN*0.9) : 0;
  interacted = true;
  cv.classList.add('holding');
  cv.setPointerCapture(e.pointerId);
  if(auto.on) setAuto(false);
  target.x = e.clientX;
  target.y = Math.max(12, e.clientY - pointer.lift);
  ensureAudio(true);
});
cv.addEventListener('pointermove', e => {
  if(!pointer.down || e.pointerId !== pointer.id) return;
  target.x = e.clientX;
  target.y = Math.max(12, e.clientY - pointer.lift);
});
function release(e){
  if(pointer.down && e && e.pointerId !== pointer.id) return;
  pointer.down = false;
  pointer.id = null;
  cv.classList.remove('holding');
  ensureAudio(true);
}
cv.addEventListener('pointerup', release);
cv.addEventListener('pointercancel', release);

// 音频解锁只认这些事件：Android Chrome 上触摸授予激活的是 touchend
// (pointerup 在它之前派发、拿不到激活)，click/keydown 覆盖按钮和键盘
['touchend', 'click', 'keydown'].forEach(type =>
  document.addEventListener(type, () => ensureAudio(true), { capture: true, passive: true }));

// 首次开声引导：触屏设备且音频没在跑时显示，解锁后自动消失
const unlockEl = document.getElementById('unlock');
if('ontouchstart' in window) unlockEl.hidden = false;
unlockEl.addEventListener('click', e => {
  e.stopPropagation();
  ensureAudio(true);      // 在点击手势内重试浏览器音频解锁
});
function syncUnlock(){
  if(audioMuted || (audioUnlocked && !audioBlocked)){
    if(!unlockEl.hidden && !unlockEl.classList.contains('gone')){
      unlockEl.classList.add('gone');
      setTimeout(() => { if(unlockEl.classList.contains('gone')) unlockEl.hidden = true; }, 600);
    }
  }else if(needSoundTime > 1.2){
    // 自动播放被浏览器拦截时，重新显示开声引导。
    unlockEl.classList.remove('gone');
    unlockEl.hidden = false;
  }
}

window.addEventListener('keydown', e => {
  if(e.code === 'Space' && !e.repeat && !e.target.closest('button, a, input, textarea, select, [contenteditable]')){
    e.preventDefault();
    setAuto(!auto.on);
  }
});

document.addEventListener('visibilitychange', () => {
  if(document.hidden) stopAudio();
  else ensureAudio();
});
window.addEventListener('pageshow', () => ensureAudio());

/* ============================================================
   计数 —— 只在本机：圈数存 localStorage，不联网、不上报
   ============================================================ */
const stEls = {
  root: document.getElementById('stats'),
  mine: document.getElementById('stMine'),
  mineWrap: document.getElementById('stMineWrap'),
};

let myTurns = 0;
try{
  myTurns = Math.max(0, parseInt(localStorage.getItem('hwl_turns') || localStorage.getItem('zzl_mywah') || '0', 10) || 0);
}catch(_){ /* 无痕模式等 localStorage 不可用时静默降级 */ }

const fmt = n => n.toLocaleString('zh-Hans-CN');
function renderMine(){ stEls.mine.textContent = fmt(myTurns); }

let mySaveTimer = 0;
function addTurns(n){
  myTurns += n;
  renderMine();
  stEls.mineWrap.classList.remove('minepop');
  void stEls.mineWrap.offsetWidth;      // 重启动画
  stEls.mineWrap.classList.add('minepop');
  if(!mySaveTimer){
    mySaveTimer = setTimeout(() => {
      mySaveTimer = 0;
      try{ localStorage.setItem('hwl_turns', String(myTurns)); }catch(_){}
    }, 800);
  }
}

stEls.root.hidden = false;
renderMine();

/* —— Service Worker：安卓 Chrome 的安装提示以此为门槛，顺带离线可玩 —— */
if('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:'){
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* —— 装进桌面（PWA 安装 / iOS 添加到主屏幕指引） —— */
const installBtn = document.getElementById('installBtn');
(function(){
  const standalone = matchMedia('(display-mode: standalone)').matches
                  || navigator.standalone === true;
  if(standalone){ installBtn.style.display = 'none'; return; }  // 已在桌面 app 里
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', () => { installBtn.style.display = 'none'; });
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
             || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let tip = null;
  installBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if(deferredPrompt){                  // Android / 桌面 Chrome：原生安装
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null;
      installBtn.style.display = 'none';
      return;
    }
    if(tip){ tip.remove(); tip = null; return; }
    tip = document.createElement('div');
    tip.className = 'installtip';
    tip.innerHTML = isIOS
      ? '用 Safari 打开本页<br>点分享 <b>&#x2191;</b> → 「添加到主屏幕」<br><span style="opacity:.6;font-size:12px">(点此关闭)</span>'
      : '安卓 Chrome/Edge：菜单 &#8942; → 「安装应用」或「添加到主屏幕」<br>桌面 Chrome：地址栏右侧安装图标<br>Safari：分享 → 「添加到程序坞/主屏幕」<br><span style="opacity:.6;font-size:12px">(点此关闭)</span>';
    tip.addEventListener('click', () => { tip.classList.add('gone'); setTimeout(() => { tip && tip.remove(); tip = null; }, 400); });
    document.body.appendChild(tip);
    setTimeout(() => { if(tip){ tip.classList.add('gone'); setTimeout(() => { tip && tip.remove(); tip = null; }, 400); } }, 8000);
  });
})();
cv.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- 操作面板 ---------- */
const voiceLabel = document.getElementById('voiceLabel');
const playState = document.getElementById('playState');
const soundBtn = document.getElementById('soundBtn');
function syncHud(){
  const label = audioMuted ? '声音已关闭'
    : failedClips.size === AUDIO_CLIPS.length ? '语音暂不可用'
    : voicePlaying && currentClip ? currentClip.name
    : audioBlocked ? '点一下开声' : swinging ? '语音准备中' : '等待甩动';
  if(voiceLabel.textContent !== label) voiceLabel.textContent = label;
  const stateLabel = swinging ? '未花正在转圈' : '未花休息中';
  if(playState.textContent !== stateLabel) playState.textContent = stateLabel;
  document.body.classList.toggle('is-playing', voicePlaying && !audioMuted);
  soundBtn.textContent = audioMuted ? '声音已关' : '声音开启';
  soundBtn.setAttribute('aria-pressed', String(audioMuted));
  soundBtn.setAttribute('aria-label', audioMuted ? '开启声音' : '关闭声音');
}
soundBtn.addEventListener('click', () => {
  audioMuted = !audioMuted;
  try{ localStorage.setItem('hwl_muted', audioMuted ? '1' : '0'); }catch(_){}
  if(audioMuted) stopAudio();
  else ensureAudio(true);
  syncHud();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  setAuto(false);
  if(motion.on) setMotion(false);
  pointer.down = false; pointer.id = null;
  cv.classList.remove('holding');
  swinging = false; stillTime = 0;
  rps = active = drive = omega = 0;
  revAccum = 0;
  interacted = false;
  singTime = 0; hintGone = false;
  document.getElementById('hint').classList.remove('gone');
  stopAudio();
  recenterToy();
  trail.length = ripples.length = 0;
  syncHud();
});
syncHud();

window.addEventListener('resize', resize);
resize();   // 内部会把头像挂回起始位置，轻轻晃着

// 调试钩子（供自动化验证）
window.__hwl = {
  get state(){ return { rps, active, drive, taut, theta,
    stick: { x: stick.x, y: stick.y }, tube: { x: tube.x, y: tube.y },
    target: { x: target.x, y: target.y }, auto: auto.on,
    portrait: swinging ? 'mika2' : 'mika1',
    audio: audioBlocked ? 'blocked' : voicePlaying ? 'playing' : 'paused',
    voice: currentClip ? currentClip.name : null,
    captions: cries.map(p => p.text), muted: audioMuted }; },
  step(dt = 1/60){   // 手动步进一帧（rAF 被冻结的嵌入环境里做自动化验证用）
    update(dt);
    draw(performance.now()/1000, dt);
  },
  setAuto
};

requestAnimationFrame(frame);

})();
