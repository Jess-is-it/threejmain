export interface ChildItem {
  id?: number | string;
  name: string;
  icon?: string;
  children?: ChildItem[];
  item?: unknown;
  url?: string;
  color?: string;
  disabled?: boolean;
  subtitle?: string;
  badge?: boolean;
  badgeType?: string;
  badgeContent?: string;
}

export interface MenuItem {
  heading?: string;
  name?: string;
  icon?: string;
  id?: number;
  to?: string;
  items?: MenuItem[];
  children?: ChildItem[];
  url?: string;
  disabled?: boolean;
  subtitle?: string;
  badgeType?: string;
  badge?: boolean;
  badgeContent?: string;
}

const SidebarContent: MenuItem[] = [
  {
    heading: 'Customer Profiling',
    children: [
      { name: 'Overview', icon: 'solar:home-2-linear', id: 'overview', url: '/' },
      {
        name: 'Customers',
        icon: 'solar:users-group-rounded-linear',
        id: 'customers',
        url: '/customers',
      },
      { name: 'Audit Logs', icon: 'solar:list-check-linear', id: 'audit', url: '/audit-logs' },
    ],
  },
  {
    heading: 'Module Info',
    children: [
      { name: 'API Page', icon: 'solar:code-square-linear', id: 'api', url: '/api-page' },
      { name: 'AI Prompt', icon: 'solar:stars-line-duotone', id: 'ai', url: '/ai-prompt' },
      { name: 'Updates', icon: 'solar:refresh-linear', id: 'updates', url: '/updates' },
    ],
  },
];

export default SidebarContent;
