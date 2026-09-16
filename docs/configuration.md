# 配置参考指南 (Configuration Guide)

本文档详细说明 `pi-model-customize` 的配置文件规范、支持字段、匹配规则及合并优先级。

---

## 1. 配置文件路径

插件支持双层配置，自动根据环境查找并合并：

| 作用域 | 配置文件路径 | 说明 |
|---|---|---|
| **全局配置** | `~/.pi/agent/extensions/pi-model-customize.json` | 遵循 `PI_CODING_AGENT_DIR` 与 pi 的 `getAgentDir()` |
| **项目配置** | `<当前项目根目录>/.pi/extensions/pi-model-customize.json` | 遵循 `CONFIG_DIR_NAME`，仅在受信任项目生效 |

- **安全沙箱**：仅在 `ctx.isProjectTrusted()` 为真时读取项目配置，防止未受信任的工作区恶意注入模型参数。
- **独立生效**：文件不存在时视为该层无规则；单层文件格式错误时仅忽略该错误文件，不影响另一层有效配置。
- **重载时机**：在会话启动（startup）、新建（new）、恢复（resume）、派生（fork）以及执行 `/reload` 时重新读取。

---

## 2. 格式规范与完整样例

支持标准 JSON 以及带注释（`//`、`/* ... */`）和行尾逗号的 JSONC 格式。

```jsonc
{
  "version": 1, // 配置版本号，可选，若提供必须为 1

  // 1. 模式匹配规则（按列表顺序优先匹配首个命中的规则）
  "patternRules": [
    {
      // 字符串通配符匹配（支持 *，忽略大小写）
      "pattern": "gpt-*",
      "config": {
        "allowedThinkingLevels": ["low", "medium", "xhigh", "max"]
      }
    },
    {
      // 结构化正则表达式匹配
      "pattern": {
        "regex": "^openai/(o1|o3)",
        "flags": "i"
      },
      "config": {
        "defaultThinkingLevel": "medium"
      }
    }
  ],

  // 2. 精确模型覆盖（优先级高于 patternRules）
  "modelOverrides": {
    // 按纯模型 ID 覆盖
    "gpt-5.6-luna": {
      "allowedThinkingLevels": ["low", "max"],
      "contextWindow": 512000
    },
    // 按 provider/模型 ID 精确覆盖（最高优先级）
    "openai/gpt-5.6-sol": {
      "defaultThinkingLevel": "xhigh",
      "maxTokens": 32000, // 支持尾随逗号
    }
  }
}
```

---

## 3. 配置字段定义

| 字段 | 类型 | 说明与约束 |
|---|---|---|
| `allowedThinkingLevels` | `Array<string>` | 允许的思考档位白名单。未列出的档位被设为 `null` 禁用。 |
| `defaultThinkingLevel` | `string` | 会话启动、新建会话或主动切换至该模型时的默认思考档位。 |
| `thinkingLevelMap` | `Record<string, string \| null>` | 细粒度 Provider 映射。字符串为启用对应映射值，`null` 为禁用。优先级高于 `allowedThinkingLevels`。 |
| `contextWindow` | `number` | pi 分配的上下文窗口 token 上限，必须为**正安全整数**。 |
| `maxTokens` | `number` | 单次请求允许模型输出的最大 token 数，必须为**正安全整数**。 |

### 支持的思考档位（Thinking Levels）
`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。

> **能力约束说明：**
> 1. 白名单只能收窄模型原生已声明的能力，不能为原生不支持 `xhigh` 或 `max` 的模型凭空凭凑该档位（若需显式注入，请使用 `thinkingLevelMap`）。
> 2. 非推理模型（`reasoning: false`）会自动跳过思考相关配置，但仍可正常应用 `contextWindow` 和 `maxTokens`。
> 3. 最终思考强度仍受 pi 内置能力钳制保护。

---

## 4. 匹配规则与优先级

### 模式表示方式
1. **字符串通配符**：支持包含 `*` 的任意模式（如 `gpt-*`、`anthropic/*`），大小写不敏感，自动转义其它正则元字符。
2. **正则对象**：`{ "regex": "...", "flags": "..." }`，与 JavaScript 原生 `RegExp` 规则一致。内部具备预编译缓存与自动状态复位能力。

### 规则合并机制
当同时存在全局与项目配置时：
1. **模式列表合并**：项目 `patternRules` 置于全局规则前优先匹配。
2. **精确键合并**：同一精确模型条目，全局字段与项目字段进行浅合并（项目字段覆盖同名字段）。

### 单个模型计算优先级（从低到高）
```text
首个匹配的 patternRule  ──►  modelOverrides[模型ID]  ──►  modelOverrides[provider/模型ID]
```
- 只采用首个匹配的模式规则，不交叉合并多个 pattern。
- 精确键区分大小写，与 provider 返回的真实 ID 保持一致。
- 作用域不削弱精确覆盖：全局的 `provider/模型ID` 依然高于项目内的通配模式。
