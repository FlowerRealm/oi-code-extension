/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

// Re-export the core extension functionality
export { activate, deactivate } from './core/extension';

// Re-export compiler utility for backward compatibility
export { getSuitableCompiler } from './utils/compiler-utils';
