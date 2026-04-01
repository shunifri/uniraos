import { useState } from 'react';
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
} from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useI18nStore } from '@/i18n';
import { useAuthStore } from '@/store/auth';

const { Title } = Typography;

interface LoginForm {
  username: string;
  password: string;
}

const Login: React.FC = () => {
  const navigate = useNavigate();
  const t = useI18nStore((s) => s.t);
  const login = useAuthStore((s) => s.login);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: LoginForm) => {
    setLoading(true);
    setError(null);

    try {
      await login(values.username, values.password);
      navigate('/chat');
    } catch (err: any) {
      setError(err?.message || t('login_failed'));
    } finally {
      setLoading(false);
    }
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

          <Form.Item style={{ marginBottom: 0 }}>
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
      </Card>
    </div>
  );
};

export default Login;
