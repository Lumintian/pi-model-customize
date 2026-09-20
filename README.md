# pi-model-customize

为 [pi coding agent](https://pi.dev) 按模型精细定制**思考档位（Thinking Levels）**、**默认思考强度**、**上下文窗口大小**以及**单次最大输出 Token 数**。

支持全局与项目级配置、通配符/正则模式匹配、带注释的 JSONC 格式、纯内存非破坏性修补与即时状态诊断。

---

## 安装

需要 Node **22.6+**。已在 pi **0.85.1** 验证。

从 npm 安装（推荐）

```sh
pi install npm:pi-model-customize
```

从 GitHub 安装

```sh
pi install git:github.com/Lumintian/pi-model-customize@v0.1.0
```

本地开发，在仓库根目录执行

```sh
pi install "$PWD"        # 全局
pi install -l "$PWD"     # 仅当前项目
```

默认写入用户设置；`-l` 写入当前项目的 `.pi/settings.json`。

---

## 快速配置

### 1. 创建配置文件

根据需要选择在**全局**或**当前项目**创建配置文件：

```text
全局配置：~/.pi/agent/extensions/pi-model-customize.json
项目配置：<当前工作目录>/.pi/extensions/pi-model-customize.json
```

> **提示**：可直接将包内示例复制为全局配置：  
> `mkdir -p ~/.pi/agent/extensions && cp -i examples/pi-model-customize.json ~/.pi/agent/extensions/pi-model-customize.json`

### 2. 编写配置

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
    {
      "pattern": "gpt-*-luna",
      "config": {
        "contextWindow": 512000
      }
    }
  ],
  // 2. 精确覆盖：按模型 ID 或 provider/模型 ID 定制
  "modelOverrides": {
    "openai/gpt-5.6-sol": {
      "defaultThinkingLevel": "xhigh",
      "maxTokens": 272000,
    },
  },
}
```

`patternRules` 会合并所有命中项，并按列表顺序让靠后的规则覆盖同名字段；随后再应用模型 ID 与 `provider/模型ID` 精确覆盖，精确覆盖优先级最高。这样可以先写通用规则，再在下方追加更具体的模式。

修改配置后，在 pi 会话中执行 `/reload` 即可立即生效。

---

## 状态查询与诊断

在 pi 会话中随时执行 `/mc`（或 `/model-customize`），即可查看当前配置加载情况与活动模型的定制状态：

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
