# OI-Code Extension 使用示例

本文档提供了 OI-Code 扩展的实际使用示例，涵盖了从基础到高级的各种应用场景。

## 目录

1. [基础使用](#基础使用)
2. [竞赛题目解题](#竞赛题目解题)
3. [算法验证和优化](#算法验证和优化)
4. [自动化测试](#自动化测试)
5. [性能分析](#性能分析)
6. [批量处理](#批量处理)

## 基础使用

### 1. Hello World 程序

```cpp
// hello.cpp
#include <iostream>
using namespace std;

int main() {
    cout << "Hello, OI!" << endl;
    return 0;
}
```

**使用步骤：**
1. 在 VS Code 中打开 `hello.cpp`
2. 按 `Ctrl+Shift+P` 打开命令面板
3. 输入 `OI-Code: Run Code`
4. 查看输出：`Hello, OI!`

### 2. 带输入的程序

```cpp
// sum.cpp
#include <iostream>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}
```

**测试步骤：**
1. 创建题目：`OI-Code: Create Problem` → 名称：`Sum Problem` → 语言：`C++`
2. 在打开的文件中粘贴上述代码
3. 执行代码并输入：`5 3`
4. 预期输出：`8`

## 竞赛题目解题

### 例题：A+B Problem

**题目描述：**
输入两个整数 A 和 B，输出它们的和。

**解题步骤：**

#### 步骤 1：创建题目
```bash
# 通过命令面板
Ctrl+Shift+P → "OI-Code: Create Problem"
题目名称：A+B Problem
编程语言：C++
```

#### 步骤 2：编写代码
```cpp
// main.cpp
#include <iostream>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}
```

#### 步骤 3：测试用例

```cpp
// 测试用例 1：正常情况
输入：5 3
预期输出：8

// 测试用例 2：负数
输入：-5 10
预期输出：5

// 测试用例 3：零
输入：0 0
预期输出：0

// 测试用例 4：大数
输入：1000000 2000000
预期输出：3000000
```

#### 步骤 4：执行测试
```bash
# 在 VS Code 中
Ctrl+Shift+P → "OI-Code: Run Code"
输入：5 3
输出：8 ✓
```

### 例题：斐波那契数列

**题目描述：**
计算斐波那契数列的第 n 项。

#### 暴力解法
```cpp
// fibonacci_recursive.cpp
#include <iostream>
using namespace std;

int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}

int main() {
    int n;
    cin >> n;
    cout << fib(n) << endl;
    return 0;
}
```

#### 优化解法
```cpp
// fibonacci_dp.cpp
#include <iostream>
using namespace std;

int fib(int n) {
    if (n <= 1) return n;
    
    int a = 0, b = 1, c;
    for (int i = 2; i <= n; i++) {
        c = a + b;
        a = b;
        b = c;
    }
    return b;
}

int main() {
    int n;
    cin >> n;
    cout << fib(n) << endl;
    return 0;
}
```

#### 使用对拍功能验证
1. 创建两个题目：`Fibonacci Recursive` 和 `Fibonacci DP`
2. 分别编写上述代码
3. 使用对拍功能：`OI-Code: Run Pair Check`
4. 输入测试数据验证两种算法的一致性

```bash
# 测试数据
10
# 预期：两种算法都输出 55

20
# 预期：两种算法都输出 6765
```

## 算法验证和优化

### 1. 排序算法验证

#### 冒泡排序 vs 快速排序

```cpp
// bubble_sort.cpp
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

void bubbleSort(vector<int>& arr) {
    int n = arr.size();
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                swap(arr[j], arr[j + 1]);
            }
        }
    }
}

int main() {
    int n;
    cin >> n;
    vector<int> arr(n);
    for (int i = 0; i < n; i++) {
        cin >> arr[i];
    }
    
    bubbleSort(arr);
    
    for (int i = 0; i < n; i++) {
        cout << arr[i] << " ";
    }
    cout << endl;
    
    return 0;
}
```

```cpp
// quick_sort.cpp
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int partition(vector<int>& arr, int low, int high) {
    int pivot = arr[high];
    int i = low - 1;
    
    for (int j = low; j < high; j++) {
        if (arr[j] < pivot) {
            i++;
            swap(arr[i], arr[j]);
        }
    }
    swap(arr[i + 1], arr[high]);
    return i + 1;
}

void quickSort(vector<int>& arr, int low, int high) {
    if (low < high) {
        int pi = partition(arr, low, high);
        quickSort(arr, low, pi - 1);
        quickSort(arr, pi + 1, high);
    }
}

int main() {
    int n;
    cin >> n;
    vector<int> arr(n);
    for (int i = 0; i < n; i++) {
        cin >> arr[i];
    }
    
    quickSort(arr, 0, n - 1);
    
    for (int i = 0; i < n; i++) {
        cout << arr[i] << " ";
    }
    cout << endl;
    
    return 0;
}
```

**测试数据生成：**
```cpp
// generate_test_data.cpp
#include <iostream>
#include <random>
using namespace std;

int main() {
    random_device rd;
    mt19937 gen(rd());
    uniform_int_distribution<> dis(1, 1000);
    
    int t = 10;
    while (t--) {
        int n = dis(gen) % 100 + 1; // 1-100 个数
        cout << n << endl;
        for (int i = 0; i < n; i++) {
            cout << dis(gen) << " ";
        }
        cout << endl;
    }
    return 0;
}
```

### 2. 动态规划验证

#### 最长递增子序列

```cpp
// lis_naive.cpp - O(n^2) 解法
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int lengthOfLIS(vector<int>& nums) {
    int n = nums.size();
    if (n == 0) return 0;
    
    vector<int> dp(n, 1);
    for (int i = 1; i < n; i++) {
        for (int j = 0; j < i; j++) {
            if (nums[i] > nums[j]) {
                dp[i] = max(dp[i], dp[j] + 1);
            }
        }
    }
    
    return *max_element(dp.begin(), dp.end());
}

int main() {
    int n;
    cin >> n;
    vector<int> nums(n);
    for (int i = 0; i < n; i++) {
        cin >> nums[i];
    }
    
    cout << lengthOfLIS(nums) << endl;
    return 0;
}
```

```cpp
// lis_optimized.cpp - O(n log n) 解法
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int lengthOfLIS(vector<int>& nums) {
    vector<int> tails;
    
    for (int num : nums) {
        auto it = lower_bound(tails.begin(), tails.end(), num);
        if (it == tails.end()) {
            tails.push_back(num);
        } else {
            *it = num;
        }
    }
    
    return tails.size();
}

int main() {
    int n;
    cin >> n;
    vector<int> nums(n);
    for (int i = 0; i < n; i++) {
        cin >> nums[i];
    }
    
    cout << lengthOfLIS(nums) << endl;
    return 0;
}
```

## 自动化测试

### 1. 批量测试脚本

```javascript
// test_runner.js - 在 VS Code 任务中运行
const vscode = require('vscode');

async function runBatchTests() {
    const testCases = [
        {
            name: 'A+B Problem',
            code: `#include <iostream>
using namespace std;
int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}`,
            tests: [
                { input: '5 3', expected: '8' },
                { input: '-5 10', expected: '5' },
                { input: '0 0', expected: '0' }
            ]
        },
        {
            name: 'Factorial',
            code: `#include <iostream>
using namespace std;
int main() {
    int n;
    cin >> n;
    long long fact = 1;
    for (int i = 2; i <= n; i++) {
        fact *= i;
    }
    cout << fact << endl;
    return 0;
}`,
            tests: [
                { input: '5', expected: '120' },
                { input: '10', expected: '3628800' },
                { input: '0', expected: '1' }
            ]
        }
    ];

    for (const problem of testCases) {
        console.log(`\\nTesting: ${problem.name}`);
        
        // 创建题目
        const result = await vscode.commands.executeCommand('oicode.createProblem', {
            name: `Test: ${problem.name}`,
            language: 'cpp'
        });
        
        // 写入代码
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(result.sourcePath));
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(0, 0), problem.code);
        });
        
        // 运行测试
        for (const test of problem.tests) {
            const execResult = await vscode.commands.executeCommand('oicode.runCode', test.input);
            
            if (execResult.error) {
                console.log(`  ✗ Test failed: ${execResult.error}`);
            } else if (execResult.output.trim() === test.expected) {
                console.log(`  ✓ Test passed: ${test.input} → ${test.expected}`);
            } else {
                console.log(`  ✗ Test failed: ${test.input} → Expected: ${test.expected}, Got: ${execResult.output.trim()}`);
            }
        }
        
        // 清理
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
}

runBatchTests();
```

### 2. 性能基准测试

```cpp
// performance_test.cpp
#include <iostream>
#include <vector>
#include <chrono>
#include <random>
using namespace std;
using namespace std::chrono;

// 测试不同的排序算法
void bubbleSort(vector<int>& arr) {
    int n = arr.size();
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                swap(arr[j], arr[j + 1]);
            }
        }
    }
}

void quickSort(vector<int>& arr, int low, int high) {
    if (low < high) {
        int pivot = arr[high];
        int i = low - 1;
        
        for (int j = low; j < high; j++) {
            if (arr[j] < pivot) {
                i++;
                swap(arr[i], arr[j]);
            }
        }
        swap(arr[i + 1], arr[high]);
        
        int pi = i + 1;
        quickSort(arr, low, pi - 1);
        quickSort(arr, pi + 1, high);
    }
}

int main() {
    int n;
    cin >> n;
    
    // 生成随机数据
    random_device rd;
    mt19937 gen(rd());
    uniform_int_distribution<> dis(1, 1000000);
    
    vector<int> arr1(n), arr2(n);
    for (int i = 0; i < n; i++) {
        int val = dis(gen);
        arr1[i] = val;
        arr2[i] = val;
    }
    
    // 测试冒泡排序
    auto start = high_resolution_clock::now();
    bubbleSort(arr1);
    auto stop = high_resolution_clock::now();
    auto bubbleDuration = duration_cast<microseconds>(stop - start);
    
    // 测试快速排序
    start = high_resolution_clock::now();
    quickSort(arr2, 0, n - 1);
    stop = high_resolution_clock::now();
    auto quickDuration = duration_cast<microseconds>(stop - start);
    
    cout << "Bubble Sort: " << bubbleDuration.count() << " microseconds" << endl;
    cout << "Quick Sort: " << quickDuration.count() << " microseconds" << endl;
    cout << "Speedup: " << (double)bubbleDuration.count() / quickDuration.count() << "x" << endl;
    
    return 0;
}
```

**使用方法：**
```bash
# 输入不同大小的数据集测试
1000
# 观察两种算法的性能差异

10000
# 在大数据集上快速排序的优势更明显
```

## 性能分析

### 1. 使用性能监控

```typescript
// 在代码中集成性能监控
import { PerformanceMonitor, measure } from './src/utils/performance-monitor';

async function analyzeAlgorithmPerformance() {
    const monitor = PerformanceMonitor.getInstance();
    
    // 测试不同算法的性能
    const algorithms = [
        'bubble_sort',
        'quick_sort', 
        'merge_sort',
        'heap_sort'
    ];
    
    const testDataSizes = [100, 1000, 5000, 10000];
    
    for (const size of testDataSizes) {
        console.log(`\\nTesting with data size: ${size}`);
        
        for (const algorithm of algorithms) {
            const result = await measure(`${algorithm}_${size}`, async () => {
                // 模拟算法执行
                await generateTestData(size);
                await executeAlgorithm(algorithm);
            });
            
            console.log(`  ${algorithm}: ${result.duration.toFixed(2)}ms`);
        }
    }
    
    // 生成性能报告
    console.log('\\n=== Performance Analysis Report ===');
    const stats = monitor.getStats();
    console.log(`Total measurements: ${stats.totalOperations}`);
    console.log(`Average time: ${stats.averageDuration.toFixed(2)}ms`);
    console.log(`Fastest algorithm: ${getFastestAlgorithm(stats)}`);
    
    monitor.showReport();
}
```

### 2. 内存使用分析

```cpp
// memory_analysis.cpp
#include <iostream>
#include <vector>
#include <chrono>
#include <iomanip>
using namespace std;

size_t getCurrentMemoryUsage() {
    // 简化的内存使用估算
    return 0; // 实际实现需要平台特定的内存查询
}

void analyzeMemoryUsage() {
    vector<int> sizes = {1000, 10000, 100000, 1000000};
    
    cout << "Data Size\tMemory (MB)\tTime (ms)" << endl;
    cout << "----------------------------------------" << endl;
    
    for (int size : sizes) {
        auto start = chrono::high_resolution_clock::now();
        
        // 分配内存
        vector<int> data(size);
        for (int i = 0; i < size; i++) {
            data[i] = i;
        }
        
        // 执行操作
        long long sum = 0;
        for (int num : data) {
            sum += num;
        }
        
        auto end = chrono::high_resolution_clock::now();
        auto duration = chrono::duration_cast<chrono::milliseconds>(end - start);
        
        double memoryMB = (size * sizeof(int)) / (1024.0 * 1024.0);
        
        cout << fixed << setprecision(2);
        cout << size << "\t\t" << memoryMB << "\t\t" << duration.count() << endl;
    }
}

int main() {
    analyzeMemoryUsage();
    return 0;
}
```

## 批量处理

### 1. 批量题目创建

```javascript
// batch_create_problems.js
const problems = [
    {
        name: 'Basic Math',
        language: 'cpp',
        template: `#include <iostream>
using namespace std;

int main() {
    // TODO: 实现基本数学运算
    return 0;
}`
    },
    {
        name: 'String Processing',
        language: 'cpp',
        template: `#include <iostream>
#include <string>
using namespace std;

int main() {
    // TODO: 实现字符串处理
    return 0;
}`
    },
    {
        name: 'Array Operations',
        language: 'cpp',
        template: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    // TODO: 实现数组操作
    return 0;
}`
    }
];

async function createProblemsBatch() {
    for (const problem of problems) {
        console.log(`Creating problem: ${problem.name}`);
        
        try {
            const result = await vscode.commands.executeCommand('oicode.createProblem', {
                name: problem.name,
                language: problem.language
            });
            
            // 写入模板代码
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(result.sourcePath));
            const editor = await vscode.window.showTextDocument(doc);
            await editor.edit(editBuilder => {
                editBuilder.insert(new vscode.Position(0, 0), problem.template);
            });
            
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            console.log(`  ✓ Created: ${result.problemDir}`);
            
        } catch (error) {
            console.error(`  ✗ Failed to create ${problem.name}: ${error}`);
        }
    }
    
    console.log('\\nBatch creation completed!');
}

createProblemsBatch();
```

### 2. 批量数据生成

```cpp
// data_generator.cpp
#include <iostream>
#include <fstream>
#include <random>
#include <vector>
using namespace std;

// 生成随机数组
vector<int> generateRandomArray(int size, int minVal, int maxVal) {
    random_device rd;
    mt19937 gen(rd());
    uniform_int_distribution<> dis(minVal, maxVal);
    
    vector<int> arr(size);
    for (int i = 0; i < size; i++) {
        arr[i] = dis(gen);
    }
    return arr;
}

// 生成排序数组
vector<int> generateSortedArray(int size, int minVal, int maxVal) {
    vector<int> arr = generateRandomArray(size, minVal, maxVal);
    sort(arr.begin(), arr.end());
    return arr;
}

// 生成逆序数组
vector<int> generateReverseSortedArray(int size, int minVal, int maxVal) {
    vector<int> arr = generateSortedArray(size, minVal, maxVal);
    reverse(arr.begin(), arr.end());
    return arr;
}

// 生成重复元素数组
vector<int> generateDuplicateArray(int size, int uniqueValues) {
    random_device rd;
    mt19937 gen(rd());
    uniform_int_distribution<> dis(1, uniqueValues);
    
    vector<int> arr(size);
    for (int i = 0; i < size; i++) {
        arr[i] = dis(gen);
    }
    return arr;
}

void saveArrayToFile(const vector<int>& arr, const string& filename) {
    ofstream outFile(filename);
    outFile << arr.size() << endl;
    for (int num : arr) {
        outFile << num << " ";
    }
    outFile << endl;
    outFile.close();
}

int main() {
    vector<pair<int, string>> testCases = {
        {100, "small_random"},
        {1000, "medium_random"},
        {10000, "large_random"},
        {50000, "very_large_random"},
        {10000, "sorted"},
        {10000, "reverse_sorted"},
        {10000, "duplicates"}
    };
    
    for (const auto& [size, name] : testCases) {
        string filename = "test_data_" + name + ".txt";
        vector<int> data;
        
        if (name == "sorted") {
            data = generateSortedArray(size, 1, 1000000);
        } else if (name == "reverse_sorted") {
            data = generateReverseSortedArray(size, 1, 1000000);
        } else if (name == "duplicates") {
            data = generateDuplicateArray(size, 100);
        } else {
            data = generateRandomArray(size, 1, 1000000);
        }
        
        saveArrayToFile(data, filename);
        cout << "Generated: " << filename << endl;
    }
    
    cout << "\\nAll test data generated successfully!" << endl;
    return 0;
}
```

## 最佳实践

### 1. 代码组织
- 每个题目单独一个目录
- 使用有意义的文件名
- 添加必要的注释

### 2. 测试策略
- 边界测试（最小值、最大值、空值）
- 随机测试
- 性能测试
- 对拍验证

### 3. 调试技巧
- 使用中间输出调试
- 分步验证算法
- 利用对拍功能发现问题

### 4. 性能优化
- 分析时间复杂度
- 考虑空间复杂度
- 使用性能监控工具
- 选择合适的算法

这些示例涵盖了 OI-Code 扩展的主要功能和使用场景。通过这些示例，你可以更好地理解如何在实际的算法竞赛和学习中使用这个扩展。