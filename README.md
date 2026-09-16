# pi-model-customize

为 pi 按模型定制思考档位、默认思考强度、上下文窗口和最大输出 token 数。

由原 `model-customize.ts` 扩展整理为标准 pi 包。配置独立于安装目录，支持全局和项目两层。**本版本不包含包、工具或 skill 屏蔽功能。**

## 安装

在包目录执行：

```sh
pi install "$PWD"
```

仅安装到当前工作项目时，使用 `pi install -l /absolute/path/to/pi-model-customize`。本包通过 `package.json` 的 `pi.extensions` 加载 `extensions/index.ts`，无需编译 TypeScript。

已在 pi **0.85.1** 上进行开发验证；旧版可能缺少 `max` 档位或项目信任 API，不保证兼容。核心 pi 依赖按包规范声明为 `peerDependencies: "*"`，开发依赖固定为验证版本。

## 配置位置

```text
全局：~/.pi/agent/extensions/pi-model-customize.json
项目：<当前工作目录>/.pi/extensions/pi-model-customize.json
```

- 全局目录通过 pi 的 `getAgentDir()` 获取，遵循 `PI_CODING_AGENT_DIR`。
- 项目配置目录使用 pi 的 `CONFIG_DIR_NAME`；仅在 `ctx.isProjectTrusted()` 为真时读取。
- 配置在启动、新建／恢复／派生会话和 `/reload` 时重新读取；不监听文件变化。
- 文件不存在时，该层没有规则；两层都不存在时，不覆盖任何模型参数。
- JSON 语法、未知字段、无效档位、非正整数 token 上限等错误会提示文件和字段位置，并忽略整个错误文件。另一层有效配置仍然生效。
- 不自动创建配置，也不修改 pi 的 `settings.json` 或 `models.json`。

## 从原扩展迁移

`examples/pi-model-customize.json` 保存了原文件中所有生效的配置，包括 GPT 通配规则和三个精确模型条目。原配置不作为包的隐式默认值，避免把个人偏好强加给其他用户。

1. 将示例复制到全局配置位置，或迁入项目配置。
2. 停用／移出原 `model-customize.ts`，避免两个扩展同时修改模型。
3. 安装本包，然后重启 pi。后续配置修改通常只需 `/reload`。

```sh
# 默认 pi 配置目录；若设置 PI_CODING_AGENT_DIR，请改用实际目录。
mkdir -p ~/.pi/agent/extensions
cp -i examples/pi-model-customize.json ~/.pi/agent/extensions/pi-model-customize.json
```

`cp -i` 会在目标已存在时询问。请先检查示例中的模型名和窗口大小是否适合自己的 provider。

## 配置格式

严格 JSON，不支持注释或尾随逗号。`version` 可省略，提供时必须为 `1`。

```json
{
  "version": 1,
  "patternRules": [
    {
      "pattern": "gpt-*",
      "config": {
        "allowedThinkingLevels": ["low", "medium", "xhigh", "max"]
      }
    }
  ],
  "modelOverrides": {
    "gpt-5.6-luna": {
      "allowedThinkingLevels": ["low", "max"],
      "contextWindow": 512000
    },
    "openai/gpt-5.6-sol": {
      "defaultThinkingLevel": "xhigh",
      "maxTokens": 32000
    }
  }
}
```

### 字段

| 字段 | 含义 |
|---|---|
| `allowedThinkingLevels` | 保留的 pi 档位，未列出的档位禁用 |
| `defaultThinkingLevel` | 新启动、新建会话和主动切换模型时的默认档位 |
| `thinkingLevelMap` | 档位到 provider 值的映射；字符串启用，`null` 禁用 |
| `contextWindow` | pi 使用的上下文窗口 token 数，正安全整数 |
| `maxTokens` | 单次请求的最大输出 token 数，正安全整数 |

档位：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。

