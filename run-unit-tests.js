const Mocha = require('mocha');
const path = require('path');

// 创建mocha实例
const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000
});

// 添加测试文件 - 只添加不依赖VS Code的测试
const testFiles = [
    'out/test/suite/compiler-detector.test.js',
    'out/test/suite/compiler-priority.test.js',
    'out/test/suite/performance-monitor.test.js'
];

testFiles.forEach(file => {
    mocha.addFile(path.resolve(__dirname, file));
});

// 运行测试
mocha.run((failures) => {
    process.exit(failures ? 1 : 0);
});