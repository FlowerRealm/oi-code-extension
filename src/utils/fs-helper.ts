import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * File system utilities for the extension
 */
export class FsHelper {
    /**
   * Check if a file exists
   */
    static async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
   * Check if a directory exists
   */
    static async directoryExists(dirPath: string): Promise<boolean> {
        try {
            const stats = await fs.stat(dirPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    /**
   * Create directory recursively
   */
    static async createDirectory(dirPath: string): Promise<void> {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error instanceof Error && !error.message.includes('already exists')) {
                throw error;
            }
        }
    }

    /**
   * Read file content
   */
    static async readFile(filePath: string): Promise<string> {
        return await fs.readFile(filePath, 'utf-8');
    }

    /**
   * Write file content
   */
    static async writeFile(filePath: string, content: string): Promise<void> {
        await fs.writeFile(filePath, content, 'utf-8');
    }

    /**
   * Append content to file
   */
    static async appendFile(filePath: string, content: string): Promise<void> {
        await fs.appendFile(filePath, content, 'utf-8');
    }

    /**
   * Delete file
   */
    static async deleteFile(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
        } catch (error) {
            if (error instanceof Error && !error.message.includes('ENOENT')) {
                throw error;
            }
        }
    }

    /**
   * Delete directory recursively
   */
    static async deleteDirectory(dirPath: string): Promise<void> {
        try {
            await fs.rm(dirPath, { recursive: true, force: true });
        } catch (error) {
            if (error instanceof Error && !error.message.includes('ENOENT')) {
                throw error;
            }
        }
    }

    /**
   * Copy file
   */
    static async copyFile(sourcePath: string, targetPath: string): Promise<void> {
        await fs.copyFile(sourcePath, targetPath);
    }

    /**
   * Copy directory recursively
   */
    static async copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
        await this.createDirectory(targetPath);

        const entries = await fs.readdir(sourcePath, { withFileTypes: true });

        for (const entry of entries) {
            const sourceEntryPath = path.join(sourcePath, entry.name);
            const targetEntryPath = path.join(targetPath, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectory(sourceEntryPath, targetEntryPath);
            } else {
                await this.copyFile(sourceEntryPath, targetEntryPath);
            }
        }
    }

    /**
   * Move file
   */
    static async moveFile(sourcePath: string, targetPath: string): Promise<void> {
        await fs.rename(sourcePath, targetPath);
    }

    /**
   * List files in directory
   */
    static async listFiles(dirPath: string, recursive: boolean = false): Promise<string[]> {
        const files: string[] = [];

        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = path.join(dirPath, entry.name);

            if (entry.isFile()) {
                files.push(entryPath);
            } else if (entry.isDirectory() && recursive) {
                const subFiles = await this.listFiles(entryPath, recursive);
                files.push(...subFiles);
            }
        }

        return files;
    }

    /**
   * List directories
   */
    static async listDirectories(dirPath: string): Promise<string[]> {
        const directories: string[] = [];

        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                directories.push(path.join(dirPath, entry.name));
            }
        }

        return directories;
    }

    /**
   * Get file size
   */
    static async getFileSize(filePath: string): Promise<number> {
        const stats = await fs.stat(filePath);
        return stats.size;
    }

    /**
   * Get file modification time
   */
    static async getFileModifiedTime(filePath: string): Promise<Date> {
        const stats = await fs.stat(filePath);
        return stats.mtime;
    }

    /**
   * Get file creation time
   */
    static async getFileCreatedTime(filePath: string): Promise<Date> {
        const stats = await fs.stat(filePath);
        return stats.birthtime;
    }

    /**
   * Join path segments
   */
    static joinPath(...segments: string[]): string {
        return path.join(...segments);
    }

    /**
   * Get file extension
   */
    static getFileExtension(filePath: string): string {
        return path.extname(filePath);
    }

    /**
   * Get file name without extension
   */
    static getFileNameWithoutExtension(filePath: string): string {
        const baseName = path.basename(filePath);
        const extName = path.extname(filePath);
        return baseName.slice(0, baseName.length - extName.length);
    }

    /**
   * Get directory name from path
   */
    static getDirectoryName(filePath: string): string {
        return path.dirname(filePath);
    }

    /**
   * Normalize path
   */
    static normalizePath(filePath: string): string {
        return path.normalize(filePath);
    }

    /**
   * Resolve relative path
   */
    static resolvePath(...segments: string[]): string {
        return path.resolve(...segments);
    }

    /**
   * Get relative path
   */
    static getRelativePath(fromPath: string, toPath: string): string {
        return path.relative(fromPath, toPath);
    }

    /**
   * Create temporary file
   */
    static async createTempFile(prefix: string, suffix: string = '.tmp'): Promise<string> {
        const tempDir = path.join(os.tmpdir(), 'oi-code');
        await this.createDirectory(tempDir);

        const tempFile = path.join(tempDir, `${prefix}-${Date.now()}${suffix}`);
        await this.writeFile(tempFile, '');

        return tempFile;
    }

    /**
   * Create temporary directory
   */
    static async createTempDirectory(prefix: string = 'oi-code-'): Promise<string> {
        const tempDir = path.join(os.tmpdir(), prefix + Date.now());
        await this.createDirectory(tempDir);
        return tempDir;
    }

    /**
   * Clean up temporary files older than specified time
   */
    static async cleanupTempFiles(olderThan: number = 24 * 60 * 60 * 1000): Promise<void> {
        const tempDir = path.join(os.tmpdir(), 'oi-code');

        if (!(await this.directoryExists(tempDir))) {
            return;
        }

        const files = await this.listFiles(tempDir, true);
        const cutoffTime = Date.now() - olderThan;

        for (const file of files) {
            const modifiedTime = await this.getFileModifiedTime(file);
            if (modifiedTime.getTime() < cutoffTime) {
                try {
                    await this.deleteFile(file);
                } catch (error) {
                    console.warn(`Failed to delete temp file: ${file}`, error);
                }
            }
        }
    }

    /**
   * Get file hash
   */
    static async getFileHash(filePath: string): Promise<string> {
        const crypto = require('crypto');
        const content = await this.readFile(filePath);
        return crypto.createHash('md5').update(content).digest('hex');
    }

    /**
   * Find files by pattern
   */
    static async findFiles(rootDir: string, pattern: string): Promise<string[]> {
        const files: string[] = [];

        const entries = await fs.readdir(rootDir, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = path.join(rootDir, entry.name);

            if (entry.isFile() && this.matchesPattern(entry.name, pattern)) {
                files.push(entryPath);
            } else if (entry.isDirectory()) {
                const subFiles = await this.findFiles(entryPath, pattern);
                files.push(...subFiles);
            }
        }

        return files;
    }

    /**
   * Check if file name matches pattern
   */
    private static matchesPattern(fileName: string, pattern: string): boolean {
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        return regex.test(fileName);
    }
}

// Node.js os module import
declare const os: typeof import('os');
