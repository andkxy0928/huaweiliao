# 花未了

以未花为主角的星海互动小玩具。首页使用提供的星海背景，搭配蔚蓝档案风格的蓝白界面。纯静态、无构建、无后端，不依赖第三方服务。

## 玩法

- 按住画布画圈：头像随绳摆动，静止为 `mika1`，甩动为 `mika2`，停稳后恢复。
- 自动甩：点击按钮，或在画布区域按空格键切换。
- 甩手机：支持动作传感器的手机可用；通常需要 HTTPS，iOS 首次使用会请求授权。
- 声音：随机逐条播放三个 WAV 文件，保持原速、避免连续重复，不叠加播放；飘字使用正在播放的音频名称，不含扩展名。
- 声音开关：可以静音，选择会保存在当前浏览器。
- 归位：停止当前模式和语音，将未花移回起始位置，不清除累计圈数。
- 手动甩动圈数保存在当前浏览器，自动甩不计入；会兼容读取旧版计数。

标题下保留未花头像；“青辉石”文字下方显示等比缩放的青辉石图片。

## 本地运行

直接打开 `index.html` 也能游玩，请一起保留 `assets/` 目录。
离线缓存、桌面安装及自定义 404 路由需通过静态服务访问：

```powershell
python scripts/serve.py --port 58743
```

访问 <http://127.0.0.1:58743/>。预览服务会对未知路径返回本项目的 404 页面和真实的 HTTP 404 状态。

如需在同一局域网内查看，可指定监听地址：

```powershell
python scripts/serve.py --host 0.0.0.0 --port 58743
```

该预览服务只提供 HTTP；普通局域网 HTTP 下可能无法使用手机体感。静态托管应配置未知路径返回 `404.html`，状态码为 404，不能全部回退首页。

## 项目结构

```text
index.html                 首页结构与网站元信息
404.html                   自定义错误页
manifest.webmanifest       桌面安装配置
sw.js                      页面、图片、语音的离线缓存
assets/
  css/site.css             首页与 404 共用主题、响应式布局
  js/config.js             头像路径与语音文件清单
  js/app.js                物理模拟、绘制、音频、按钮及本地计数
  image/                   用户提供的原始图片
  Audio/                   三段 WAV 语音，注意目录名大小写
  icons/                   从“图标.png”生成的网站图标
scripts/
  serve.py                 无依赖本地静态预览服务
  generate-icons.ps1       用系统 FFmpeg 重新生成图标
  check.cjs                无依赖静态资源与代码检查
LICENSE                    保留的原项目许可
```

## 图片和声音

- 首页背景：`assets/image/主背景.png`。
- 404 背景：`assets/image/404页面.png`；保留标题“这里没有花语~”和原有返回按钮文案。
- 头像：`assets/image/mika1.png`、`assets/image/mika2.png`。
- 青辉石：`assets/image/青辉石.png`。
- 图标源文件：`assets/image/图标.png`。
- 音频：`assets/Audio/遥遥领先.wav`、`这么好的车.wav`、`啊这个这个.wav`。

增加语音时修改 `assets/js/config.js` 的文件列表，字幕会自动取文件名；同时更新 `sw.js` 的缓存清单及版本号。背景和界面颜色在 `assets/css/site.css` 中调整。

## 图标

浏览器标准扩展名是 `.ico`，不是 `.icon`。当前 `assets/icons/favicon.ico` 包含 16、32、48、256 像素四个尺寸，另外提供 180 像素 Apple 图标与 192、512 像素 PWA 图标。

替换源图后，用系统中的 FFmpeg 重新生成：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
```

## 检查与缓存

```powershell
node scripts/check.cjs
```

第一次完整加载并完成 Service Worker 安装后，可离线使用已缓存资源。更新静态资源时递增 `sw.js` 中的缓存版本；旧版页面若尚未刷新，需要重新加载。未知路径的 404 不会覆盖离线首页。

原站域名、旧图标引用和不再使用的竹林 / 3D 渲染已从当前页面移除。未配置新站域名，因此不生成指向旧站的 canonical 或站点地图。

## 来源与许可

互动的物理逻辑基于 imsai-sh 的“竹知了”项目修改。原项目许可与版权声明保留在 `LICENSE`；本项目不是蔚蓝档案官方产品。图片、角色及音频等素材的权利归各自权利人，使用范围以相应授权为准。
