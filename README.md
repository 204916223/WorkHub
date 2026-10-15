# WorkHub · 工作中枢

Vue + Node Web 应用。中控独立运行，插件同时贡献页面和 AI 工具。Host 核心参照本地 BehaviorTreeTools，增加工作区隔离、工具参数与读写声明、操作审批以及可靠资源清理。服务端需 Node.js 22.13 或更新版本；任务库使用 Node 内置 SQLite。

```sh
npm install
npm run dev       # 前端 5178，后端 3080
npm run verify    # 测试与生产构建
npm start         # 托管构建后的前端与 API，默认 127.0.0.1:3080
```

服务地址和数据目录可通过 `HOST`、`PORT`、`WORKHUB_DATA_DIR` 设置。服务端运行需 Node.js 22.13 或更新版本；开发构建推荐 Node.js 24 LTS。登录时粘贴 Teambition MCP JSON，服务端只连接官方身份服务并通过当前用户工具确认身份。登录会话有效期 12 小时，重启服务后需重新验证；不再使用共享访问口令。临时网络错误和超时最多尝试 3 次，每次重新建立 MCP 连接；单次上限 12 秒，总登录上限 45 秒。无效凭证、配置及证书错误直接提示，失败后可重新验证。

```text
host/                 插件契约、注册、生命周期、消息和工具清单（TypeScript）
server/ai/            模型适配、流式解析、工具执行循环
server/http/          HTTP 装配、路由与响应
server/tools/         统一工具执行和审批
server/workspaces/    工作区运行时
server/storage/       按验证用户持久化
server/auth/          MCP 身份登录与会话 Cookie
connectors/teambition/ MCP 配置验证、当前用户解析与连接适配
web/src/components/   中控外壳、功能卡片、对话栏和确认界面
web/src/features/     会话、工作区和布局状态逻辑
web/src/views/        中控自带页面与注册清单
web/src/services/     浏览器 API 接入
web/src/state/        浏览器设置
web/src/styles/       主题、布局与公共组件样式
plugins/workspace/    第一个插件：manifest、服务端工具和 Vue 页面
plugins/*-registry.js 插件组装入口
tests/                生命周期、审批、工作区及模型执行测试
scripts/              开发启动
```

第一版包含插件管理、运行记录、资源状态、设置、工作区信息、任务清单和工时统计。任务清单通过 SearchUserTasksV3 同步当前用户任务到个人 SQLite 数据库，任务搜索与筛选读取本地库；工时统计根据同一任务快照中的自定义字段汇总。评论和附件尚未迁移。AI 接入 OpenAI/Anthropic 兼容接口，需在页面配置有效模型服务。插件启停由前端和 AI 共用统一工具与审批入口。

服务器按 MCP 返回的 `组织 ID:用户 ID`（未返回组织时使用用户 ID）在 `data/users/<用户标识>/` 分别保存 `profile.json`、`sessions.json`、`prefs.json` 和 `state.json`（插件状态及运行记录）。数据归属由登录 Cookie 对应的验证身份决定，客户端不能通过工作区 ID 指定别人的数据。同一浏览器的旧页面检测到用户切换时必须重新登录。

非敏感模型配置和布局存入个人偏好；模型密钥仅按用户保存在当前浏览器，并在对话请求时发送。MCP 配置默认不保留，选择“记住配置”后仅保存在当前浏览器；服务器不落盘个人 Token。会话最多保留 30 个，每个最多 200 条消息。操作确认只存于服务端内存，重启后需重新发起。旧版未验证工作区与浏览器会话保留原处，不自动归入新用户。
