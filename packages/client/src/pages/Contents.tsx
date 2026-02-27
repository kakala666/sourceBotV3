import { useEffect, useState, useCallback } from 'react';
import {
  Select, Button, Space, message, Typography, List, Modal, Checkbox, Input, Tag, Empty,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, HolderOutlined } from '@ant-design/icons';
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
  BotInfo, InviteLinkInfo, ContentBindingInfo, ResourceInfo,
  ResourceGroupInfo, ApiResponse, PaginatedResponse,
} from 'shared';
import api from '@/services/api';

const { Title } = Typography;

// 可拖拽排序项组件
function SortableItem({ id, children }: { id: number; children: React.ReactNode }) {
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

export default function Contents() {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [links, setLinks] = useState<InviteLinkInfo[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<number | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
  const [bindings, setBindings] = useState<ContentBindingInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 资源选择弹窗
  const [pickModalOpen, setPickModalOpen] = useState(false);
  const [allResources, setAllResources] = useState<ResourceInfo[]>([]);
  const [resourceGroups, setResourceGroups] = useState<ResourceGroupInfo[]>([]);
  const [pickGroupId, setPickGroupId] = useState<number | null>(null);
  const [pickSearch, setPickSearch] = useState('');
  const [pickSelected, setPickSelected] = useState<number[]>([]);
  const [pickPage, setPickPage] = useState(1);
  const [pickTotal, setPickTotal] = useState(0);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  // 获取机器人列表
  const fetchBots = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<BotInfo[]>>('/bots');
      setBots(data.data || []);
    } catch {
      message.error('获取机器人列表失败');
    }
  }, []);

  // 获取链接列表
  const fetchLinks = useCallback(async () => {
    if (!selectedBotId) { setLinks([]); return; }
    try {
      const { data } = await api.get<ApiResponse<InviteLinkInfo[]>>(
        `/bots/${selectedBotId}/links`,
      );
      setLinks(data.data || []);
    } catch {
      message.error('获取链接列表失败');
    }
  }, [selectedBotId]);

  // 获取内容绑定
  const fetchBindings = useCallback(async () => {
    if (!selectedLinkId) { setBindings([]); return; }
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<ContentBindingInfo[]>>(
        `/links/${selectedLinkId}/contents`,
      );
      setBindings(data.data || []);
    } catch {
      message.error('获取内容配置失败');
    } finally {
      setLoading(false);
    }
  }, [selectedLinkId]);

  useEffect(() => { fetchBots(); }, [fetchBots]);
  useEffect(() => { fetchLinks(); }, [fetchLinks]);
  useEffect(() => { fetchBindings(); }, [fetchBindings]);

  // Bot 切换时重置链接选择
  const handleBotChange = (botId: number) => {
    setSelectedBotId(botId);
    setSelectedLinkId(null);
    setBindings([]);
  };

  // 拖拽排序
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBindings((prev) => {
      const oldIdx = prev.findIndex((b) => b.id === active.id);
      const newIdx = prev.findIndex((b) => b.id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  // 删除绑定项
  const handleRemove = (id: number) => {
    setBindings((prev) => prev.filter((b) => b.id !== id));
  };

  // 保存
  const handleSave = async () => {
    if (!selectedLinkId) return;
    setSaving(true);
    try {
      await api.put(`/links/${selectedLinkId}/contents`, {
        items: bindings.map((b, i) => ({ resourceId: b.resourceId, sortOrder: i + 1 })),
      });
      message.success('保存成功');
      fetchBindings();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 打开资源选择弹窗
  const openPickModal = async () => {
    setPickSelected([]);
    setPickSearch('');
    setPickGroupId(null);
    setPickPage(1);
    setPickModalOpen(true);
    try {
      const { data } = await api.get<ApiResponse<ResourceGroupInfo[]>>('/resource-groups');
      setResourceGroups(data.data || []);
    } catch { /* ignore */ }
    fetchPickResources(1, null, '');
  };

  const fetchPickResources = async (pg: number, gId: number | null, s: string) => {
    try {
      const params: Record<string, unknown> = { page: pg, pageSize: 12 };
      if (gId) params.groupId = gId;
      if (s) params.search = s;
      const { data } = await api.get<ApiResponse<PaginatedResponse<ResourceInfo>>>('/resources', { params });
      setAllResources(data.data?.items || []);
      setPickTotal(data.data?.total || 0);
    } catch {
      message.error('获取资源失败');
    }
  };

  const handlePickConfirm = () => {
    const existingIds = new Set(bindings.map((b) => b.resourceId));
    const newItems: ContentBindingInfo[] = pickSelected
      .filter((rid) => !existingIds.has(rid))
      .map((rid, i) => {
        const res = allResources.find((r) => r.id === rid);
        return {
          id: Date.now() + i, // 临时 ID
          inviteLinkId: selectedLinkId!,
          resourceId: rid,
          sortOrder: bindings.length + i + 1,
          resource: res,
        };
      });
    setBindings((prev) => [...prev, ...newItems]);
    setPickModalOpen(false);
  };

  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>内容配置</Title>

      <Space style={{ marginBottom: 16 }}>
        <Select
          placeholder="选择机器人"
          style={{ width: 200 }}
          value={selectedBotId}
          onChange={handleBotChange}
          options={bots.map((b) => ({ label: b.name, value: b.id }))}
        />
        <Select
          placeholder="选择邀请链接"
          style={{ width: 200 }}
          value={selectedLinkId}
          onChange={setSelectedLinkId}
          disabled={!selectedBotId}
          options={links.map((l) => ({ label: l.name, value: l.id }))}
        />
        <Button icon={<PlusOutlined />} disabled={!selectedLinkId} onClick={openPickModal}>
          添加资源
        </Button>
        <Button type="primary" icon={<SaveOutlined />} disabled={!selectedLinkId} loading={saving} onClick={handleSave}>
          保存
        </Button>
      </Space>

      {!selectedLinkId ? (
        <Empty description="请先选择机器人和邀请链接" />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={bindings.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <List
              loading={loading}
              bordered
              dataSource={bindings}
              locale={{ emptyText: '暂无内容，点击"添加资源"开始配置' }}
              renderItem={(item, index) => (
                <List.Item>
                  <SortableItem id={item.id}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <Space>
                        <Tag>{index + 1}</Tag>
                        <Tag color="blue">{item.resource?.type || 'unknown'}</Tag>
                        <span>{item.resource?.caption || `资源 #${item.resourceId}`}</span>
                      </Space>
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleRemove(item.id)} />
                    </div>
                  </SortableItem>
                </List.Item>
              )}
            />
          </SortableContext>
        </DndContext>
      )}

      {/* 资源选择弹窗 */}
      <Modal
        title="选择资源"
        open={pickModalOpen}
        onOk={handlePickConfirm}
        onCancel={() => setPickModalOpen(false)}
        width={720}
        destroyOnClose
      >
        <Space style={{ marginBottom: 12 }}>
          <Select
            placeholder="按分组筛选"
            allowClear
            style={{ width: 160 }}
            value={pickGroupId}
            onChange={(v) => { setPickGroupId(v); setPickPage(1); fetchPickResources(1, v, pickSearch); }}
            options={resourceGroups.map((g) => ({ label: g.name, value: g.id }))}
          />
          <Input.Search
            placeholder="搜索"
            allowClear
            style={{ width: 200 }}
            onSearch={(v) => { setPickSearch(v); setPickPage(1); fetchPickResources(1, pickGroupId, v); }}
          />
        </Space>
        <Checkbox.Group value={pickSelected} onChange={(v) => setPickSelected(v as number[])}>
          <List
            grid={{ gutter: 12, column: 3 }}
            dataSource={allResources}
            pagination={{
              current: pickPage,
              total: pickTotal,
              pageSize: 12,
              size: 'small',
              onChange: (pg) => { setPickPage(pg); fetchPickResources(pg, pickGroupId, pickSearch); },
            }}
            renderItem={(res) => (
              <List.Item>
                <Checkbox value={res.id} style={{ width: '100%' }}>
                  <Tag color="blue">{res.type}</Tag>
                  {res.caption || `#${res.id}`}
                </Checkbox>
              </List.Item>
            )}
          />
        </Checkbox.Group>
      </Modal>
    </>
  );
}
