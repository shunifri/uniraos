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
  RocketOutlined,
  ApartmentOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import { useI18nStore } from '@/i18n';
import { useThemeStore } from '@/theme';
import { useAuthStore } from '@/store/auth';

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
  const { token: antToken } = theme.useToken();

  const isDark = themeMode === 'dark';
  const selectedKey = location.pathname.split('/')[1] || 'chat';

  const menuItems = [
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
    ...(isAdmin || isDeveloper
      ? [
          {
            key: 'memory',
            icon: <DatabaseOutlined />,
            label: t('nav_memory'),
          },
        ]
      : []),
    {
      key: 'knowledge',
      icon: <BookOutlined />,
      label: t('nav_knowledge'),
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
    ...(isAdmin || isDeveloper
      ? [
          {
            key: 'evolution',
            icon: <RocketOutlined />,
            label: 'Evolution',
          },
          {
            key: 'genealogy',
            icon: <ApartmentOutlined />,
            label: 'Genealogy',
          },
          {
            key: 'federation',
            icon: <GlobalOutlined />,
            label: 'Federation',
          },
          {
            key: 'graph',
            icon: <NodeIndexOutlined />,
            label: 'Knowledge Graph',
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            key: 'admin',
            icon: <CrownOutlined />,
            label: t('nav_admin'),
          },
        ]
      : []),
  ];

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
          padding: "0 24px",
          gap: 16,
          background: "rgba(255, 255, 255, 0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.3)",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.06)",
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
            <span className="text-gradient" style={{ fontWeight: 700 }}>RAOS</span>
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

      <Content
        style={{
          padding: 24,
          height: "calc(100vh - 64px)",
          overflow: "auto",
          background: "#f8f9fd",
        }}
      >
        <Outlet />
      </Content>
    </AntLayout>
  );
};

export default Layout;
