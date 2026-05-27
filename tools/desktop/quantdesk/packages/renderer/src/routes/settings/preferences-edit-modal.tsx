import type { Dispatch, SetStateAction } from 'react';

import { Button } from '../../components/button';
import { Checkbox } from '../../components/checkbox';
import { Input } from '../../components/input';
import { Modal } from '../../components/modal';
import { Select } from '../../components/select';
import type { PreferencesDraft } from './settings-types';

export const PreferencesEditModal = ({
    isSavingPreferences,
    onClose,
    onSave,
    open,
    preferencesDraft,
    setPreferencesDraft,
}: {
    isSavingPreferences: boolean;
    onClose: () => void;
    onSave: () => Promise<boolean>;
    open: boolean;
    preferencesDraft: PreferencesDraft;
    setPreferencesDraft: Dispatch<SetStateAction<PreferencesDraft>>;
}) => (
    <Modal
        actions={(
            <>
                <Button onClick={onClose} tone="ghost">取消</Button>
                <Button
                    data-testid="settings-save-preferences"
                    onClick={() => {
                        void onSave().then((saved) => {
                            if (saved) {
                                onClose();
                            }
                        });
                    }}
                    tone="primary"
                >
                    {isSavingPreferences ? '保存中...' : '保存设置'}
                </Button>
            </>
        )}
        description="在一个聚焦弹窗里调整默认市场、基准货币和数据源开关。"
        eyebrow="偏好设置"
        onClose={onClose}
        open={open}
        title="编辑偏好"
    >
        <div className="space-y-5" data-testid="settings-preferences-modal">
            <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-[var(--color-copy)]">
                    <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">基准货币</span>
                    <Select
                        className="h-11 w-full rounded-[18px] border border-[color:var(--color-border)] bg-white/88 px-4"
                        data-testid="settings-base-currency-select"
                        onChange={(event) => {
                            const value = event.currentTarget.value as PreferencesDraft['baseCurrency'];
                            setPreferencesDraft((current) => ({ ...current, baseCurrency: value }));
                        }}
                        value={preferencesDraft.baseCurrency}
                    >
                        <option value="CNY">CNY</option>
                        <option value="USD">USD</option>
                        <option value="HKD">HKD</option>
                    </Select>
                </label>
                <label className="space-y-2 text-sm text-[var(--color-copy)]">
                    <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">默认市场</span>
                    <Select
                        className="h-11 w-full rounded-[18px] border border-[color:var(--color-border)] bg-white/88 px-4"
                        onChange={(event) => {
                            const value = event.currentTarget.value as PreferencesDraft['defaultMarket'];
                            setPreferencesDraft((current) => ({ ...current, defaultMarket: value }));
                        }}
                        value={preferencesDraft.defaultMarket}
                    >
                        <option value="US">US</option>
                        <option value="A">A</option>
                        <option value="HK">HK</option>
                        <option value="BOND">BOND</option>
                        <option value="COMMODITY">COMMODITY</option>
                    </Select>
                </label>
                <label className="space-y-2 text-sm text-[var(--color-copy)]">
                    <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">默认单标的上限</span>
                    <Input
                        className="h-11 w-full rounded-[18px] border border-[color:var(--color-border)] bg-white/88 px-4"
                        onChange={(event) => { setPreferencesDraft((current) => ({ ...current, defaultMaxSingleWeight: event.currentTarget.value })); }}
                        type="number"
                        value={preferencesDraft.defaultMaxSingleWeight}
                    />
                </label>
                <label className="space-y-2 text-sm text-[var(--color-copy)]">
                    <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">语言</span>
                    <Select
                        className="h-11 w-full rounded-[18px] border border-[color:var(--color-border)] bg-white/88 px-4"
                        onChange={(event) => {
                            const value = event.currentTarget.value as PreferencesDraft['language'];
                            setPreferencesDraft((current) => ({ ...current, language: value }));
                        }}
                        value={preferencesDraft.language}
                    >
                        <option value="zh-CN">简体中文</option>
                        <option value="en-US">English</option>
                    </Select>
                </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4">
                    <Checkbox checked={preferencesDraft.akshareEnabled} onChange={(event) => { setPreferencesDraft((current) => ({ ...current, akshareEnabled: event.currentTarget.checked })); }}>
                        启用 AKShare
                    </Checkbox>
                </div>
                <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4">
                    <Checkbox checked={preferencesDraft.frankfurterEnabled} onChange={(event) => { setPreferencesDraft((current) => ({ ...current, frankfurterEnabled: event.currentTarget.checked })); }}>
                        启用 Frankfurter FX
                    </Checkbox>
                </div>
                <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4">
                    <Checkbox checked={preferencesDraft.tushareEnabled} onChange={(event) => { setPreferencesDraft((current) => ({ ...current, tushareEnabled: event.currentTarget.checked })); }}>
                        启用 TuShare
                    </Checkbox>
                </div>
                <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4">
                    <Checkbox checked={preferencesDraft.yfinanceEnabled} onChange={(event) => { setPreferencesDraft((current) => ({ ...current, yfinanceEnabled: event.currentTarget.checked })); }}>
                        启用 Yahoo Finance
                    </Checkbox>
                </div>
            </div>
        </div>
    </Modal>
);