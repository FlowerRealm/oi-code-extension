import * as os from 'os';
import * as path from 'path';

/**
 * Shared constants for the OI-Code extension
 */
export const OI_CODE_TEST_DIR = '.oi-code-tests';
export const OI_CODE_TEST_BASE_PATH = path.join(os.homedir(), OI_CODE_TEST_DIR);
export const OI_CODE_TEST_TMP_PATH = path.join(OI_CODE_TEST_BASE_PATH, 'tmp');
