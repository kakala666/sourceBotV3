import { useEffect, useMemo, useState } from 'react';
import {
  Drawer, Switch, Input, Button, List, Tag, Space, message, Popconfirm, Typography, Divider, Segmented,
} from 'antd';
import {
  ReloadOutlined, DeleteOutlined, PlusOutlined, GlobalOutlined, LockOutlined, HolderOutlined,
} from '@ant-design/icons';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove, SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type {
  SubscriptionGateInfo, SubscriptionGateChannelInfo, ChannelKind, ApiResponse,
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

const POSITION_REGEX = /^[1-9]\d*(,[1-9]\d*)*$/;

function SortableSponsorRow({ id, children }: { id: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <HolderOutlined {...listeners} style={{ cursor: 'grab', color: '#999' }} />
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

export default function SubscriptionGateDrawer({ linkId, linkName, open, onClose }: Props) {
  const [gate, setGate] = useState<SubscriptionGateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<ChannelKind>('primary');
  const [newUrl, setNewUrl] = useState('');
  const [newChatId, setNewChatId] = useState('');
  const [mode, setMode] = useState<'public' | 'private'>('public');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [template, setTemplate] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [positionsText, setPositionsText] = useState('');
  const [positionsSaving, setPositionsSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  const primaryChannels = useMemo(
    () => (gate?.channels ?? []).filter((c) => c.kind === 'primary'),
    [gate],
  );
  const sponsorChannels = useMemo(
    () => (gate?.channels ?? []).filter((c) => c.kind === 'sponsor'),
    [gate],
  );

  const reload = async () => {
    if (!linkId) return;
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<SubscriptionGateInfo>>(`/links/${linkId}/subscription-gate`);
      if (data.data) {
        setGate(data.data);
        setTemplate(data.data.promptTemplate ?? '');
        setPositionsText((data.data.sponsorPositions ?? []).join(','));
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
      setKind('primary');
      setAddError(null);
      setPositionsText('');
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
      const body: { inviteUrl: string; chatId?: string; kind: ChannelKind } = {
        inviteUrl: newUrl.trim(),
        kind,
      };
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

  const savePositions = async () => {
    if (!linkId) return;
    const raw = positionsText.trim();
    if (!POSITION_REGEX.test(raw)) {
      message.error('格式错误:请用英文逗号分隔正整数,不要空格');
      return;
    }
    const arr = raw.split(',').map((s) => Number(s));
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] <= arr[i - 1]) {
        message.error('触发位置必须严格递增');
        return;
      }
    }
    if (arr.length !== sponsorChannels.length) {
      message.error(`位置数量必须等于赞助商数量(当前 ${sponsorChannels.length} 个赞助商,${arr.length} 个位置)`);
      return;
    }
    setPositionsSaving(true);
    try {
      const { data } = await api.put<ApiResponse<SubscriptionGateInfo>>(
        `/links/${linkId}/subscription-gate/sponsor-positions`,
        { positions: arr },
      );
      if (data.data) {
        setGate(data.data);
        setPositionsText((data.data.sponsorPositions ?? []).join(','));
      }
      message.success('触发位置已保存');
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setPositionsSaving(false);
    }
  };

  const handleSponsorDragEnd = async (e: DragEndEvent) => {
    if (!linkId) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = sponsorChannels.findIndex((c) => c.id === active.id);
    const newIdx = sponsorChannels.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(sponsorChannels, oldIdx, newIdx);
    // 乐观更新
    setGate((prev) =>
      prev
        ? {
            ...prev,
            channels: [
              ...primaryChannels,
              ...reordered.map((c, idx) => ({ ...c, sortOrder: idx })),
            ],
          }
        : prev,
    );
    try {
      const { data } = await api.put<ApiResponse<SubscriptionGateInfo>>(
        `/links/${linkId}/subscription-gate/channels/reorder`,
        { orderedIds: reordered.map((c) => c.id) },
      );
      if (data.data) setGate(data.data);
      message.success('已调整顺序');
    } catch (err: any) {
      message.error(err.response?.data?.message || '调整失败');
      await reload();
    }
  };

  const renderChannelRow = (c: SubscriptionGateChannelInfo) => (
    <List.Item
      key={c.id}
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
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`强制订阅 — 链接: ${linkName}`}
      width={560}
      destroyOnClose
    >
      {loading && !gate ? '加载中...' : (
        <>
          <Space style={{ marginBottom: 16 }}>
            <Text strong>启用强制订阅</Text>
            <Switch checked={gate?.isEnabled ?? false} onChange={toggleEnabled} />
          </Space>

          <Divider orientation="left">添加频道</Divider>

          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Segmented
              value={kind}
              onChange={(v) => { setKind(v as ChannelKind); setAddError(null); }}
              options={[
                { label: '主频道(必订)', value: 'primary' },
                { label: '广告赞助商', value: 'sponsor' },
              ]}
              block
            />
            <Segmented
              value={mode}
              onChange={(v) => { setMode(v as 'public' | 'private'); setAddError(null); }}
              options={[
                { label: '公开频道', value: 'public', icon: <GlobalOutlined /> },
                { label: '私有频道', value: 'private', icon: <LockOutlined /> },
              ]}
            />

            {mode === 'public' ? (
              <Space.Compact style={{ width: '100%' }}>
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
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
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
            {addError && <Text type="danger">{addError}</Text>}
          </Space>

          <Divider orientation="left">主频道(每次都校验)</Divider>
          <List
            dataSource={primaryChannels}
            locale={{ emptyText: '尚未添加主频道' }}
            renderItem={renderChannelRow}
          />

          <Divider orientation="left">广告赞助商(按位置轮询,可拖拽排序)</Divider>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            按下方「触发位置」决定在第几个资源时检测对应赞助商:位置 i 命中赞助商 i。
            位置数量必须等于赞助商数量,未配置时默认为 <Text code>3,6,9,12,…</Text>。
          </Paragraph>
          <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
            <Input
              placeholder="例如 3,6,9(英文逗号,严格递增,无空格)"
              value={positionsText}
              onChange={(e) => setPositionsText(e.target.value)}
              onPressEnter={savePositions}
              disabled={positionsSaving}
            />
            <Button type="primary" onClick={savePositions} loading={positionsSaving}>
              保存位置
            </Button>
          </Space.Compact>

          {sponsorChannels.length === 0 ? (
            <Text type="secondary">尚未添加赞助商频道</Text>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSponsorDragEnd}>
              <SortableContext
                items={sponsorChannels.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {sponsorChannels.map((c, idx) => {
                  const pos = gate?.sponsorPositions?.[idx];
                  return (
                    <SortableSponsorRow key={c.id} id={c.id}>
                      <div style={{ borderBottom: '1px solid #f0f0f0', padding: '8px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <Tag color="gold">位置 {pos ?? '—'}</Tag>
                            <Text>{c.isPrivate ? '🔒' : '📢'} {c.title}</Text>{' '}
                            <Text type="secondary">{c.isPrivate ? `id: ${c.chatId}` : `@${c.username}`}</Text>
                          </div>
                          <Space size={4}>
                            <Tag color={STATUS_TAG[c.status].color}>{STATUS_TAG[c.status].text}</Tag>
                            <Button size="small" icon={<ReloadOutlined />} onClick={() => recheckChannel(c.id)}>
                              重新验证
                            </Button>
                            <Popconfirm title="确定移除？" onConfirm={() => removeChannel(c.id)}>
                              <Button size="small" danger icon={<DeleteOutlined />}>移除</Button>
                            </Popconfirm>
                          </Space>
                        </div>
                      </div>
                    </SortableSponsorRow>
                  );
                })}
              </SortableContext>
            </DndContext>
          )}

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
