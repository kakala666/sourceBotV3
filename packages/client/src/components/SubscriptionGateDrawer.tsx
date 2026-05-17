import { useEffect, useState } from 'react';
import {
  Drawer, Switch, Input, Button, List, Tag, Space, message, Popconfirm, Typography, Divider, Segmented,
} from 'antd';
import { ReloadOutlined, DeleteOutlined, PlusOutlined, GlobalOutlined, LockOutlined } from '@ant-design/icons';
import type {
  SubscriptionGateInfo, SubscriptionGateChannelInfo, ApiResponse,
} from 'shared';
import api from '@/services/api';

const { Text, Paragraph } = Typography;

interface Props {
  linkId: number | null;
  linkName: string;
  open: boolean;
  onClose: () => void;
}

const STATUS_TAG: Record<SubscriptionGateChannelInfo['status'], { color: string; text: string }> = {
  ok: { color: 'green', text: '正常' },
  bot_not_admin: { color: 'orange', text: 'Bot 不是管理员' },
  channel_gone: { color: 'red', text: '频道不存在' },
};

export default function SubscriptionGateDrawer({ linkId, linkName, open, onClose }: Props) {
  const [gate, setGate] = useState<SubscriptionGateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newChatId, setNewChatId] = useState('');
  const [mode, setMode] = useState<'public' | 'private'>('public');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [template, setTemplate] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);

  const reload = async () => {
    if (!linkId) return;
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<SubscriptionGateInfo>>(`/links/${linkId}/subscription-gate`);
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
    if (open && linkId) reload();
    if (!open) {
      setGate(null);
      setNewUrl('');
      setNewChatId('');
      setMode('public');
      setAddError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, linkId]);

  const toggleEnabled = async (checked: boolean) => {
    if (!linkId) return;
    try {
      const { data } = await api.put<ApiResponse<SubscriptionGateInfo>>(
        `/links/${linkId}/subscription-gate`,
        { isEnabled: checked }
      );
      if (data.data) setGate(data.data);
      message.success(checked ? '已启用强制订阅' : '已关闭强制订阅');
    } catch {
      message.error('操作失败');
    }
  };

  const addChannel = async () => {
    if (!linkId) return;
    if (!newUrl.trim()) {
      setAddError(mode === 'private' ? '请填邀请链接(用户加入用)' : '请填频道链接');
      return;
    }
    if (mode === 'private' && !newChatId.trim()) {
      setAddError('请填私有频道的 chat_id(数字)');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const body: { inviteUrl: string; chatId?: string } = { inviteUrl: newUrl.trim() };
      if (mode === 'private') body.chatId = newChatId.trim();
      await api.post(`/links/${linkId}/subscription-gate/channels`, body);
      setNewUrl('');
      setNewChatId('');
      message.success('频道已添加');
      await reload();
    } catch (err: any) {
      setAddError(err.response?.data?.message || '添加失败');
    } finally {
      setAdding(false);
    }
  };

  const removeChannel = async (id: number) => {
    if (!linkId) return;
    try {
      await api.delete(`/links/${linkId}/subscription-gate/channels/${id}`);
      message.success('已移除');
      await reload();
    } catch {
      message.error('移除失败');
    }
  };

  const recheckChannel = async (id: number) => {
    if (!linkId) return;
    try {
      await api.post(`/links/${linkId}/subscription-gate/channels/${id}/recheck`);
      message.success('已重新验证');
      await reload();
    } catch (err: any) {
      message.error(err.response?.data?.message || '验证失败');
    }
  };

  const saveTemplate = async () => {
    if (!linkId) return;
    setTemplateSaving(true);
    try {
      await api.put(`/links/${linkId}/subscription-gate`, { promptTemplate: template });
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
      title={`强制订阅 — 链接: ${linkName}`}
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

          <Segmented
            value={mode}
            onChange={(v) => { setMode(v as 'public' | 'private'); setAddError(null); }}
            options={[
              { label: '公开频道', value: 'public', icon: <GlobalOutlined /> },
              { label: '私有频道', value: 'private', icon: <LockOutlined /> },
            ]}
            style={{ marginBottom: 8 }}
          />

          {mode === 'public' ? (
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
          ) : (
            <Space direction="vertical" style={{ width: '100%', marginBottom: 4 }} size={6}>
              <Input
                placeholder="邀请链接 https://t.me/+xxxxx(用户加入用)"
                value={newUrl}
                onChange={(e) => { setNewUrl(e.target.value); setAddError(null); }}
                disabled={adding}
              />
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="chat_id,如 -1001234567890 或 1234567890"
                  value={newChatId}
                  onChange={(e) => { setNewChatId(e.target.value); setAddError(null); }}
                  onPressEnter={addChannel}
                  disabled={adding}
                />
                <Button type="primary" icon={<PlusOutlined />} loading={adding} onClick={addChannel}>
                  添加
                </Button>
              </Space.Compact>
              <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                Bot 必须已是该私有频道的管理员;频道名将由 Bot 自动获取。
              </Paragraph>
            </Space>
          )}
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
                  title={
                    <span>
                      {c.isPrivate ? '🔒' : '📢'} {c.title}{' '}
                      <Text type="secondary">{c.isPrivate ? `id: ${c.chatId}` : `@${c.username}`}</Text>
                    </span>
                  }
                  description={
                    <Space size={4}>
                      <Tag color={c.isPrivate ? 'purple' : 'blue'}>
                        {c.isPrivate ? '私有' : '公开'}
                      </Tag>
                      <Tag color={STATUS_TAG[c.status].color}>{STATUS_TAG[c.status].text}</Tag>
                    </Space>
                  }
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
