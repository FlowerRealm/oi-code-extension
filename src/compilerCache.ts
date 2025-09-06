/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
// Interface definitions moved to nativeCompilerManager to avoid circular imports

/**
 * Compiler detection result
 */
export interface CompilerDetectionResult {
    success: boolean;
    compilers: any[];
    recommended?: any;
    error?: string;
    suggestions: string[];
    cacheVersion?: string;
    cachedAt?: number;
}

/**
 * Manages caching of detected compilers
 */
export class CompilerCache {
    private static readonly CACHE_KEY = 'oicode.cachedCompilers';
    private static readonly CACHE_VERSION = '1.0';
    private static cachedCompilers: CompilerDetectionResult | null = null;

    /**
     * Load cached compilers from global state
     */
    public static async loadCachedCompilers(context: vscode.ExtensionContext): Promise<CompilerDetectionResult | null> {
        if (this.cachedCompilers) {
            return this.cachedCompilers;
        }

        try {
            const cached = context.globalState.get<CompilerDetectionResult>(this.CACHE_KEY);
            if (cached && cached.cacheVersion === this.CACHE_VERSION) {
                this.cachedCompilers = cached;
                return cached;
            }
        } catch (error) {
            console.warn('[CompilerCache] Failed to load cached compilers:', error);
        }

        return null;
    }

    /**
     * Save compiler detection result to cache
     */
    public static async saveCachedCompilers(
        context: vscode.ExtensionContext,
        result: CompilerDetectionResult
    ): Promise<void> {
        try {
            const cachedResult = {
                ...result,
                cacheVersion: this.CACHE_VERSION,
                cachedAt: Date.now()
            };
            await context.globalState.update(this.CACHE_KEY, cachedResult);
            this.cachedCompilers = cachedResult;
        } catch (error) {
            console.warn('[CompilerCache] Failed to save cached compilers:', error);
        }
    }

    /**
     * Clear cached compilers
     */
    public static async clearCachedCompilers(context: vscode.ExtensionContext): Promise<void> {
        try {
            await context.globalState.update(this.CACHE_KEY, undefined);
            this.cachedCompilers = null;
        } catch (error) {
            console.warn('[CompilerCache] Failed to clear cached compilers:', error);
        }
    }

    /**
     * Get in-memory cached compilers
     */
    public static getCachedCompilers(): CompilerDetectionResult | null {
        return this.cachedCompilers;
    }

    /**
     * Set in-memory cached compilers
     */
    public static setCachedCompilers(result: CompilerDetectionResult): void {
        this.cachedCompilers = result;
    }
}
