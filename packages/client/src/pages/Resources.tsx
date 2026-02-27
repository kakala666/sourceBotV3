import { useEffect, useState, useCallback } from 'react';
import {
  Card, Button, List, Input, Space, message, Modal, Form, Select, Upload,
  Tag, Popconfirm, Typography, Pagination, Empty,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, UploadOutlined,
  FileImageOutlined, VideoCameraOutlined, AppstoreOutlined,
} from '@ant-design/icons';
import type {
  ResourceInfo, ResourceGroupInfo, ResourceGroupCreateInput,
  ApiResponse, PaginatedResponse, ResourceType,
} from 'shared';
import api from '@/services/api';

const { Title } = Typography;
const { Search } = Input;

export default function Resources() {
  // 分组状态
  const [groups, setGroups] = useState<ResourceGroupInfo[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ResourceGroupInfo | null>(null);
  const [groupForm] = Form.useForm<ResourceGroupCreateInput>();

  // 资源状态
  const [resources, setResources] = useState<ResourceInfo[]>([]);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  // 上传状态
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadForm] = Form.useForm();

  const fetchGroups = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<ResourceGroupInfo[]>>('/resource-groups');
      setGroups(data.data || []);
    } catch {
      message.error('获取分组失败');
    }
  }, []);

  const fetchResources = useCallback(async () => {
    setResourceLoading(true);
    try {
      const params: Record<string, unknown> = { page, pageSize: 12 };
      if (selectedGroupId) params.groupId = selectedGroupId;
      if (search) params.search = search;
      const { data } = await api.get<ApiResponse<PaginatedResponse<ResourceInfo>>>('/resources', { params });
      setResources(data.data?.items || []);
      setTotal(data.data?.total || 0);
    } catch {
      message.error('获取资源失败');
    } finally {
      setResourceLoading(false);
    }
  }, [page, selectedGroupId, search]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => { fetchResources(); }, [fetchResources]);

  // 分组操作
  const handleGroupSubmit = async () => {
    try {
      const values = await groupForm.validateFields();
      if (editingGroup) {
        await api.put(`/resource-groups/${editingGroup.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/resource-groups', values);
        message.success('创建成功');
      }
      setGroupModalOpen(false);
      groupForm.resetFields();
      setEditingGroup(null);
      fetchGroups();
    } catch {
      message.error('操作失败');
    }
  };

  const handleGroupDelete = async (id: number) => {
    try {
      await api.delete(`/resource-groups/${id}`);
      message.success('删除成功');
      if (selectedGroupId === id) setSelectedGroupId(null);
      fetchGroups();
    } catch {
      message.error('删除失败');
    }
  };

  const openEditGroup = (group: ResourceGroupInfo) => {
    setEditingGroup(group);
    groupForm.setFieldsValue({ name: group.name });
    setGroupModalOpen(true);
  };

  const openCreateGroup = () => {
    setEditingGroup(null);
    groupForm.resetFields();
    setGroupModalOpen(true);
  };

  // 资源操作
  const handleDeleteResource = async (id: number) => {
    try {
      await api.delete(`/resources/${id}`);
      message.success('删除成功');
      fetchResources();
    } catch {
      message.error('删除失败');
    }
  };

  const handleUpload = async () => {
    try {
      const values = await uploadForm.validateFields();
      const formData = new FormData();
      formData.append('type', values.type);
      if (values.groupId) formData.append('groupId', values.groupId);
      if (values.caption) formData.append('caption', values.caption);
      const fileList = values.files?.fileList || [];
      fileList.forEach((f: { originFileObj: File }) => {
        formData.append('files', f.originFileObj);
      });
      await api.post('/resources', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('上传成功');
      setUploadModalOpen(false);
      uploadForm.resetFields();
      fetchResources();
    } catch {
      message.error('上传失败');
    }
  };

  const typeIcon = (type: ResourceType) => {
    switch (type) {
      case 'photo': return <FileImageOutlined />;
      case 'video': return <VideoCameraOutlined />;
      case 'media_group': return <AppstoreOutlined />;
    }
  };

  const typeColor = (type: ResourceType) => {
    switch (type) {
      case 'photo': return 'blue';
      case 'video': return 'red';
      case 'media_group': return 'green';
    }
  };

  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>资源管理</Title>
      <div style={{ display: 'flex', gap: 24 }}>
        {/* 左侧分组列表 */}
        <div style={{ width: 260, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>资源分组</strong>
            <Button size="small" icon={<PlusOutlined />} onClick={openCreateGroup}>新增</Button>
          </div>
          <List
            bordered
            size="small"
            dataSource={[{ id: null, name: '全部资源' } as unknown as ResourceGroupInfo, ...groups]}
            renderItem={(item) => (
              <List.Item
                style={{
                  cursor: 'pointer',
                  background: selectedGroupId === item.id ? '#e6f4ff' : undefined,
                }}
                onClick={() => { setSelectedGroupId(item.id || null); setPage(1); }}
                actions={item.id ? [
                  <Button key="edit" size="small" type="text" icon={<EditOutlined />}
                    onClick={(e) => { e.stopPropagation(); openEditGroup(item); }} />,
                  <Popconfirm key="del" title="确定删除？"
                    onConfirm={(e) => { e?.stopPropagation(); handleGroupDelete(item.id); }}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>,
                ] : undefined}
              >
                {item.name}
              </List.Item>
            )}
          />
        </div>

        {/* 右侧资源列表 */}
        <div style={{ flex: 1 }}>
          <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
            <Search
              placeholder="搜索资源"
              allowClear
              onSearch={(v) => { setSearch(v); setPage(1); }}
              style={{ width: 300 }}
            />
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadModalOpen(true)}>
              上传资源
            </Button>
          </Space>

          {resources.length === 0 && !resourceLoading ? (
            <Empty description="暂无资源" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              {resources.map((res) => (
                <Card
                  key={res.id}
                  size="small"
                  loading={resourceLoading}
                  actions={[
                    <Popconfirm key="del" title="确定删除？" onConfirm={() => handleDeleteResource(res.id)}>
                      <DeleteOutlined />
                    </Popconfirm>,
                  ]}
                >
                  <div style={{ textAlign: 'center', fontSize: 32, padding: '12px 0', color: '#999' }}>
                    {typeIcon(res.type)}
                  </div>
                  <Card.Meta
                    title={<Tag color={typeColor(res.type)}>{res.type}</Tag>}
                    description={res.caption || '无描述'}
                  />
                  {res.group && (
                    <Tag style={{ marginTop: 8 }}>{res.group.name}</Tag>
                  )}
                </Card>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Pagination current={page} total={total} pageSize={12} onChange={setPage} showTotal={(t) => `共 ${t} 条`} />
          </div>
        </div>
      </div>

      {/* 分组弹窗 */}
      <Modal
        title={editingGroup ? '编辑分组' : '新增分组'}
        open={groupModalOpen}
        onOk={handleGroupSubmit}
        onCancel={() => { setGroupModalOpen(false); setEditingGroup(null); groupForm.resetFields(); }}
        destroyOnClose
      >
        <Form form={groupForm} layout="vertical">
          <Form.Item name="name" label="分组名称" rules={[{ required: true, message: '请输入分组名称' }]}>
            <Input placeholder="分组名称" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 上传弹窗 */}
      <Modal
        title="上传资源"
        open={uploadModalOpen}
        onOk={handleUpload}
        onCancel={() => { setUploadModalOpen(false); uploadForm.resetFields(); }}
        destroyOnClose
      >
        <Form form={uploadForm} layout="vertical">
          <Form.Item name="type" label="资源类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select placeholder="选择类型" options={[
              { label: '图片', value: 'photo' },
              { label: '视频', value: 'video' },
              { label: '媒体组', value: 'media_group' },
            ]} />
          </Form.Item>
          <Form.Item name="groupId" label="所属分组">
            <Select placeholder="选择分组（可选）" allowClear
              options={groups.map((g) => ({ label: g.name, value: g.id }))} />
          </Form.Item>
          <Form.Item name="caption" label="描述">
            <Input.TextArea placeholder="资源描述（可选）" rows={2} />
          </Form.Item>
          <Form.Item name="files" label="文件" rules={[{ required: true, message: '请选择文件' }]}>
            <Upload multiple beforeUpload={() => false} accept="image/*,video/*">
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
