import { Problem, TestCase, CodeTemplate } from '../types/models';

/**
 * Validation utilities for problems and test cases
 */
export class Validator {
    /**
   * Validate problem data
   */
    static validateProblem(problem: Partial<Problem>): ValidationResult {
        const errors: string[] = [];

        if (!problem.name || problem.name.trim().length === 0) {
            errors.push('Problem name is required');
        }

        if (!problem.description || problem.description.trim().length === 0) {
            errors.push('Problem description is required');
        }

        if (!problem.difficulty || !['easy', 'medium', 'hard'].includes(problem.difficulty)) {
            errors.push('Problem difficulty must be easy, medium, or hard');
        }

        if (!problem.languages || problem.languages.length === 0) {
            errors.push('At least one programming language must be specified');
        }

        if (problem.testCases) {
            problem.testCases.forEach((testCase, index) => {
                const testCaseErrors = this.validateTestCase(testCase);
                testCaseErrors.forEach(error => errors.push(`Test case ${index + 1}: ${error}`));
            });
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
   * Validate test case data
   */
    static validateTestCase(testCase: Partial<TestCase>): string[] {
        const errors: string[] = [];

        if (!testCase.input) {
            errors.push('Test case input is required');
        }

        if (!testCase.expectedOutput) {
            errors.push('Test case expected output is required');
        }

        if (!testCase.description || testCase.description.trim().length === 0) {
            errors.push('Test case description is required');
        }

        if (testCase.timeout && (testCase.timeout < 100 || testCase.timeout > 60000)) {
            errors.push('Test case timeout must be between 100ms and 60000ms');
        }

        if (testCase.memoryLimit && (testCase.memoryLimit < 1 || testCase.memoryLimit > 1024)) {
            errors.push('Test case memory limit must be between 1MB and 1024MB');
        }

        return errors;
    }

    /**
   * Validate code template
   */
    static validateCodeTemplate(template: Partial<CodeTemplate>): string[] {
        const errors: string[] = [];

        if (!template.language) {
            errors.push('Template language is required');
        }

        if (!template.code || template.code.trim().length === 0) {
            errors.push('Template code is required');
        }

        if (!template.fileName || template.fileName.trim().length === 0) {
            errors.push('Template file name is required');
        }

        return errors;
    }

    /**
   * Validate directory name
   */
    static validateDirectoryName(name: string): string[] {
        const errors: string[] = [];

        if (!name || name.trim().length === 0) {
            errors.push('Directory name is required');
        }

        if (name.length > 100) {
            errors.push('Directory name must be less than 100 characters');
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            errors.push('Directory name can only contain letters, numbers, hyphens, and underscores');
        }

        if (/^[0-9_-]/.test(name)) {
            errors.push('Directory name cannot start with a number, hyphen, or underscore');
        }

        return errors;
    }

    /**
   * Validate file name
   */
    static validateFileName(name: string): string[] {
        const errors: string[] = [];

        if (!name || name.trim().length === 0) {
            errors.push('File name is required');
        }

        if (name.length > 255) {
            errors.push('File name must be less than 255 characters');
        }

        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
            errors.push('File name can only contain letters, numbers, dots, hyphens, and underscores');
        }

        if (name.startsWith('.') || name.endsWith('.')) {
            errors.push('File name cannot start or end with a dot');
        }

        return errors;
    }

    /**
   * Validate create problem payload
   */
    static validateCreateProblemPayload(payload: any): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!payload) {
            errors.push('Payload is required');
            return { isValid: false, errors, warnings };
        }

        if (!payload.name || typeof payload.name !== 'string' || payload.name.trim().length === 0) {
            errors.push('Problem name is required and must be a non-empty string');
        }

        if (payload.description && typeof payload.description !== 'string') {
            errors.push('Description must be a string');
        }

        if (payload.languages && !Array.isArray(payload.languages)) {
            errors.push('Languages must be an array');
        }

        if (payload.difficulty && !['easy', 'medium', 'hard'].includes(payload.difficulty)) {
            errors.push('Difficulty must be one of: easy, medium, hard');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}
