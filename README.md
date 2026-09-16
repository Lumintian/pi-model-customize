# pi-model-customize

为 [pi coding agent](https://pi.dev) 按模型精细定制**思考档位（Thinking Levels）**、**默认思考强度**、**上下文窗口大小**以及**单次最大输出 Token 数**。

支持全局与项目级配置、通配符/正则模式匹配、带注释的 JSONC 格式、纯内存非破坏性修补与即时状态诊断。

---

## 快速安装

在当前包目录执行：

```sh
# 全局安装至当前用户
pi install "$PWD"

# 或仅安装到当前项目
pi install -l "$PWD"
```

安装后无需手动编译 TypeScript，pi 会自动通过清单加载入口。已在 pi **0.85.1** 及以上版本验证。

---

## 5 分钟上手配置

### 1. 创建配置文件

根据需要选择在**全局**或**当前项目**创建配置文件：

```text
全局配置：~/.pi/agent/extensions/pi-model-customize.json
项目配置：<当前工作目录>/.pi/extensions/pi-model-customize.json
```

> **提示**：可直接将包内示例复制为全局配置：  
> `mkdir -p ~/.pi/agent/extensions && cp -i examples/pi-model-customize.json ~/.pi/agent/extensions/pi-model-customize.json`

### 2. 编写配置（支持 JSONC 注释与尾逗号）

```jsonc
{
  "version": 1,
  // 1. 通配符模式匹配：批量定制一类模型
  "patternRules": [
    {
      "pattern": "gpt-*",
      "config": {
        "allowedThinkingLevels": ["low", "medium", "xhigh", "max"],
      },
    },
  ],
  // 2. 精确覆盖：按模型 ID 或 provider/模型 ID 定制
  "modelOverrides": {
    "gpt-5.6-luna": {
      "allowedThinkingLevels": ["low", "max"],
      "contextWindow": 512000, // 调大上下文窗口
    },
    "openai/gpt-5.6-sol": {
      "defaultThinkingLevel": "xhigh",
      "maxTokens": 32000,
    },
  },
}
```

修改配置后，无需重启终端，在 pi 会话中执行 `/reload` 即可立即生效。

---

## 状态查询与诊断

在 pi 会话中随时执行 `/mc`（或 `/model-customize`），即可直观查看当前配置加载情况与活动模型的定制状态：

```text
/mc
```

输出反馈示例：
```text
[pi-model-customize] Status:
• Global: ~/.pi/agent/extensions/pi-model-customize.json (loaded)
• Project: /workspace/.pi/extensions/pi-model-customize.json (loaded)
• Active Rules: 1 pattern(s), 2 override(s)
• Current Model: openai/gpt-5.6-luna
  - Customized: yes
  - Context Window: 512,000
  - Allowed Thinking: [low, max]
  - Active Thinking Level: low
```

---

## 开发与验证

本项目采用原生 Node.js 测试与 TypeScript 类型校验：

```sh
npm ci            # 安装开发依赖
npm run check     # 运行 TypeScript 类型检查与全部单元测试
npm pack --dry-run # 验证发布打包内容
```

---

## 进阶文档

深入规则与实现细节见下：

* 📖 **[完整配置参考指南](./docs/configuration.md)**：包含全部字段规范、思考档位说明、优先级计算链与合并逻辑。
* ⚙️ **[运行机制与会话行为](./docs/internals.md)**：包含各生命周期（启动/恢复/派生/切换模型）思考档位策略、内存快照还原机制及 CLI 参数保护。

---

## 未来计划

- [ ] **模型级别 Skill 开关支持**：支持按模型配置技能（Skill）启用/禁用黑白名单，针对不同能力梯队或上下文预算的模型精细化控制可用技能。

---

## 许可证

本项目遵循 [MIT License](./LICENSE) 开源许可证。
