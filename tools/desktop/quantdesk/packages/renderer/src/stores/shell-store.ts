import { create } from 'zustand';

interface ShellState {
  isPrimaryRailCollapsed: boolean;
  isSidebarCollapsed: boolean;
  commandDeckOpen: boolean;
  setPrimaryRailCollapsed: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setCommandDeckOpen: (value: boolean) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  isPrimaryRailCollapsed: false,
  isSidebarCollapsed: true,
  commandDeckOpen: false,
  setPrimaryRailCollapsed: (value) => set({ isPrimaryRailCollapsed: value }),
  setSidebarCollapsed: (value) => set({ isSidebarCollapsed: value }),
  setCommandDeckOpen: (value) => set({ commandDeckOpen: value }),
}));
