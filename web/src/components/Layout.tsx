import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Layout as AntLayout,
  Menu,
  Button,
  Tag,
  Space,
  Dropdown,
  Typography,
  Drawer,
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
  RobotOutlined,
  MenuOutlined,
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
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const logout = useAuthStore((s) => s.logout);

  const isDark = themeMode === 'dark';
  const selectedKey = location.pathname.split('/')[1] || 'chat';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const allMenuItems = [
    { key: 'skills', icon: <ThunderboltOutlined />, label: t('nav_skills'), perm: 'menu:skills.read' },
    { key: 'chat', icon: <MessageOutlined />, label: t('nav_chat'), perm: 'menu:chat.read' },
    { key: 'memory', icon: <DatabaseOutlined />, label: t('nav_memory'), perm: 'menu:memory.read' },
    { key: 'knowledge', icon: <BookOutlined />, label: t('nav_knowledge'), perm: 'menu:knowledge.read' },
    { key: 'files', icon: <FolderOutlined />, label: t('nav_files'), perm: 'menu:files.read' },
    { key: 'config', icon: <SettingOutlined />, label: t('nav_config'), perm: 'menu:config.read' },
    { key: 'evolution', icon: <RocketOutlined />, label: 'Evolution', perm: 'menu:evolution.read' },
    { key: 'genealogy', icon: <ApartmentOutlined />, label: 'Genealogy', perm: 'menu:genealogy.read' },
    { key: 'federation', icon: <GlobalOutlined />, label: 'Federation', perm: 'menu:federation.read' },
    { key: 'graph', icon: <NodeIndexOutlined />, label: 'Knowledge Graph', perm: 'menu:graph.read' },
    { key: 'admin', icon: <CrownOutlined />, label: t('nav_admin'), perm: 'menu:admin.read' },
  ];

  const menuItems = allMenuItems.filter((item) => hasPermission(item.perm));

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(`/${key}`);
    setMobileMenuOpen(false);
  };

  const handleLogout = () => {
    // 退出时清除匿名手机号缓存
    localStorage.removeItem('raos-anon-phone');
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
    <AntLayout className="bg-blobs" style={{ minHeight: '100vh', background: 'var(--color-raos-bg-main)', overflow: 'hidden' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: "0 28px",
          gap: 16,
          background: "rgba(255, 255, 255, 0.72)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderBottom: "1px solid rgba(139, 92, 246, 0.08)",
          boxShadow: "0 1px 12px rgba(139, 92, 246, 0.06)",
          zIndex: 100,
        }}
      >
        {/* Mobile hamburger menu button */}
        <Button
          className="mobile-menu-btn"
          type="text"
          icon={<MenuOutlined />}
          onClick={() => setMobileMenuOpen(true)}
        />

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
          <div style={{
            width: 36, height: 36, borderRadius: 12,
            background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)',
            flexShrink: 0,
          }}>
            <RobotOutlined style={{ color: 'white', fontSize: 18 }} />
          </div>
          <Text
            className="header-logo-text"
            strong
            style={{ fontSize: 22, margin: 0, whiteSpace: 'nowrap', letterSpacing: '-0.5px' }}
          >
            <span className="text-gradient" style={{ fontWeight: 800 }}>RAOS</span>
          </Text>
          <Tag className="header-version-tag" style={{
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(236, 72, 153, 0.08))',
            border: '1px solid rgba(139, 92, 246, 0.15)',
            color: '#7C3AED',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 11,
          }}>v2.0</Tag>
        </div>

        {/* Desktop horizontal menu */}
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

        <Space className="header-actions" size={8} style={{ flexShrink: 0 }}>
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

      {/* Mobile navigation drawer */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RobotOutlined style={{ color: '#8B5CF6' }} />
            <span className="text-gradient" style={{ fontWeight: 800 }}>RAOS</span>
          </div>
        }
        placement="left"
        onClose={() => setMobileMenuOpen(false)}
        open={mobileMenuOpen}
        width={280}
        styles={{ body: { padding: 0 } }}
      >
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ border: 'none' }}
        />
      </Drawer>

      <Content
        style={{
          padding: 24,
          height: "calc(100vh - 64px)",
          overflowY: "auto",
          overflowX: "hidden",
          background: "#f8f9fd",
        }}
      >
        <Outlet />
      </Content>
    </AntLayout>
  );
};

export default Layout;
