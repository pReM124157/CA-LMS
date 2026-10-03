import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default [js.configs.recommended, ...tseslint.configs.recommended, { files: ['fake-lms/public/*.js'], languageOptions: { globals: { window: 'readonly', document: 'readonly' } } }, { ignores: ['dist/**', 'node_modules/**'] }];
