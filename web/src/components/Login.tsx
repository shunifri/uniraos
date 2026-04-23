import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form,
  Input,
  Button,
  Card,
  Typography,
  Tag,
  Alert,
  Space,
  Divider,
} from 'antd';
import { UserOutlined, LockOutlined, PhoneOutlined } from '@ant-design/icons';
import { useI18nStore } from '@/i18n';
import { useAuthStore } from '@/store/auth';

const { Title, Text } = Typography;

interface LoginForm {
  username: string;
  password: string;
}

interface LoginProps {
  onSuccess?: () => void;
}

const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const navigate = useNavigate();
  const t = useI18nStore((s) => s.t);
  const login = useAuthStore((s) => s.login);
  const loginAnonymous = useAuthStore((s) => s.loginAnonymous);

  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [phone, setPhone] = useState('');

  // 检查 localStorage 中是否已有手机号，自动登录
  useEffect(() => {
    const savedPhone = localStorage.getItem('raos-anon-phone');
    if (savedPhone) {
      setPhone(savedPhone);
    }
  }, []);

  const handleSubmit = async (values: LoginForm) => {
    setLoading(true);
    setError(null);

    try {
      await login(values.username, values.password);
      if (onSuccess) onSuccess();
      else navigate('/chat');
    } catch (err: any) {
      setError(err?.message || t('login_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    // 验证手机号格式
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError(t('login_phone_invalid'));
      return;
    }

    setGuestLoading(true);
    setError(null);

    try {
      await loginAnonymous(phone);
      if (onSuccess) onSuccess();
      else navigate('/chat');
    } catch (err: any) {
      setError(err?.message || t('login_failed'));
    } finally {
      setGuestLoading(false);
    }
  };

  const handleGuestClick = () => {
    // 如果 localStorage 中已有手机号，直接登录
    const savedPhone = localStorage.getItem('raos-anon-phone');
    if (savedPhone && /^1[3-9]\d{9}$/.test(savedPhone)) {
      setPhone(savedPhone);
      setGuestLoading(true);
      setError(null);
      loginAnonymous(savedPhone)
        .then(() => {
          if (onSuccess) onSuccess();
          else navigate('/chat');
        })
        .catch((err: any) => {
          setError(err?.message || t('login_failed'));
          // 登录失败时清除缓存的手机号，显示表单让用户重新输入
          localStorage.removeItem('raos-anon-phone');
          setShowGuestForm(true);
        })
        .finally(() => setGuestLoading(false));
      return;
    }
    setShowGuestForm(true);
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        padding: 24,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Space align="center" size={8}>
            <Title level={2} style={{ margin: 0 }}>
              RAOS
            </Title>
            <Tag color="blue">v2.0</Tag>
          </Space>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 24 }}
          />
        )}

        <Form<LoginForm>
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: t('login_username_required') }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder={t('login_username')}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: t('login_password_required') }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('login_password')}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
            >
              {loading ? t('login_logging_in') : t('login_submit')}
            </Button>
          </Form.Item>
        </Form>

        <Divider plain style={{ margin: '12px 0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('login_phone_hint')}
          </Text>
        </Divider>

        {showGuestForm ? (
          <Space.Compact style={{ width: '100%' }}>
            <Input
              prefix={<PhoneOutlined />}
              placeholder={t('login_phone')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onPressEnter={handleGuestLogin}
              maxLength={11}
              style={{ flex: 1 }}
              size="large"
            />
            <Button
              type="default"
              loading={guestLoading}
              onClick={handleGuestLogin}
              size="large"
            >
              {guestLoading ? t('login_guest_loading') : t('login_guest')}
            </Button>
          </Space.Compact>
        ) : (
          <Button
            block
            loading={guestLoading}
            onClick={handleGuestClick}
            size="large"
          >
            {guestLoading ? t('login_guest_loading') : t('login_guest')}
          </Button>
        )}
      </Card>
    </div>
  );
};

export default Login;
