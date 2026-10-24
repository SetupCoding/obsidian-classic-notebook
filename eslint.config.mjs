import js from '@eslint/js';
import obsidianmd from 'eslint-plugin-obsidianmd';

// Lint the shipped bundle so include modules share the same lexical scope.
// This deliberately does not claim the full type-checked Obsidian review preset.
export default [{
  files: ['main.js'],
  languageOptions: {
    ecmaVersion: 'latest', sourceType: 'commonjs',
    globals: Object.fromEntries(['window', 'document', 'console', 'crypto', 'navigator', 'Node', 'NodeFilter', 'HTMLElement', 'Element', 'Event', 'MouseEvent', 'PointerEvent', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'CSS', 'getComputedStyle', 'performance'].map(name => [name, 'readonly']))
  },
  plugins: { obsidianmd },
  rules: {
    ...js.configs.recommended.rules,
    'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    'obsidianmd/commands/no-default-hotkeys': 'error',
    'obsidianmd/commands/no-plugin-id-in-command-id': 'error',
    'obsidianmd/no-forbidden-elements': 'error',
    'obsidianmd/hardcoded-config-path': 'error',
    'obsidianmd/validate-manifest': 'error',
    'obsidianmd/validate-license': 'error'
  }
}];
