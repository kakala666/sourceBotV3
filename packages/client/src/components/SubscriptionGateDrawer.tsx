import { useEffect, useState } from 'react';
import {
  Drawer, Switch, Input, Button, List, Tag, Space, message, Popconfirm, Typography, Divider,
} from 'antd';
import { ReloadOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type {
  SubscriptionGateInfo, SubscriptionGateChannelInfo, ApiResponse,
} from 'shared';
import api from '@/services/api';

const { Text, Paragraph } = Typography;

interface Props {
  botId: number | null;
  botName: string;
  open: boolean;
  onClose: () => void;
}

const STATUS_TAG: Record<SubscriptionGateChannelInfo['status'], { color: string; text: string }> = {
  ok: { color: 'green', text: '正常' },
  bot_not_admin: { color: 'orange', text: 'Bot 不是管理员' },
  channel_gone: { color: 'red', text: '频道不存在' },
};

export default function SubscriptionGateDrawer({ botId, botName, open, onClose }: Props) {
  const [gate, setGate] = useState<SubscriptionGateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [template, setTemplate] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);

  const reload = async () => {
    if (!botId) return;
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<SubscriptionGateInfo>>(`/bots/${botId}/subscription-gate`);
      if (data.data) {
        setGate(data.data);
        setTemplate(data.data.promptTemplate ?? '');
      }
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && botId) reload();
    if (!open) { setGate(null); setNewUrl(''); setAddError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, botId]);

  const toggleEnabled = async (checked: boolean) => {
    if (!botId) return;
    try {
      const { data } = await api.put<ApiResponse<SubscriptionGateInfo>>(
        `/bots/${botId}/subscription-gate`,
        { isEnabled: checked }
      );
      if (data.data) setGate(data.data);
      message.success(checked ? '已启用强制订阅' : '已关闭强制订阅');
    } catch {
      message.error('操作失败');
    }
  };

  const addChannel = async () => {
    if (!botId || !newUrl.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await api.post(`/bots/${botId}/subscription-gate/channels`, { inviteUrl: newUrl.trim() });
      setNewUrl('');
      message.success('频道已添加');
      await reload();
    } catch (err: any) {
      setAddError(err.response?.data?.message || '添加失败');
    } finally {
      setAdding(false);
    }
  };

  const removeChannel = async (id: number) => {
    if (!botId) return;
    try {
      await api.delete(`/bots/${botId}/subscription-gate/channels/${id}`);
      message.success('已移除');
      await reload();
    } catch {
      message.error('移除失败');
    }
  };

  const recheckChannel = async (id: number) => {
    if (!botId) return;
    try {
      await api.post(`/bots/${botId}/subscription-gate/channels/${id}/recheck`);
      message.success('已重新验证');
      await reload();
    } catch (err: any) {
      message.error(err.response?.data?.message || '验证失败');
    }
  };

  const saveTemplate = async () => {
    if (!botId) return;
    setTemplateSaving(true);
    try {
      await api.put(`/bots/${botId}/subscription-gate`, { promptTemplate: template });
      message.success('提示文案已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setTemplateSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`强制订阅 — ${botName}`}
      width={520}
      destroyOnClose
    >
      {loading && !gate ? '加载中...' : (
        <>
          <Space style={{ marginBottom: 16 }}>
            <Text strong>启用强制订阅</Text>
            <Switch checked={gate?.isEnabled ?? false} onChange={toggleEnabled} />
          </Space>

          <Divider orientation="left">必订频道(全部订阅才通过)</Divider>

          <Space.Compact style={{ width: '100%', marginBottom: 4 }}>
            <Input
              placeholder="@xxx 或 https://t.me/xxx"
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); setAddError(null); }}
              onPressEnter={addChannel}
              disabled={adding}
            />
            <Button type="primary" icon={<PlusOutlined />} loading={adding} onClick={addChannel}>
              添加
            </Button>
          </Space.Compact>
          {addError && <Text type="danger" style={{ display: 'block', marginBottom: 12 }}>{addError}</Text>}

          <List
            dataSource={gate?.channels ?? []}
            locale={{ emptyText: '尚未添加频道' }}
            renderItem={(c) => (
              <List.Item
                actions={[
                  <Button key="recheck" size="small" icon={<ReloadOutlined />} onClick={() => recheckChannel(c.id)}>重新验证</Button>,
                  <Popconfirm key="del" title="确定移除？" onConfirm={() => removeChannel(c.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />}>移除</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={<span>📢 {c.title} <Text type="secondary">@{c.username}</Text></span>}
                  description={<Tag color={STATUS_TAG[c.status].color}>{STATUS_TAG[c.status].text}</Tag>}
                />
              </List.Item>
            )}
          />

          <Divider orientation="left">提示文案模板</Divider>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            留空使用默认模板。支持占位 <Text code>{'{channels}'}</Text> = 未订阅频道列表
          </Paragraph>
          <Input.TextArea
            rows={5}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder={'请先订阅以下频道,然后点击「我已完成」继续:\n{channels}'}
          />
          <Button
            type="primary"
            onClick={saveTemplate}
            loading={templateSaving}
            style={{ marginTop: 8 }}
          >
            保存文案
          </Button>
        </>
      )}
    </Drawer>
  );
}
