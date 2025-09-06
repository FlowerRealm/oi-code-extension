/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Execution options for process runner
 */
export interface ProcessExecutionOptions {
    command: string;
    args: string[];
    cwd?: string;
    timeout?: number;
    memoryLimit?: number;
    input?: string;
    outputChannel?: vscode.OutputChannel;
}

/**
 * Execution result
 */
export interface ProcessExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    memoryExceeded: boolean;
    signal: string | null;
}

/**
 * Handles process execution with resource limits and timeout enforcement
 */
export class ProcessRunner {
    /**
     * Execute a command with timeout and memory limits
     */
    public static async executeWithTimeout(options: ProcessExecutionOptions): Promise<ProcessExecutionResult> {
        const { command, args, cwd = process.cwd(), timeout = 30000, memoryLimit, input = '', outputChannel } = options;

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let memoryExceeded = false;
            let killed = false;

            const startTime = Date.now();
            const timeoutId = timeout > 0 ? setTimeout(() => {
                timedOut = true;
                killed = true;
                child.kill('SIGKILL');
                outputChannel?.appendLine(`[ProcessRunner] Process timed out after ${timeout}ms`);
            }, timeout) : undefined;

            const child = spawn(command, args, {
                cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env },
                windowsHide: true
            });

            // Handle input
            if (input) {
                child.stdin?.write(input);
                child.stdin?.end();
            }

            // Handle stdout
            child.stdout?.on('data', (data) => {
                stdout += data.toString();
                if (memoryLimit && stdout.length > memoryLimit * 1024 * 1024) {
                    memoryExceeded = true;
                    killed = true;
                    child.kill('SIGKILL');
                    outputChannel?.appendLine(`[ProcessRunner] Process exceeded memory limit: ${memoryLimit}MB`);
                }
            });

            // Handle stderr
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            // Handle process exit
            child.on('exit', (exitCode, signal) => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }

                const executionTime = Date.now() - startTime;
                outputChannel?.appendLine(`[ProcessRunner] Process completed in ${executionTime}ms with exit code: ${exitCode}`);

                resolve({
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exitCode,
                    timedOut: killed && timedOut,
                    memoryExceeded: killed && memoryExceeded,
                    signal: killed ? 'SIGKILL' : signal
                });
            });

            // Handle process error
            child.on('error', (error) => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                outputChannel?.appendLine(`[ProcessRunner] Process error: ${error.message}`);
                resolve({
                    stdout: '',
                    stderr: error.message,
                    exitCode: -1,
                    timedOut: false,
                    memoryExceeded: false,
                    signal: null
                });
            });
        });
    }

    /**
     * Execute a simple command with default timeout
     */
    public static async executeCommand(
        command: string,
        args: string[],
        cwd?: string,
        outputChannel?: vscode.OutputChannel
    ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
        const result = await this.executeWithTimeout({
            command,
            args,
            cwd,
            timeout: 30000,
            outputChannel
        });

        return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode
        };
    }

    /**
     * Check if disk space is available
     */
    public static async checkDiskSpace(directory: string, requiredSpaceMB: number = 100): Promise<boolean> {
        try {
            const util = require('util');
            const exec = util.promisify(require('child_process').exec);

            let command: string;
            if (process.platform === 'win32') {
                command = `wmic logicaldisk where "DeviceID='${path.parse(directory).root.replace('\\', '')}'" get FreeSpace`;
            } else {
                command = `df -k "${directory}"`;
            }

            const { stdout } = await exec(command);

            if (process.platform === 'win32') {
                const match = stdout.match(/(\d+)/);
                if (match) {
                    const freeSpaceBytes = parseInt(match[1]);
                    return freeSpaceBytes > requiredSpaceMB * 1024 * 1024;
                }
            } else {
                const lines = stdout.split('\n');
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].trim().split(/\s+/);
                    if (parts.length >= 4) {
                        const freeSpaceKB = parseInt(parts[3]);
                        return freeSpaceKB > requiredSpaceMB * 1024;
                    }
                }
            }

            return true;
        } catch (error) {
            console.warn('[ProcessRunner] Failed to check disk space:', error);
            return true;
        }
    }

    /**
     * Check if a file exists
     */
    public static async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}
