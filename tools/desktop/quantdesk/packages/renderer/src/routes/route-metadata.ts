export interface RouteDefinition {
  path: string;
  label: string;
  shortLabel: string;
  icon: 'dashboard' | 'assets' | 'allocation' | 'agent' | 'settings';
  sidebarTitle: string;
}

export const routeDefinitions: RouteDefinition[] = [
  {
    label: '仪表盘',
    path: '/',
    shortLabel: '01',
    icon: 'dashboard',
    sidebarTitle: '宏观驾驶舱',
  },
  {
    label: '资产池',
    path: '/assets',
    shortLabel: '02',
    icon: 'assets',
    sidebarTitle: '资产宇宙',
  },
  {
    label: '配置方案',
    path: '/allocation',
    shortLabel: '03',
    icon: 'allocation',
    sidebarTitle: '配置工坊',
  },
  {
    label: 'Pi Agent',
    path: '/pi-agent',
    shortLabel: '04',
    icon: 'agent',
    sidebarTitle: 'Pi 本地终端',
  },
  {
    label: '设置',
    path: '/settings',
    shortLabel: '05',
    icon: 'settings',
    sidebarTitle: '配置中心',
  },
];
