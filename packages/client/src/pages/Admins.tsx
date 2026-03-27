import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Switch, Space, message, Popconfirm, Typography, Tag,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { AdminInfo, AdminCreateInput, ApiResponse } from 'shared';
import { useAuthStore } from '@/stores/auth';
import api from '@/services/api';

const { Title } = Typography;

export default function Admins() {
  const [admins, setAdmins] = useState<AdminInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminInfo | null>(null);
  const [form] = Form.useForm<AdminCreateInput & { password?: string }>();
  const currentAdminId = useAuthStore((s) => s.admin?.id);

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<AdminInfo[]>>('/admins');
      setAdmins(data.data || []);
    } catch {
      message.error('获取账号列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        const { password, ...rest } = values;
        const payload = password ? values : rest;
        await api.put(`/admins/${editing.id}`, payload);
        message.success('更新成功');
      } else {
        await api.post('/admins', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      fetchAdmins();
    } catch (err: any) {
      const msg = err.response?.data?.message || '操作失败';
      message.error(msg);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/admins/${id}`);
      message.success('删除成功');
      fetchAdmins();
    } catch (err: any) {
      const msg = err.response?.data?.message || '删除失败';
      message.error(msg);
    }
  };

  const openEdit = (admin: AdminInfo) => {
    setEditing(admin);
    form.setFieldsValue({
      name: admin.name,
      username: admin.username,
      telegramId: admin.telegramId || undefined,
      canManageAccounts: admin.canManageAccounts,
    });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '账号', dataIndex: 'username', key: 'username' },
    {
      title: 'Telegram ID',
      dataIndex: 'telegramId',
      key: 'telegramId',
      render: (v: string | null) => v || '-',
    },
    {
      title: '账号管理权限',
      dataIndex: 'canManageAccounts',
      key: 'canManageAccounts',
      render: (v: boolean) => v ? <Tag color="blue">有权限</Tag> : <Tag>无权限</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: AdminInfo) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          {record.id !== currentAdminId && (
            <Popconfirm title="确定删除该账号？" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>账号管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增账号
        </Button>
      </div>
      <Table rowKey="id" columns={columns} dataSource={admins} loading={loading} pagination={false} />
      <Modal
        title={editing ? '编辑账号' : '新增账号'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="管理员姓名" />
          </Form.Item>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input placeholder="登录账号" />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? '密码（留空则不修改）' : '密码'}
            rules={editing ? [] : [{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder={editing ? '留空则不修改' : '登录密码'} />
          </Form.Item>
          <Form.Item name="telegramId" label="Telegram ID">
            <Input placeholder="可选，用户的 Telegram ID" />
          </Form.Item>
          <Form.Item name="canManageAccounts" label="账号管理权限" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
