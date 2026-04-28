import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Layout as AntLayout,
  Menu,
  Button,
  Tag,
  Badge,
  Space,
  Dropdown,
  Typography,
  theme,
} from 'antd';
import {
  ThunderboltOutlined,
  MessageOutlined,
  DatabaseOutlined,
  BookOutlined,
  FolderOutlined,
  SettingOutlined,
  CrownOutlined,
  SunOutlined,
  MoonOutlined,
  LogoutOutlined,
  UserOutlined,
  GlobalOutlined,
  ReconciliationOutlined,
  TeamOutlined,
  ApartmentOutlined,
  LinkOutlined,
  AuditOutlined,
  CheckSquareOutlined,
  FormOutlined,
} from '@ant-design/icons';
import { useI18nStore } from '@/i18n';
import { useThemeStore } from '@/theme';
import { useAuthStore } from '@/store/auth';
import { useInboxStore } from '@/store/inbox-store';
import InboxBadge from '@/components/inbox/InboxBadge';
import { useEffect } from 'react';

const { Header, Content } = AntLayout;
const { Text } = Typography;

const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useI18nStore((s) => s.t);
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const themeMode = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const isDeveloper = useAuthStore((s) => s.isDeveloper);
  const logout = useAuthStore((s) => s.logout);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { token: antToken } = theme.useToken();

  const isDark = themeMode === 'dark';
  const selectedKey = location.pathname.split('/')[1] || 'chat';

  // 菜单权限映射：路由key -> 菜单权限名称
  const menuPermissionMap: Record<string, string> = {
    skills: 'menu:skills.read',
    chat: 'menu:chat.read',
    memory: 'menu:memory.read',
    knowledge: 'menu:knowledge.read',
    'knowledge-graph': 'menu:graph.read',
    files: 'menu:files.read',
    config: 'menu:config.read',
    evolution: 'menu:evolution.read',
    federation: 'menu:federation.read',
    connections: 'connection.read',
    approvals: 'workflow:task.read',
    forms: 'form:definition.read',
    admin: 'menu:admin.read',
  };

  // 所有可能的菜单项（包含权限信息）
  const allMenuItems = [
    {
      key: 'skills',
      icon: <ThunderboltOutlined />,
      label: t('nav_skills'),
    },
    {
      key: 'chat',
      icon: <MessageOutlined />,
      label: t('nav_chat'),
    },
    {
      key: 'memory',
      icon: <DatabaseOutlined />,
      label: t('nav_memory'),
    },
    {
      key: 'knowledge',
      icon: <BookOutlined />,
      label: t('nav_knowledge'),
    },
    {
      key: 'knowledge-graph',
      icon: <ApartmentOutlined />,
      label: t('nav_knowledge_graph') || 'Knowledge Graph',
    },
    {
      key: 'files',
      icon: <FolderOutlined />,
      label: t('nav_files'),
    },
    {
      key: 'config',
      icon: <SettingOutlined />,
      label: t('nav_config'),
    },
    {
      key: 'evolution',
      icon: <ReconciliationOutlined />,
      label: t('nav_evolution') || 'Evolution',
    },
    {
      key: 'federation',
      icon: <TeamOutlined />,
      label: t('nav_federation') || 'Federation',
    },
    {
      key: 'connections',
      icon: <LinkOutlined />,
      label: '连接配置',
    },
    {
      key: 'approvals',
      icon: <CheckSquareOutlined />,
      label: '审批中心',
    },
    {
      key: 'forms',
      icon: <FormOutlined />,
      label: '表单中心',
    },

    {
      key: 'admin',
      icon: <CrownOutlined />,
      label: t('nav_admin'),
    },
  ];

  // 根据用户权限过滤菜单项
  const menuItems = allMenuItems.filter(item => {
    // 获取菜单项对应的权限
    const requiredPermission = menuPermissionMap[item.key];
    if (!requiredPermission) {
      console.warn(`Menu item ${item.key} has no corresponding permission defined`);
      return true; // 默认显示没有定义权限的菜单项
    }

    // 检查用户是否有该菜单权限
    return hasPermission(requiredPermission);
  });

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(`/${key}`);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleLocale = () => {
    setLang(lang === 'zh' ? 'en' : 'zh');
  };

  // 连接 Inbox SSE（应用启动时）
  useEffect(() => {
    if (user) {
      useInboxStore.getState().connectSSE();
    }
    return () => {
      useInboxStore.getState().disconnectSSE();
    };
  }, [user]);

  const userMenuItems = [
    {
      key: 'role',
      label: (
        <Text type="secondary">
          {user?.roles?.map((r) => r.name).join(', ') || '-'}
        </Text>
      ),
      disabled: true,
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('logout'),
      danger: true,
    },
  ];

  const handleUserMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      handleLogout();
    }
  };

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 24px',
          gap: 16,
          background: antToken.colorBgContainer,
          borderBottom: `1px solid ${antToken.colorBorderSecondary}`,
          height: 'auto',
          lineHeight: '2.5',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginRight: 16,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onClick={() => navigate('/chat')}
        >
          <Text
            strong
            style={{ fontSize: 20, margin: 0, whiteSpace: 'nowrap' }}
          >
            RAOS
          </Text>
          <Tag color="blue">v2.0</Tag>
        </div>

        <Menu
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            background: 'transparent',
          }}
        />

        <Space size={8} style={{ flexShrink: 0 }}>
          <InboxBadge />
          <Button
            type="text"
            icon={isDark ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
          />
          <Button
            type="text"
            icon={<GlobalOutlined />}
            onClick={toggleLocale}
          >
            {lang === 'zh' ? 'EN' : 'ZH'}
          </Button>
          <Dropdown
            menu={{
              items: userMenuItems,
              onClick: handleUserMenuClick,
            }}
            placement="bottomRight"
          >
            <Button type="text" icon={<UserOutlined />}>
              {user?.displayName || user?.username}
            </Button>
          </Dropdown>
        </Space>
      </Header>

      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </AntLayout>
  );
};

export default Layout;
