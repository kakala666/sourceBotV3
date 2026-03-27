import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, message, Typography, Spin, Result } from 'antd';
import { UserOutlined, LockOutlined, SafetyOutlined, LoadingOutlined } from '@ant-design/icons';
import type { LoginInput, ApiResponse } from 'shared';
import { useAuthStore } from '@/stores/auth';
import api from '@/services/api';

const { Title, Text, Paragraph } = Typography;

type LoginStep = 'credentials' | 'central-auth' | 'verify-code';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [, setPendingToken] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState<string | null>(null);
  const [centralAuthError, setCentralAuthError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // 第一步：用户名密码登录
  const onFinish = async (values: LoginInput) => {
    setLoading(true);
    setCentralAuthError(null);
    try {
      const { data } = await api.post<ApiResponse<any>>('/auth/login', values);
      const result = data.data!;

      // 直接登录成功
      if (result.token) {
        setAuth(result.token, result.admin);
        message.success('登录成功');
        navigate('/bots');
        return;
      }

      setPendingToken(result.pendingToken);

      // 需要中央身份验证
      if (result.needCentralAuth) {
        setStep('central-auth');
        doCentralAuth(result.pendingToken);
        return;
      }

      // 仅需要验证码
      if (result.needVerifyCode && result.verifyCode) {
        setVerifyCode(result.verifyCode);
        setStep('verify-code');
        startPolling(result.pendingToken, result.verifyCode);
        return;
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || '登录失败，请检查用户名和密码';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // 第二步：中央身份验证
  const doCentralAuth = async (token: string) => {
    try {
      const { data } = await api.post<ApiResponse<any>>('/auth/central-auth', { pendingToken: token });
      const result = data.data!;

      // 中央验证通过，还需要验证码
      if (result.needVerifyCode && result.verifyCode) {
        setVerifyCode(result.verifyCode);
        setStep('verify-code');
        startPolling(result.pendingToken || token, result.verifyCode);
        return;
      }

      // 全部通过
      if (result.token) {
        setAuth(result.token, result.admin);
        message.success('登录成功');
        navigate('/bots');
        return;
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || '中央身份验证失败';
      setCentralAuthError(msg);
      setStep('central-auth');
    }
  };

  // 第三步：轮询验证码状态
  const startPolling = (token: string, code: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const { data } = await api.post<ApiResponse<any>>('/auth/verify-code', {
          pendingToken: token,
          code,
        });
        const result = data.data!;

        // 验证成功
        if (result.token) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setAuth(result.token, result.admin);
          message.success('验证成功，登录完成');
          navigate('/bots');
        }
      } catch (err: any) {
        // 验证码过期或不存在
        if (err.response?.status === 410) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          message.error('验证码已过期，请重新登录');
          resetToCredentials();
        }
      }
    }, 3000);
  };

  const resetToCredentials = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
    setStep('credentials');
    setPendingToken(null);
    setVerifyCode(null);
    setCentralAuthError(null);
  };

  // 渲染用户名密码表单
  const renderCredentials = () => (
    <Form<LoginInput> onFinish={onFinish} autoComplete="off" size="large">
      <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
        <Input prefix={<UserOutlined />} placeholder="用户名" />
      </Form.Item>
      <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
        <Input.Password prefix={<LockOutlined />} placeholder="密码" />
      </Form.Item>
      <Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} block>
          登录
        </Button>
      </Form.Item>
    </Form>
  );

  // 渲染中央身份验证状态
  const renderCentralAuth = () => (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      {centralAuthError ? (
        <Result
          status="error"
          title="中央身份验证失败"
          subTitle={centralAuthError}
          extra={
            <Button type="primary" onClick={resetToCredentials}>
              返回重新登录
            </Button>
          }
        />
      ) : (
        <>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} />
          <Paragraph style={{ marginTop: 24, fontSize: 16 }}>
            正在进行中央身份验证...
          </Paragraph>
        </>
      )}
    </div>
  );

  // 渲染验证码认证
  const renderVerifyCode = () => (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <SafetyOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 16 }} />
      <Title level={4}>验证码认证</Title>
      <div style={{
        background: '#f6f6f6',
        borderRadius: 8,
        padding: '16px 32px',
        margin: '16px 0',
        display: 'inline-block',
      }}>
        <Text style={{ fontSize: 32, fontWeight: 700, letterSpacing: 8, fontFamily: 'monospace' }}>
          {verifyCode}
        </Text>
      </div>
      <Paragraph>
        请前往 Telegram 向 <Text strong>@ShenFenJiaoYanbot</Text> 发送上方验证码
      </Paragraph>
      <Paragraph type="secondary">
        验证码有效期 5 分钟，验证成功后将自动登录
      </Paragraph>
      <Spin indicator={<LoadingOutlined spin />} />
      <Paragraph type="secondary" style={{ marginTop: 8 }}>
        等待验证中...
      </Paragraph>
      <Button type="link" onClick={resetToCredentials} style={{ marginTop: 8 }}>
        返回重新登录
      </Button>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f0f2f5',
    }}>
      <Card style={{ width: 440, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 32 }}>
          Telegram Bot 管理后台
        </Title>
        {step === 'credentials' && renderCredentials()}
        {step === 'central-auth' && renderCentralAuth()}
        {step === 'verify-code' && renderVerifyCode()}
      </Card>
    </div>
  );
}
