# 贡献指南

[![English Documentation](https://img.shields.io/badge/Contributing-Guide-blue.svg)](../../CONTRIBUTING.md)

感谢您对 OI-Code 扩展的关注！我们欢迎各种形式的贡献。

## 开发环境设置

### 先决条件
- Node.js 16+
- VS Code
- Docker（用于测试）
- Git

### 设置步骤
1. 克隆仓库：
```bash
git clone https://github.com/FlowerRealm/oi-code-extension.git
cd oi-code-extension
```

2. 安装依赖：
```bash
npm install
```

3. 编译项目：
```bash
npm run compile
```

4. 运行测试：
```bash
npm test
```

## 代码规范

### TypeScript 规范
- 使用 TypeScript 严格模式
- 遵循 ESLint 配置
- 使用 Prettier 格式化代码
- **英文注释**：所有注释必须使用英文书写，提升代码可读性
- **代码组织**：避免重复代码，优先使用可重用函数和模块
- **错误处理**：使用适当的 try-catch 和 Promise 错误处理

### 测试规范
- 使用 Mocha 测试框架
- 测试文件放在 `src/test/` 目录
- 测试用例应该具有描述性名称
- 包含错误处理测试

### Git 提交规范
- 使用清晰的提交信息
- 遵循 Conventional Commits 格式
- 提交前运行测试确保通过

## 测试指南

### 运行测试
```bash
# 运行所有测试
npm test

# 运行测试并输出日志
npm run test:log
```

### 测试类型
1. **单元测试**：测试单个函数或组件
2. **集成测试**：测试多个组件的交互
3. **端到端测试**：测试完整的用户流程

### 跨平台测试
- Windows：测试文件清理和 Docker 安装
- Linux：测试核心功能
- macOS：测试 Docker 安装和功能

## 功能开发

### 添加新语言支持
1. 在 `package.json` 中添加语言配置
2. 在 `dockerManager.ts` 中添加镜像配置
3. 更新测试用例
4. 更新文档

### 添加新命令
1. 在 `extension.ts` 中注册命令
2. 在 `commands/` 目录中实现命令逻辑
3. 添加测试用例
4. 更新文档

### 添加新配置项
1. 在 `package.json` 中添加配置项
2. 在 `config/` 目录中实现配置逻辑
3. 更新测试用例
4. 更新文档

## 问题排查

### 常见问题
1. **测试失败**：检查 Docker 是否可用，查看 `test-output.log`
2. **编译错误**：确保 TypeScript 编译通过
3. **Docker 问题**：运行 `oicode.downloadDocker` 安装 Docker

### 调试技巧
- 使用 VS Code 调试器
- 查看 `test-output.log` 日志
- 使用 `console.log` 输出调试信息

## 提交 Pull Request

### 步骤
1. Fork 仓库
2. 创建功能分支：`git checkout -b feature/AmazingFeature`
3. 提交更改：`git commit -m 'feat: Add some AmazingFeature'`
4. 推送到分支：`git push origin feature/AmazingFeature`
5. 创建 Pull Request

### Pull Request 模板
```markdown
## 变更描述
简要描述这个 PR 的目的和变更内容。

## 变更类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 文档更新
- [ ] 重构
- [ ] 性能优化

## 测试清单
- [ ] 功能测试通过
- [ ] 跨平台测试通过
- [ ] 文档更新

## 相关问题
Closes #123

## 其他信息
```

## 联系方式
- GitHub Issues：[提交问题](https://github.com/FlowerRealm/oi-code-extension/issues)
- 邮箱：admin@flowerrealm.top

## 许可证
本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。
