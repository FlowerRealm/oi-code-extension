import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 扩展专用设置管理器
 * 与用户settings.json分离，存储扩展的配置状态
 */
export class ExtensionSettings {
    private static context: vscode.ExtensionContext | null = null;
    private static settingsPath: string = '';
    private static settings: {
        initialized: boolean;
        initializationDate: string | null;
        version: string;
        compilers: Record<string, string | null>;
        workspace: string | null;
        llvm: {
            installed: boolean;
            version: string | null;
            installPath: string | null;
            lastUpdated: string | null;
        };
        preferences: Record<string, unknown>;
    } | null = null;

    /**
     * 初始化设置管理器
     */
    public static async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;
        this.settingsPath = path.join(context.globalStorageUri.fsPath, 'settings.json');

        // 确保目录存在
        await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });

        // 加载设置
        await this.loadSettings();
    }

    /**
     * 加载设置文件
     */
    private static async loadSettings(): Promise<void> {
        try {
            const data = await fs.readFile(this.settingsPath, 'utf8');
            this.settings = JSON.parse(data);
        } catch (error) {
            // 文件不存在或解析失败，使用默认设置
            this.settings = this.getDefaultSettings();
            await this.saveSettings();
        }
    }

    /**
     * 获取默认设置
     */
    private static getDefaultSettings(): {
        initialized: boolean;
        initializationDate: string | null;
        version: string;
        compilers: Record<string, string | null>;
        workspace: string | null;
        llvm: {
            installed: boolean;
            version: string | null;
            installPath: string | null;
            lastUpdated: string | null;
        };
        preferences: Record<string, unknown>;
        } {
        return {
            initialized: false,
            initializationDate: null,
            version: '1.0.0',
            compilers: {
                c: null,
                cpp: null
            },
            workspace: null,
            llvm: {
                installed: false,
                version: null,
                installPath: null,
                lastUpdated: null
            },
            preferences: {
                defaultLanguage: 'cpp',
                autoSave: true,
                showWelcome: true
            }
        };
    }

    /**
     * 保存设置到文件
     */
    public static async saveSettings(): Promise<void> {
        if (!this.settingsPath) {
            throw new Error('ExtensionSettings not initialized');
        }

        try {
            await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2));
        } catch (error) {
            console.error('Failed to save extension settings:', error);
            throw error;
        }
    }

    /**
     * 检查是否已完成初始化
     */
    public static isInitialized(): boolean {
        return this.settings?.initialized || false;
    }

    /**
     * 标记初始化完成
     */
    public static async markInitialized(): Promise<void> {
        if (!this.settings) {
            await this.loadSettings();
        }

        if (this.settings) {
            this.settings.initialized = true;
            this.settings.initializationDate = new Date().toISOString();
            await this.saveSettings();
        }
    }

    /**
     * 重置初始化状态
     */
    public static async resetInitialization(): Promise<void> {
        if (!this.settings) {
            await this.loadSettings();
        }

        if (this.settings) {
            this.settings.initialized = false;
            this.settings.initializationDate = null;
            await this.saveSettings();
        }
    }

    /**
     * 设置编译器配置
     */
    public static async setCompiler(language: 'c' | 'cpp', compilerPath: string): Promise<void> {
        if (!this.settings) {
            await this.loadSettings();
        }

        if (this.settings) {
            this.settings.compilers[language] = compilerPath;
            await this.saveSettings();
        }
    }

    /**
     * 获取编译器配置
     */
    public static getCompiler(language: 'c' | 'cpp'): string | null {
        return this.settings?.compilers?.[language] || null;
    }

    /**
     * 设置工作区路径
     */
    public static async setWorkspace(workspacePath: string): Promise<void> {
        if (!this.settings) {
            await this.loadSettings();
        }

        if (this.settings) {
            this.settings.workspace = workspacePath;
            await this.saveSettings();
        }
    }

    /**
     * 获取工作区路径
     */
    public static getWorkspace(): string | null {
        return this.settings?.workspace || null;
    }

    /**
     * 设置LLVM安装信息
     */
    public static async setLLVMInfo(info: { installed: boolean; version: string; installPath: string }): Promise<void> {
        if (!this.settings) {
            await this.loadSettings();
        }

        if (this.settings) {
            this.settings.llvm = {
                ...this.settings.llvm,
                ...info,
                lastUpdated: new Date().toISOString()
            };
            await this.saveSettings();
        }
    }

    /**
     * 获取LLVM安装信息
     */
    public static getLLVMInfo(): Record<string, unknown> {
        return (this.settings?.llvm as Record<string, unknown>) || {};
    }

    /**
     * 获取所有设置
     */
    public static getAllSettings(): Record<string, unknown> {
        return { ...(this.settings || {}) };
    }

    /**
     * 更新偏好设置
     */
    public static async updatePreferences(preferences: Record<string, unknown>): Promise<void> {
        if (!this.settings) {
            await this.loadSettings();
        }

        if (this.settings) {
            const currentPreferences = (this.settings.preferences as Record<string, unknown>) || {};
            this.settings.preferences = {
                ...currentPreferences,
                ...preferences
            };
            await this.saveSettings();
        }
    }

    /**
     * 获取偏好设置
     */
    public static getPreferences(): Record<string, unknown> {
        return (this.settings?.preferences as Record<string, unknown>) || {};
    }
}
