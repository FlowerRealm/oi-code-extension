/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import Mocha = require('mocha');
const { glob } = require('glob');

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });
    const testsRoot = path.resolve(__dirname, '..');
    try {
        const files: string[] = await glob('**/**.test.js', { cwd: testsRoot });
        files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));
        await new Promise<void>((c, e) => {
            try {
                mocha.run((failures: number) => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                console.error(err);
                e(err);
            }
        });
    } catch (err) {
        console.error(err);
        throw err;
    }
}