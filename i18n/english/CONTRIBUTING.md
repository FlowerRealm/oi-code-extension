# Contributing Guide

Thank you for your interest in the OI-Code extension! We welcome contributions of all kinds.

## Development Environment Setup

### Prerequisites
- Node.js 16+
- VS Code
- Docker (for testing)
- Git

### Setup Steps
1. Clone the repository:
```bash
git clone https://github.com/FlowerRealm/oi-code-extension.git
cd oi-code-extension
```

2. Install dependencies:
```bash
npm install
```

3. Compile the project:
```bash
npm run compile
```

4. Run tests:
```bash
npm test
```

## Code Standards

### TypeScript Standards
- Use TypeScript strict mode
- Follow ESLint configuration
- Use Prettier for code formatting
- **English Comments**: All comments must be written in English to improve code readability
- **Code Organization**: Avoid duplicate code, prioritize reusable functions and modules
- **Error Handling**: Use appropriate try-catch blocks and Promise error handling

### Testing Standards
- Use Mocha testing framework
- Place test files in the `src/test/` directory
- Test cases should have descriptive names
- Include error handling tests

### Git Commit Standards
- Use clear, descriptive commit messages
- Follow Conventional Commits format
- Run tests before committing to ensure passing

## Testing Guide

### Running Tests
```bash
# Run all tests
npm test

# Run tests with logging
npm run test:log
```

### Test Types
1. **Unit Tests**: Test individual functions or components
2. **Integration Tests**: Test interactions between multiple components
3. **End-to-End Tests**: Test complete user workflows

### Cross-Platform Testing
- Windows: Test file cleanup and Docker installation
- Linux: Test core functionality
- macOS: Test Docker installation and functionality

## Feature Development

### Adding New Language Support
1. Add language configuration in `package.json`
2. Add image configuration in `dockerManager.ts`
3. Update test cases
4. Update documentation

### Adding New Commands
1. Register commands in `extension.ts`
2. Implement command logic in `commands/` directory
3. Add test cases
4. Update documentation

### Adding New Configuration Options
1. Add configuration option in `package.json`
2. Implement configuration logic in `config/` directory
3. Update test cases
4. Update documentation

## Troubleshooting

### Common Issues
1. **Test Failures**: Check if Docker is available, review `test-output.log`
2. **Compilation Errors**: Ensure TypeScript compilation passes
3. **Docker Issues**: Run `oicode.downloadDocker` to install Docker

### Debugging Tips
- Use VS Code debugger
- Review `test-output.log` logs
- Use `console.log` for debug output

## Submitting Pull Requests

### Steps
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/AmazingFeature`
3. Make your changes: `git commit -m 'feat: Add some AmazingFeature'`
4. Push to the branch: `git push origin feature/AmazingFeature`
5. Create a Pull Request

### Pull Request Template
```markdown
## Change Description
Brief description of what this PR aims to accomplish and the changes it contains.

## Change Type
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Code refactoring
- [ ] Performance optimization

## Testing Checklist
- [ ] Functional tests pass
- [ ] Cross-platform tests pass
- [ ] Documentation updated

## Related Issues
Closes #123

## Additional Information
```

## Contact Information
- GitHub Issues: [Report Issues](https://github.com/FlowerRealm/oi-code-extension/issues)
- Email: admin@flowerrealm.top

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
