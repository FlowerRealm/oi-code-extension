/*
 * @Author: FlowerRealm admin@flowerrealm.top
 * @Date: 2025-08-13 22:14:58
 * @LastEditors: FlowerRealm admin@flowerrealm.top
 * @LastEditTime: 2025-08-25 16:14:17
 * @FilePath: /oi-code/src/test/runTest.ts
 */
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to the extension test script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                '--no-sandbox',
                '--disable-extensions'
            ]
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();
