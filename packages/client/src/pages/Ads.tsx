import { useEffect, useState, useCallback } from 'react';
import {
  Select, Button, Space, message, Typography, List, Modal, Checkbox, Input,
  Tag, Empty, Collapse,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, HolderOutlined, MinusCircleOutlined,
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
  BotInfo, InviteLinkInfo, AdBindingInfo, AdButton, ResourceInfo,
  ResourceGroupInfo, ApiResponse, PaginatedResponse,
} from 'shared';
import api from '@/services/api';

const { Title } = Typography;

// 可拖拽广告项
function SortableAdItem({ id, children }: { id: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <HolderOutlined {...listeners} style={{ cursor: 'grab', color: '#999' }} />
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

// 内联按钮编辑器
function ButtonsEditor({ buttons, onChange }: { buttons: AdButton[]; onChange: (btns: AdButton[]) => void }) {
  const addButton = () => onChange([...buttons, { text: '', url: '' }]);
  const removeButton = (idx: number) => onChange(buttons.filter((_, i) => i !== idx));
  const updateButton = (idx: number, field: keyof AdButton, value: string) => {
    const next = buttons.map((b, i) => (i === idx ? { ...b, [field]: value } : b));
    onChange(next);
  };

  return (
    <div>
      <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>内联按钮配置：</div>
      {buttons.map((btn, idx) => (
        <Space key={idx} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
          <Input
            placeholder="按钮文字"
            value={btn.text}
            onChange={(e) => updateButton(idx, 'text', e.target.value)}
            style={{ width: 160 }}
          />
          <Input
            placeholder="链接 URL"
            value={btn.url}
            onChange={(e) => updateButton(idx, 'url', e.target.value)}
            style={{ width: 260 }}
          />
          <MinusCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} onClick={() => removeButton(idx)} />
        </Space>
      ))}
      <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addButton}>
        添加按钮
      </Button>
    </div>
  );
}

export default function Ads() {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [links, setLinks] = useState<InviteLinkInfo[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<number | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
  const [bindings, setBindings] = useState<AdBindingInfo[]>([]);
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

  const fetchBots = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<BotInfo[]>>('/bots');
      setBots(data.data || []);
    } catch {
      message.error('获取机器人列表失败');
    }
  }, []);

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

  const fetchBindings = useCallback(async () => {
    if (!selectedLinkId) { setBindings([]); return; }
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<AdBindingInfo[]>>(
        `/links/${selectedLinkId}/ads`,
      );
      setBindings(data.data || []);
    } catch {
      message.error('获取广告配置失败');
    } finally {
      setLoading(false);
    }
  }, [selectedLinkId]);

  useEffect(() => { fetchBots(); }, [fetchBots]);
  useEffect(() => { fetchLinks(); }, [fetchLinks]);
  useEffect(() => { fetchBindings(); }, [fetchBindings]);

  const handleBotChange = (botId: number) => {
    setSelectedBotId(botId);
    setSelectedLinkId(null);
    setBindings([]);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBindings((prev) => {
      const oldIdx = prev.findIndex((b) => b.id === active.id);
      const newIdx = prev.findIndex((b) => b.id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const handleRemove = (id: number) => {
    setBindings((prev) => prev.filter((b) => b.id !== id));
  };

  const handleButtonsChange = (bindingId: number, buttons: AdButton[]) => {
    setBindings((prev) =>
      prev.map((b) => (b.id === bindingId ? { ...b, buttons } : b)),
    );
  };

  const handleSave = async () => {
    if (!selectedLinkId) return;
    setSaving(true);
    try {
      await api.put(`/links/${selectedLinkId}/ads`, {
        items: bindings.map((b, i) => ({
          resourceId: b.resourceId,
          sortOrder: i + 1,
          buttons: b.buttons || [],
        })),
      });
      message.success('保存成功');
      fetchBindings();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

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
    const newItems: AdBindingInfo[] = pickSelected
      .filter((rid) => !existingIds.has(rid))
      .map((rid, i) => {
        const res = allResources.find((r) => r.id === rid);
        return {
          id: Date.now() + i,
          inviteLinkId: selectedLinkId!,
          resourceId: rid,
          sortOrder: bindings.length + i + 1,
          buttons: [],
          resource: res,
        };
      });
    setBindings((prev) => [...prev, ...newItems]);
    setPickModalOpen(false);
  };

  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>广告配置</Title>

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
          添加广告
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
              locale={{ emptyText: '暂无广告，点击"添加广告"开始配置' }}
              renderItem={(item, index) => (
                <List.Item style={{ display: 'block' }}>
                  <SortableAdItem id={item.id}>
                    <Collapse
                      size="small"
                      items={[{
                        key: item.id,
                        label: (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Space>
                              <Tag>{index + 1}</Tag>
                              <Tag color="orange">{item.resource?.type || 'unknown'}</Tag>
                              <span>{item.resource?.caption || `资源 #${item.resourceId}`}</span>
                            </Space>
                            <Button size="small" danger icon={<DeleteOutlined />}
                              onClick={(e) => { e.stopPropagation(); handleRemove(item.id); }} />
                          </div>
                        ),
                        children: (
                          <ButtonsEditor
                            buttons={item.buttons || []}
                            onChange={(btns) => handleButtonsChange(item.id, btns)}
                          />
                        ),
                      }]}
                    />
                  </SortableAdItem>
                </List.Item>
              )}
            />
          </SortableContext>
        </DndContext>
      )}

      {/* 资源选择弹窗 */}
      <Modal
        title="选择广告资源"
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