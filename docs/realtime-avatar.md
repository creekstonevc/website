# 实时数字人模式

依据：[Mizzen 接入文档](https://mizzen-ai.feishu.cn/docx/UULPdGfjUoQSbqxcaQ2claxbnTf)，v1.0。

## 当前实现

- `/agent/` 顶部 Text / Video 切换，同一份会话、草稿、附件和历史，不重复发开场白。
- 桌面左侧身份卡展开为横向主视频（宽屏16:9、较窄桌面4:3），聊天在右侧；手机上方16:9视频、下方聊天。媒体使用 contain，不拉伸或裁切真实视频。
- 原生 View Transition 共享元素转场（进入780ms、退出480ms）：头像框连续移动并变形为视频框，旧、新画面均填满同一插值框并裁切，以同步交叉过渡替代两层独立画面的先后出现。无额外遮幕，不逐帧改变聊天栏实际布局。不支持时降级为目标框的 FLIP 动画；尊重 `prefers-reduced-motion`。连接准备阶段显示加载画面，预览模式才保留静态人物图；视频首帧到达与布局转场是独立状态。
- 无凭证时显示 **Static preview**，使用现有彩色照片，不假装有实时视频。文字聊天仍正常。
- 视频播放只接收音视频，不申请摄像头。文字输入始终保留；用户主动启用 Voice 并按住说话时才申请麦克风，见 `asr-input.md`。

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
3. 浏览器建立 recvonly video + audio WebRTC，H.264 `42e01f` / packetization-mode 1，等待 ICE 收集完成，再通过 Gateway 交换 SDP。2026-09-23 核对对方文档 revision 3：明确不支持 Trickle ICE，无独立 candidate 上传接口；必须提交完整 offer。遵循文档示例的 15 秒 ICE 收集截止时间，超时不提交半成品 offer、不自动新建会话；界面明确提示 ICE 准备超时。
4. 实际收到第一帧且连接成功后，才启用该会话的语音输出。自动播放受限时显示 Play video。
5. 发消息时复用现有 Responses 流，`output_text.delta` → BytePlus 双向流式 TTS → 24kHz/16-bit/mono PCM → Gateway Mizzen WebSocket。
6. **每轮回复使用新的音频 WebSocket 和 `stream_id`，复用视频 `session_id`。** Gateway 按 40ms / 960 samples 分包，流内 seq/sample_offset 从零连续递增，最多八个未 ACK 包；按实际时长推送。TTS 完成后附加300ms静音，等待全部 PCM（含静音）发送并收到 ACK，随后发送带精确 `total_samples` 的 `audio.end`。等待 `audio.input_ended` 和服务端关闭这条音频 WebSocket，才允许下一轮；不是关闭视频 session。
7. 无回复时每15秒创建一个独立的40ms零值PCM输入流，并按同样流程正常结束，避免120秒静息超时。如果新回复恰好到来，先等待保活流结束；暂存此时的文字及 finish 信号，不丢字、不并发占用音频入口。正在生成的回复遇到长时间 TTS 间隙时，仅在无语音排队时插入保活PCM。
8. 音视频统一从 WebRTC 播放，不再单独播放 PCM，以免重音/不同步。`audio.input_ended` / ready **不代表视频播放结束**，不会销毁会话。离开或发生故障才释放整个会话，下一次连接创建新session，不重启已停止session。现有550秒会话上限和45秒浏览器失联回收仍保留。

`/video/*` 均为同源 POST，强制 Origin、签名会话和 sessionKey；videoId 只能属于当前会话。
切回 Text、切换会话、离开页面会关闭连接并释放上游会话。浏览器失联45秒由服务端回收；最长550秒主动回收（供应商上限600秒）。供应商的120秒音频空闲限制仍适用，心跳不伪装音频保活。
最多三个并发会话；每会话每分钟最多四次启动。清理未确认的旧会话继续占用席位，但有剩余席位时允许新建；后台持续重试清理，间隔逐渐增加到60秒。`closed/failed` 即使保留错误原因也视为结束。创建结果未知时仍停止分配，须先向供应商确认回收，不能靠重启绕过保护。

## 2026-09-23 线上故障记录（北京时间）

- 16:26:01 `/video/open` 200；16:26:02 `/video/offer` 200；16:26:04 `/video/ready` 200。
- 16:26:16、16:26:31、16:26:46 心跳200。
- 16:27:01 上游状态 `closing`，错误 `MEDIA_UNAVAILABLE`，网关心跳409。
- 16:27:08 起反复 `video.cleanup_pending`，随后重连503；频繁尝试又触发429。
- 结论：这次会话完成了启动与协商，随后媒体不可用；不能据此断言媒体进程从未启动。旧日志没有上游session ID、媒体进程退出原因，需供应商对照上述时间查看媒体服务日志。
- 我方修复：终态保留error不再阻塞释放；旧清理不再阻塞全部重连；清理不再三次后永久停止，未确认席位仍计入总量。
- 新日志：`video.created`、`video.startup_state`、`video.playback_ready`、`video.offer_accepted`、`video.heartbeat_state`、`video.cleanup_state` 均可按 `videoId/upstreamSession` 关联。上游网络/协议/HTTP失败记录路由、方法、状态及安全错误码，不记录API Key、ICE/SDP、聊天或音频内容。启动/状态日志包含会话耗时。

### 尾段不播放：音频流与视频会话生命周期修正

旧实现把「视频 session 停止后不能重启」误用于每段音频输入，因此复用一条始终不发送 `audio.end` 的 WebSocket。300ms静音已 ACK 也不等于告诉媒体服务本段输入已结束。现按接入文档使用一段一连接，并等待 ACK 后发送 end；不凭空增加固定几秒的等待，也不把输入结束当成播放结束。

- `video.audio_open`：记录新输入的 `streamId`、用途 `reply/keepalive`、`replyId`、`upstreamSession`。
- `video.audio_tail`：记录 `tail_queued → speech_tail_sent → silence_tail_sent → tail_acked` 的时间和采样位置。
- `video.audio_input`：记录 `ready → end_sent → input_ended → closed`；`end_sent.afterLastAckMs` 可直接核对最后 ACK 到 end 的间隔。异常记录 `interrupted` / `video.audio_input_failed`，不含文本、PCM或凭证。
- 自动化测试覆盖 ACK 门控、输入结束及关闭确认、连续多轮、保活与新回复串行、等待期间取消、异常关闭/超时、唯一 stream ID、保持原视频 session。
- 2026-09-23 使用服务端配置做真实协议冒烟：独立测试 session `c66fb4a5-0166-46c0-adfa-f4a3bfe1da3f` 中依次发送1秒合成音+300ms静音、40ms静音保活、第二段1秒合成音+300ms静音。三个不同 stream 均收到 `audio.input_ended` 并正常关闭输入连接，随后 session 均为 `ready`；测试结束后 DELETE 并确认 `closed`。这证明连接可逐段复用同一视频会话，不等同于已验证 WebRTC 实际尾音。

## 现阶段限制

- 真实环境的媒体启动、ICE、播放连接及 stats 已联调；协议回归覆盖权限隔离、PCM分包/ACK与逐轮输入生命周期。尾音/尾帧是否完整仍须结合实际 WebRTC 播放验收，输入 ACK 不能代替听感检查。
- 无录像/重播功能。历史消息的 Play voice 会回到 Text 模式后播放，避免双音轨。
- 上一段语音仍在推送时新消息照常发送文字，不叠加第二条音频输入。
- 视频连接中发送的消息保持文字输出，不事后重放。连接失败不重发 LLM 请求。
- 当前不自动重建失效视频会话；用户点击 Reconnect。没有可靠 playback.done，尾音/尾帧表现必须实测。

## 本地运行及交付测试

`npm run dev:agent` 从 `.env.local` 加载所有配置，入口 `http://localhost:3100/agent/`。
`npm run dev:agent -- --server-credentials` 仅沿用已授权的 Boids/BytePlus 服务端凭证；Mizzen 新凭证请配置到本地环境并使用前一种启动方式。

无任何凭证的 UI fixture：`npm run build && node scripts/agent-qa-server.mjs`。它的回复是测试数据，不代表真实 Agent。

拿到 Key 后重点验收：第一帧与首句延迟、尾音/尾帧、连续多轮、切换会话/视图、自动播放限制、120秒空闲回收、UDP受限网络、三席位容量、退出清理、真实清理失败响应、Safari/iOS H.264。

部署仍为静态 Next export + Nginx + systemd Gateway；`deploy.sh` 包含模块安装、路由及环境变量保留、测试、构建和旧版本备份。
