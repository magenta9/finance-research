import type { PolicyPathEntry } from './path-policy';

export const rawInteractiveElementAllowlist: PolicyPathEntry[] = [
    {
        path: 'packages/renderer/src/components/button.tsx',
        reason: 'The base Button primitive owns native button rendering.',
    },
    {
        path: 'packages/renderer/src/components/input.tsx',
        reason: 'The base Input primitive owns native input rendering.',
    },
    {
        path: 'packages/renderer/src/components/select.tsx',
        reason: 'The base Select primitive owns native select rendering.',
    },
    {
        path: 'packages/renderer/src/components/textarea.tsx',
        reason: 'The base Textarea primitive owns native textarea rendering.',
    },
    {
        path: 'packages/renderer/src/components/checkbox.tsx',
        reason: 'The base Checkbox primitive owns native checkbox rendering.',
    },
];