- 白名单只收窄模型原有能力，不重新启用原本为 `null` 的档位。`xhigh`、`max` 必须已由模型显式提供。
- `thinkingLevelMap` 比 `allowedThinkingLevels` 优先；映射与模型原映射合并，可以显式启用扩展档位。请确认 provider 确实支持对应值。
- 非推理模型忽略思考配置，仍可覆盖 token 上限。
- `defaultThinkingLevel` 最终由 pi 按模型能力调整。空白名单可配置，但最终档位仍由 pi 的能力钳制逻辑决定，并不代表禁止请求。
- 上调窗口或输出限制不能提高 provider 的真实上限，配置不当可能导致请求错误、预算误判或更高费用。

### 匹配与优先级

字符串支持 `*`，不区分大小写；除 `*` 外均按字面量匹配，匹配整个模型 ID 或 `provider/模型 ID`。

正则使用可序列化的对象表示；默认区分大小写，行为与 JavaScript `RegExp` 一致：

```json
{
  "patternRules": [
    {
      "pattern": { "regex": "^openai/gpt-", "flags": "i" },
      "config": { "defaultThinkingLevel": "medium" }
    }
  ]
}
```

先合并两层配置：

1. 模式列表：项目规则在前，全局规则在后。
2. 同一个精确键：全局字段 → 项目字段覆盖。
3. 数组和 `thinkingLevelMap` 作为完整字段替换，不做元素追加或递归合并。

然后为每个模型解析，优先级从低到高：

```text
首个匹配的模式规则 → modelOverrides[模型 ID] → modelOverrides[provider/模型 ID]
```

只采用首个匹配模式，不合并所有匹配模式。精确键区分大小写，与 pi 返回的 ID 一致。模式规则在内部自动预编译并缓存正则实例，带状态标志（如 `g`、`y`）会在每次匹配候选时自动重置 `lastIndex`，避免状态漂移；在无任何规则时会自动短路跳过全量模型扫描。

**作用域不取代精确度优先级：** 全局 `provider/模型 ID` 仍会覆盖项目中的通配规则或裸模型 ID。同一精确键才是项目字段优先。项目 `patternRules: []` 不会删除全局规则；若要压过全局模式，可添加先匹配的项目规则（`config: {}` 可停止该模型继承全局模式，但不会取消精确覆盖）。

## 会话行为

| 场景 | 思考档位 |
|---|---|
| 启动、新建会话 | 无 CLI 显式覆盖时应用模型默认档位 |
| `-t`／`--thinking`／`--model 模型:档位` | 保留 CLI 指定档位，仍按模型能力调整 |
| 恢复、派生、重载会话 | 保留当前档位，必要时按能力调整 |
| `/model`／模型轮换／程序主动切换 | 应用目标模型默认档位，没有默认值则调整当前档位 |
| `model_select` 的 `restore` 来源 | 不重新应用默认思考强度 |

原有 CLI 优先策略保留：启动参数也影响同进程的新建会话；主动切换模型时仍应用目标默认值。`llama:8b` 这种普通模型 ID 不会被误判为思考后缀。

启动时修改注册表中的模型；动态注册或刷新后选中的新模型会在 `model_select` 再次应用规则。扩展不拦截所有注册表刷新，未选中的刷新模型可能要等下次会话初始化才应用。

本包在运行时原地修改 pi 模型描述对象，未写回模型配置。重载、会话切换和关闭时撤销本包仍持有的修改，避免删除 JSON 配置后残留旧参数。其他扩展随后替换的值不会被撤销；多个扩展同时修改同一模型仍可能存在加载顺序冲突，不构成通用的修改所有权管理。

## 开发与验证

```sh
npm ci
npm run check
npm pack --dry-run
```

测试覆盖配置校验、全局／项目合并与信任、规则优先级、思考能力约束、CLI 判断、模型恢复及扩展生命周期。生命周期测试使用真实扩展入口和模拟 pi 上下文，不调用模型 API。

本包暂未选择开源许可证（`UNLICENSED`）。发布或共享前请由作者确定许可证及仓库信息。
