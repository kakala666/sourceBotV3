import { useEffect, useState } from 'react';
import {
  Form, Input, InputNumber, Button, Space, message, Typography, Card, Divider, Switch,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined, SaveOutlined } from '@ant-design/icons';
import type { SystemSettings, ApiResponse } from 'shared';
import api from '@/services/api';

const { Title } = Typography;
const { TextArea } = Input;

export default function Settings() {
  const [form] = Form.useForm<SystemSettings>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const { data } = await api.get<ApiResponse<SystemSettings>>('/settings');
        if (data.data) form.setFieldsValue(data.data);
      } catch {
        message.error('获取设置失败');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.put('/settings', values);
      message.success('保存成功');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>系统设置</Title>
      <Card loading={loading} style={{ maxWidth: 720 }}>
        <Form form={form} layout="vertical">
          <Form.Item
            label="预览结束文字"
            name={['endContent', 'text']}
            rules={[{ required: true, message: '请输入预览结束文字' }]}
          >
            <TextArea rows={4} placeholder="预览结束后显示的文字内容" />
          </Form.Item>

          <Form.Item label="预览结束按钮">
            <Form.List name={['endContent', 'buttons']}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'text']}
                        rules={[{ required: true, message: '请输入按钮文字' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="按钮文字" style={{ width: 180 }} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'url']}
                        rules={[{ required: true, message: '请输入链接' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="链接 URL" style={{ width: 300 }} />
                      </Form.Item>
                      <MinusCircleOutlined
                        style={{ color: '#ff4d4f', cursor: 'pointer' }}
                        onClick={() => remove(name)}
                      />
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                    添加按钮
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>

          <Form.Item
            label="广告展示时间（秒）"
            name="adDisplaySeconds"
            rules={[{ required: true, message: '请输入广告展示时间' }]}
          >
            <InputNumber min={1} max={60} style={{ width: 200 }} />
          </Form.Item>

          <Form.Item
            label="统计群组 ID"
            name="statsGroupId"
          >
            <Input placeholder="Telegram 群组 ID（可选）" style={{ width: 300 }} />
          </Form.Item>

          <Divider>登录验证设置</Divider>

          <Form.Item
            label="启用中央身份验证"
            name="centralAuthEnabled"
            valuePropName="checked"
            extra="启用后，登录时需要通过中央身份验证服务验证 Telegram ID"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            label="启用验证码认证"
            name="verifyCodeEnabled"
            valuePropName="checked"
            extra="启用后，登录时需要通过 @ShenFenJiaoYanbot 进行验证码本人认证"
          >
            <Switch />
          </Form.Item>

          <Divider>自动回复广告</Divider>

          <Form.Item
            label="启用自动回复"
            name={['autoReplyAd', 'enabled']}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            label="回复内容"
            name={['autoReplyAd', 'text']}
          >
            <TextArea rows={4} placeholder="用户发送消息时自动回复的文本内容" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </>
  );
}
