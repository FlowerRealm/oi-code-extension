import { Problem, CodeTemplate, ProgrammingLanguage } from '../types/models';

/**
 * Code template generator for different programming languages
 */
export class TemplateGenerator {
    private static templates: Map<ProgrammingLanguage, CodeTemplate[]> = new Map();

    /**
   * Initialize default templates
   */
    static initialize(): void {
        this.templates.set('c', [
            {
                language: 'c',
                fileName: 'main.c',
                code: `#include <stdio.h>
#include <stdlib.h>

int main() {
    // Your code here
    
    return 0;
}`,
                includes: ['stdio.h', 'stdlib.h'],
                mainFunction: true,
                description: 'Basic C template'
            },
            {
                language: 'c',
                fileName: 'main.c',
                code: `#include <stdio.h>
#include <stdlib.h>

int main() {
    int n;
    scanf("%d", &n);
    
    // Your code here
    
    return 0;
}`,
                includes: ['stdio.h', 'stdlib.h'],
                mainFunction: true,
                description: 'C template with input'
            }
        ]);

        this.templates.set('cpp', [
            {
                language: 'cpp',
                fileName: 'main.cpp',
                code: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    // Your code here
    
    return 0;
}`,
                includes: ['iostream', 'vector', 'algorithm'],
                mainFunction: true,
                description: 'Basic C++ template'
            },
            {
                language: 'cpp',
                fileName: 'main.cpp',
                code: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    
    int n;
    cin >> n;
    
    // Your code here
    
    return 0;
}`,
                includes: ['iostream', 'vector', 'algorithm'],
                mainFunction: true,
                description: 'C++ template with fast I/O'
            }
        ]);

    // Only C and C++ are supported in this project
    }

    /**
   * Get templates for a specific language
   */
    static getTemplates(language: ProgrammingLanguage): CodeTemplate[] {
        if (!this.templates.has(language)) {
            return [];
        }
        return this.templates.get(language)!;
    }

    /**
   * Get all available templates
   */
    static getAllTemplates(): CodeTemplate[] {
        const allTemplates: CodeTemplate[] = [];
        for (const templates of this.templates.values()) {
            allTemplates.push(...templates);
        }
        return allTemplates;
    }

    /**
   * Generate template based on problem type
   */
    static generateTemplate(problem: Problem, language: ProgrammingLanguage): CodeTemplate {
        const templates = this.getTemplates(language);

        if (templates.length === 0) {
            return {
                language,
                fileName: `main.${this.getFileExtension(language)}`,
                code: this.generateBasicTemplate(language),
                includes: this.extractIncludes(this.generateBasicTemplate(language)),
                mainFunction: true,
                description: 'Basic template'
            };
        }

        // Select template based on problem characteristics
        const template = this.selectTemplateForProblem(problem, templates);

        return {
            ...template,
            language,
            fileName: `main.${this.getFileExtension(language)}`
        };
    }

    /**
   * Generate custom template
   */
    static generateCustomTemplate(language: ProgrammingLanguage, options: {
    includeInput?: boolean;
    includeOutput?: boolean;
    includeFileIO?: boolean;
    includeFastIO?: boolean;
    includes?: string[];
  }): CodeTemplate {
        const code = this.generateCodeWithOptions(language, options);

        return {
            language,
            fileName: `main.${this.getFileExtension(language)}`,
            code,
            includes: options.includes || this.extractIncludes(code),
            mainFunction: true,
            description: 'Custom template'
        };
    }

    /**
   * Add custom template
   */
    static addCustomTemplate(template: CodeTemplate): void {
        if (!this.templates.has(template.language)) {
            this.templates.set(template.language, []);
        }
    this.templates.get(template.language)!.push(template);
    }

    /**
   * Remove template
   */
    static removeTemplate(language: ProgrammingLanguage, index: number): boolean {
        if (!this.templates.has(language)) {
            return false;
        }

        const templates = this.templates.get(language)!;
        if (index < 0 || index >= templates.length) {
            return false;
        }

        templates.splice(index, 1);
        return true;
    }

    /**
   * Get file extension for language
   */
    private static getFileExtension(language: ProgrammingLanguage): string {
        const extensions: Record<ProgrammingLanguage, string> = {
            'c': 'c',
            'cpp': 'cpp'
        };

        return extensions[language] || 'txt';
    }

    /**
   * Generate basic template
   */
    private static generateBasicTemplate(language: ProgrammingLanguage): string {
        const templates: Record<ProgrammingLanguage, string> = {
            'c': `#include <stdio.h>
#include <stdlib.h>

int main() {
    // Your code here
    
    return 0;
}`,
            'cpp': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    // Your code here
    
    return 0;
}`
        };

        return templates[language] || '// Your code here';
    }

    /**
   * Select template based on problem characteristics
   */
    private static selectTemplateForProblem(problem: Problem, templates: CodeTemplate[]): CodeTemplate {
    // Simple selection logic - can be enhanced
        return templates[0];
    }

    /**
   * Generate code with options
   */
    private static generateCodeWithOptions(language: ProgrammingLanguage, options: {
    includeInput?: boolean;
    includeOutput?: boolean;
    includeFileIO?: boolean;
    includeFastIO?: boolean;
    includes?: string[];
  }): string {
        let code = this.generateBasicTemplate(language);

        if (options.includeFastIO && language === 'cpp') {
            // Add fast I/O modifications for C++
            code = code.replace(
                'using namespace std;',
                'using namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);'
            );
        }

        return code;
    }

    /**
   * Extract include statements from code
   */
    private static extractIncludes(code: string): string[] {
        const includes: string[] = [];
        const includeRegex = /^#include\s*[<"]([^>"]+)[">]/gm;
        let match;

        while ((match = includeRegex.exec(code)) !== null) {
            includes.push(match[1]);
        }

        return includes;
    }

    /**
   * Generate template from template name and data
   */
    static generate(template: string, data: any): string {
    // Simple template generation - replace placeholders
        let result = template;

        if (data && typeof data === 'object') {
            for (const [key, value] of Object.entries(data)) {
                result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
            }
        }

        return result;
    }
}
