// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { SearchInput } from './search-input';

describe('SearchInput', () => {
    test('fills the available width and keeps the clear action from shrinking', () => {
        render(
            <SearchInput
                onChange={vi.fn()}
                placeholder="按代码、名称或标签筛选"
                value="SPY"
            />,
        );

        const searchbox = screen.getByRole('searchbox');
        expect(searchbox.parentElement).toHaveClass('w-full');
        expect(searchbox.parentElement).toHaveClass('min-w-0');

        const clearButton = screen.getByRole('button', { name: '清空搜索' });
        expect(clearButton).toHaveClass('h-9');
        expect(clearButton).toHaveClass('shrink-0');
        expect(clearButton).toHaveClass('whitespace-nowrap');
    });
});
