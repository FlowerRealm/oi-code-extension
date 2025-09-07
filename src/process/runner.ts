/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Allowed safe commands for execution
 */
const ALLOWED_COMMANDS = new Set([
    // Compilers
    'clang',
    'clang++',
    'gcc',
    'g++',
    'cc',
    'c++',
    'cl',
    // System utilities
    'which',
    'where',
    'find',
    'ps',
    'df',
    'wmic',
    // Package managers
    'apt',
    'apt-get',
    'dnf',
    'yum',
    'pacman',
    'zypper',
    'brew',
    // Build tools
    'make',
    'cmake',
    'ninja',
    // Windows specific
    'vswhere',
    'cmd',
    'powershell',
    // macOS specific
    'xcode-select',
    // Shell for testing
    'sh',
    'bash',
    'zsh'
]);

/**
 * Sanitizes a command argument to prevent command injection
 */
function sanitizeArgument(arg: string): string {
    // Remove potentially dangerous characters
    return (
        arg
            .replace(/[;&|`$(){}<>]/g, '') // Remove shell metacharacters
            // eslint-disable-next-line no-control-regex
            .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
            .trim()
    );
}

/**
 * Validates if a command is safe to execute
 */
function validateCommand(command: string): boolean {
    const baseCommand = path.basename(command, path.extname(command)).toLowerCase();

    // Check if it's an allowed command
    if (ALLOWED_COMMANDS.has(baseCommand)) {
        return true;
    }

    // Check if it's an absolute path to an executable (like installer)
    if (path.isAbsolute(command)) {
        // For absolute paths, we need to validate the extension
        const ext = path.extname(command).toLowerCase();
        const allowedExts = ['.exe', '.msi', '.bat', '.cmd', '.ps1', '.sh', '.dmg', '.pkg'];

        // Check for safe path patterns
        const normalizedPath = path.normalize(command);
        const safePaths = [
            process.env.TEMP,
            process.env.TMP,
            '/tmp',
            '/var/tmp',
            os.tmpdir(),
            '/tmp/oi-code', // Test directory
            `${os.tmpdir()}/oi-code` // Test directory on other platforms
        ].filter(Boolean);

        // Check if the path is in a safe directory
        const isInSafeDir = safePaths.some(safePath => safePath && normalizedPath.startsWith(path.normalize(safePath)));

        // Allow files with allowed extensions OR files without extensions in safe directories
        // (for compiled executables in test directories)
        const hasAllowedExt = allowedExts.includes(ext);
        const hasNoExt = ext === '';

        return isInSafeDir && (hasAllowedExt || hasNoExt);
    }

    return false;
}

/**
 * Validates and sanitizes command arguments
 */
function validateAndSanitizeArgs(args: string[]): string[] {
    return args.map(arg => {
        if (typeof arg !== 'string') {
            throw new Error(`Invalid argument type: ${typeof arg}`);
        }
        return sanitizeArgument(arg);
    });
}

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

        // Validate and sanitize inputs
        if (!command || typeof command !== 'string') {
            throw new Error('Invalid command: command must be a non-empty string');
        }

        if (!validateCommand(command)) {
            throw new Error(`Command not allowed for security reasons: ${command}`);
        }

        const sanitizedArgs = validateAndSanitizeArgs(args || []);

        return new Promise(resolve => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let memoryExceeded = false;
            let killed = false;

            const startTime = Date.now();
            const timeoutId =
                timeout > 0
                    ? setTimeout(() => {
                        timedOut = true;
                        killed = true;
                        child.kill('SIGKILL');
                        outputChannel?.appendLine(`[ProcessRunner] Process timed out after ${timeout}ms`);
                    }, timeout)
                    : undefined;

            // Memory monitoring for all platforms
            let memoryMonitorInterval: NodeJS.Timeout | undefined;
            if (memoryLimit) {
                memoryMonitorInterval = setInterval(async () => {
                    if (!killed) {
                        try {
                            if (child.pid) {
                                const memoryUsageMB = await this.getProcessMemoryUsage(child.pid);
                                if (memoryUsageMB > memoryLimit) {
                                    memoryExceeded = true;
                                    killed = true;
                                    child.kill('SIGKILL');
                                    outputChannel?.appendLine(
                                        `[ProcessRunner] Process exceeded memory limit: ${memoryLimit}MB ` +
                                            `(used: ${memoryUsageMB.toFixed(2)}MB)`
                                    );
                                }
                            }
                        } catch (error) {
                            // If we can't get memory usage, continue without monitoring
                            outputChannel?.appendLine(`[ProcessRunner] Failed to get memory usage: ${error}`);
                        }
                    }
                }, 100);
            }

            const child = spawn(command, sanitizedArgs, {
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
            child.stdout?.on('data', data => {
                stdout += data.toString();
            });

            // Handle stderr
            child.stderr?.on('data', data => {
                stderr += data.toString();
            });

            // Handle process exit
            child.on('exit', (exitCode, signal) => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                if (memoryMonitorInterval) {
                    clearInterval(memoryMonitorInterval);
                }

                const executionTime = Date.now() - startTime;
                outputChannel?.appendLine(
                    `[ProcessRunner] Process completed in ${executionTime}ms ` + `with exit code: ${exitCode}`
                );

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
            child.on('error', error => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                if (memoryMonitorInterval) {
                    clearInterval(memoryMonitorInterval);
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
        // Validate inputs
        if (!command || typeof command !== 'string') {
            throw new Error('Invalid command: command must be a non-empty string');
        }

        if (!Array.isArray(args)) {
            throw new Error('Invalid args: args must be an array');
        }

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
                // Use PowerShell instead of wmic for better compatibility, especially on Windows ARM
                const driveLetter = path.parse(directory).root.replace(/\\/g, '');
                command = `powershell -Command "Get-PSDrive -Name ${driveLetter} | Select-Object -ExpandProperty Free"`;
            } else {
                command = `df -k "${directory}"`;
            }

            const { stdout } = await exec(command);

            if (process.platform === 'win32') {
                // PowerShell outputs free space in bytes directly
                const freeSpaceBytes = parseInt(stdout.trim());
                if (!isNaN(freeSpaceBytes)) {
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
     * Get process memory usage in MB
     */
    private static async getProcessMemoryUsage(pid: number): Promise<number> {
        try {
            if (process.platform === 'linux') {
                const stats = await fs.readFile(`/proc/${pid}/statm`, 'utf-8');
                const rss = parseInt(stats.split(' ')[1]) * 4096; // Standard page size is 4KB
                return rss / (1024 * 1024);
            } else if (process.platform === 'darwin') {
                const { execSync } = require('child_process');
                const command = `ps -p ${pid} -o rss=`;
                const output = execSync(command, { encoding: 'utf-8' }).trim();
                const rss = parseInt(output);
                return rss / 1024;
            } else if (process.platform === 'win32') {
                // Use PowerShell to get memory usage on Windows
                const { execSync } = require('child_process');
                const command = `powershell "Get-Process -Id ${pid} | Select-Object -ExpandProperty WorkingSet"`;
                const output = execSync(command, { encoding: 'utf-8' }).trim();
                const workingSetBytes = parseInt(output);
                return workingSetBytes / (1024 * 1024);
            }
            return 0;
        } catch (error) {
            throw new Error(`Failed to get memory usage for PID ${pid}: ${error}`);
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
