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
  Modal,
  Form,
  Input,
  message,
} from 'antd';
import {
  ThunderboltOutlined,
  MessageOutlined,
  DatabaseOutlined,
  BookOutlined,
  FolderOutlined,
  SettingOutlined,
  SunOutlined,
  MoonOutlined,
  LogoutOutlined,
  UserOutlined,
  GlobalOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  LockOutlined,
} from '@ant-design/icons';
import { useI18nStore } from '@/i18n';
import { useThemeStore } from '@/theme';
import { useAuthStore } from '@/store/auth';
import { useInboxStore } from '@/store/inbox-store';
import InboxBadge from '@/components/inbox/InboxBadge';
import { useEffect } from 'react';
import { api } from '@/api';

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
  const logout = useAuthStore((s) => s.logout);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { token: antToken } = theme.useToken();
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdForm] = Form.useForm();
  const [pwdLoading, setPwdLoading] = useState(false);

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
    apps: 'menu:apps.read',
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
      key: 'apps',
      icon: <AppstoreOutlined />,
      label: '应用中心',
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
      key: 'change_password',
      icon: <LockOutlined />,
      label: t('change_password'),
    },
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
    } else if (key === 'change_password') {
      setShowPwdModal(true);
      pwdForm.resetFields();
    }
  };

  const handleChangePassword = async (values: any) => {
    try {
      setPwdLoading(true);
      await api.post('/api/user/password', {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      setShowPwdModal(false);
      pwdForm.resetFields();
      message.success('密码修改成功，请重新登录');
      logout();
      navigate('/login');
    } catch (e: any) {
      message.error(e?.error || '修改密码失败');
    } finally {
      setPwdLoading(false);
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

      <Modal
        title={t('change_password')}
        open={showPwdModal}
        onCancel={() => { setShowPwdModal(false); pwdForm.resetFields(); }}
        onOk={() => pwdForm.submit()}
        confirmLoading={pwdLoading}
      >
        <Form form={pwdForm} layout="vertical" onFinish={handleChangePassword}>
          <Form.Item name="oldPassword" label={t('old_password')} rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="newPassword" label={t('new_password')} rules={[{ required: true, min: 6, max: 100 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t('confirm_password')}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('password_mismatch')));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </AntLayout>
  );
};

export default Layout;
