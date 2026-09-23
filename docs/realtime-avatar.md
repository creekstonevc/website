# 实时数字人模式（本地开发 / 待凭证联调）

依据：[Mizzen 接入文档](https://mizzen-ai.feishu.cn/docx/UULPdGfjUoQSbqxcaQ2claxbnTf)，v1.0。

## 当前实现

- `/agent/` 顶部 Text / Video 切换，同一份会话、草稿、附件和历史，不重复发开场白。
- 桌面左侧身份卡展开为横向主视频（宽屏16:9、较窄桌面4:3），聊天在右侧；手机上方16:9视频、下方聊天。媒体使用 contain，不拉伸或裁切真实视频。
- 原生 View Transition 共享画面转场（进入780ms、退出480ms），双侧遮幕和一次中央金线；不逐帧改变聊天栏宽度。不支持时降级为位移动画；尊重 `prefers-reduced-motion`。
- 无凭证时显示 **Static preview**，使用现有彩色照片，不假装有实时视频。文字聊天仍正常。
- 浏览器只接收音视频，不申请摄像头/麦克风；输入仍是文字。

## 需要的配置

仅写入服务器环境或本地不入 Git 的 `.env.local`：

| 环境变量 | 用途 |
| --- | --- |
| `MIZZEN_INPUT_KEY` | 创建/查询/关闭会话、上传 PCM 的服务端 Bearer Key |
| `MIZZEN_PLAYBACK_KEY` | 获取临时 ICE 配置、交换 SDP 的服务端 Bearer Key |
| `MIZZEN_BASE_URL` | 默认 `https://avatar.preview.mizzen.top`；若供应商提供正式实例地址则替换 |

还需供应商确认这个实例已经配置为**一豪的形象**。当前接口不接受 avatar ID。
沿用现有 Boids、BytePlus TTS 配置，无需新增这两家的 Key。两把 Mizzen Key 必须同时存在才启用真实连接。

## 数据链路

1. 浏览器带现有签名 conversation cookie 和 `sessionKey` 请求 Gateway `/video/open`。
2. Gateway 用独立幂等键创建 Mizzen 会话并轮询 ready，返回网站自己的 opaque videoId 和临时 ICE 凭证；上游 API Key 不下发。
3. 浏览器建立 recvonly video + audio WebRTC，H.264 `42e01f` / packetization-mode 1，等待 ICE 收集完成，再通过 Gateway 交换 SDP。
4. 实际收到第一帧且连接成功后，才启用该会话的语音输出。自动播放受限时显示 Play video。
5. 发消息时复用现有 Responses 流，`output_text.delta` → BytePlus 双向流式 TTS → 24kHz/16-bit/mono PCM → Gateway Mizzen WebSocket。
6. Gateway 按 40ms / 960 samples 分包，连续 seq/sample_offset，最多八个未 ACK 包；音频按实际时长推送。收到所有 ACK 后才发 `audio.end`。
7. 音视频统一从 WebRTC 播放，不再单独播放 PCM，以免重音/不同步。音频上传结束**不代表视频播放结束**，不会立即销毁会话。

`/video/*` 均为同源 POST，强制 Origin、签名会话和 sessionKey；videoId 只能属于当前会话。
切回 Text、切换会话、离开页面会关闭连接并释放上游会话。浏览器失联45秒由服务端回收；最长550秒主动回收（供应商上限600秒）。供应商的120秒音频空闲限制仍适用，心跳不伪装音频保活。
最多三个并发会话；每会话每分钟最多四次启动。创建结果未知或清理无法确认时停止继续分配，避免重复消耗席位。
无法确认清理的情况须先向供应商确认回收，再重启 Gateway；不要靠反复重连绕过保护。

## 现阶段限制

- 已通过协议适配 mock、权限/隔离、PCM分包/ACK测试和本地 UI 检查；**尚未用真实 Mizzen 凭证联调**。
- 无录像/重播功能。历史消息的 Play voice 会回到 Text 模式后播放，避免双音轨。
- 上一段语音仍在推送时新消息照常发送文字，不叠加第二条音频输入。
- 视频连接中发送的消息保持文字输出，不事后重放。连接失败不重发 LLM 请求。
- 当前不自动重建失效视频会话；用户点击 Reconnect。没有可靠 playback.done，尾音/尾帧表现必须实测。

## 本地运行及交付测试

`npm run dev:agent` 从 `.env.local` 加载所有配置，入口 `http://localhost:3100/agent/`。
`npm run dev:agent -- --server-credentials` 仅沿用已授权的 Boids/BytePlus 服务端凭证；Mizzen 新凭证请配置到本地环境并使用前一种启动方式。

无任何凭证的 UI fixture：`npm run build && node scripts/agent-qa-server.mjs`。它的回复是测试数据，不代表真实 Agent。

拿到 Key 后重点验收：第一帧与首句延迟、尾音/尾帧、连续多轮、切换会话/视图、自动播放限制、120秒空闲回收、UDP受限网络、三席位容量、退出清理、真实清理失败响应、Safari/iOS H.264。

部署仍为静态 Next export + Nginx + systemd Gateway；`deploy.sh` 已包含新模块、路由和可选环境变量保留，但本次开发**没有执行部署**。
