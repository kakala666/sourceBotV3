import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Switch, Space, message, Popconfirm, Typography,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SafetyCertificateOutlined, LinkOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { BotInfo, BotCreateInput, ApiResponse } from 'shared';
import api from '@/services/api';

const { Title } = Typography;

export default function Bots() {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<BotInfo | null>(null);
  const [form] = Form.useForm<BotCreateInput>();
  const navigate = useNavigate();

  const fetchBots = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<BotInfo[]>>('/bots');
      const list = data.data || [];
      setBots(list);
      setTotal(list.length);
    } catch {
      message.error('获取机器人列表失败');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchBots(); }, [fetchBots]);

  const maskToken = (token: string) => {
    if (token.length <= 12) return '****';
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingBot) {
        await api.put(`/bots/${editingBot.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/bots', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditingBot(null);
      fetchBots();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/bots/${id}`);
      message.success('删除成功');
      fetchBots();
    } catch {
      message.error('删除失败');
    }
  };

  const handleToggleActive = async (bot: BotInfo) => {
    try {
      await api.put(`/bots/${bot.id}`, { isActive: !bot.isActive });
      message.success(bot.isActive ? '已停用' : '已启用');
      fetchBots();
    } catch {
      message.error('操作失败');
    }
  };

  const handleVerify = async (id: number) => {
    try {
      await api.post(`/bots/${id}/verify`);
      message.success('验证成功');
      fetchBots();
    } catch {
      message.error('验证失败，请检查 Token 是否正确');
    }
  };

  const openEdit = (bot: BotInfo) => {
    setEditingBot(bot);
    form.setFieldsValue({ name: bot.name, token: bot.token });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditingBot(null);
    form.resetFields();
    setModalOpen(true);
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: 'Token',
      dataIndex: 'token',
      key: 'token',
      render: (token: string) => <code>{maskToken(token)}</code>,
    },
    { title: '@用户名', dataIndex: 'username', key: 'username',
      render: (v: string | null) => v ? `@${v}` : '-',
    },
    {
      title: '状态',
      key: 'isActive',
      render: (_: unknown, record: BotInfo) => (
        <Switch checked={record.isActive} onChange={() => handleToggleActive(record)} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: BotInfo) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" icon={<SafetyCertificateOutlined />} onClick={() => handleVerify(record.id)}>
            验证
          </Button>
          <Button size="small" icon={<LinkOutlined />} onClick={() => navigate(`/bots/${record.id}/links`)}>
            管理链接
          </Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>机器人管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增机器人
        </Button>
      </div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={bots}
        loading={loading}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
      />
      <Modal
        title={editingBot ? '编辑机器人' : '新增机器人'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditingBot(null); form.resetFields(); }}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="机器人名称" />
          </Form.Item>
          <Form.Item name="token" label="Bot Token" rules={[{ required: true, message: '请输入 Token' }]}>
            <Input.Password placeholder="从 @BotFather 获取的 Token" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
