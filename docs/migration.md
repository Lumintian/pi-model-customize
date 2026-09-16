# 迁移指南 (Migration Guide)

本文档面向此前使用单文件脚本版 `model-customize.ts` 的用户，指导平滑迁移至本 npm 包形式的标准 Pi Package。

---

## 迁移步骤

### 1. 复制参考配置
包内自带的 `examples/pi-model-customize.json` 完整保留了旧版单文件脚本中生效的典型模型配置（含通配规则与三个精确模型条目）：

```sh
# 创建全局配置目录（若设置了 PI_CODING_AGENT_DIR，请替换为实际目录）
mkdir -p ~/.pi/agent/extensions

# 将样例配置复制至全局配置位置（-i 选项会在目标文件存在时提示确认）
cp -i examples/pi-model-customize.json ~/.pi/agent/extensions/pi-model-customize.json
```

### 2. 停用旧版单文件扩展
为避免两个扩展实例同时修补相同模型产生冲突，请将旧版扩展文件移出或重命名：

```sh
# 例如将旧版扩展改名备份
mv ~/.pi/agent/extensions/model-customize.ts ~/.pi/agent/extensions/model-customize.ts.bak
```

### 3. 安装并启动新包
通过 pi 包管理器安装当前包，然后启动 pi：

```sh
# 全局安装
pi install /path/to/pi-model-customize

# 重启 pi 验证，或使用 /mc 查看状态
```

后续对配置文件的修改，无需重启进程，在会话中直接执行 `/reload` 即可生效。
