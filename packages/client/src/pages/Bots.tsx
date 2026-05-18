import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Switch, Space, message, Popconfirm, Typography, Select, Alert,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SafetyCertificateOutlined, LinkOutlined, LockOutlined, CopyOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { BotInfo, BotCreateInput, ApiResponse } from 'shared';
import api from '@/services/api';
import SubscriptionGateDrawer from '@/components/SubscriptionGateDrawer';

const { Title } = Typography;

export default function Bots() {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<BotInfo | null>(null);
  const [botGateDrawerOpen, setBotGateDrawerOpen] = useState(false);
  const [botGateTarget, setBotGateTarget] = useState<{ id: number; name: string } | null>(null);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneSubmitting, setCloneSubmitting] = useState(false);
  const [cloneForm] = Form.useForm<{ name: string; token: string; sourceBotId: number }>();
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

  const openClone = () => {
    cloneForm.resetFields();
    setCloneModalOpen(true);
  };

  const handleClone = async () => {
    try {
      const values = await cloneForm.validateFields();
      setCloneSubmitting(true);
      const { data } = await api.post<ApiResponse<{
        newBot: BotInfo;
        copied: { links: number; contentBindings: number; adBindings: number; linkGates: number; botGate: number };
      }>>('/bots/clone', values);
      const c = data.data?.copied;
      message.success(
        c ? `克隆完成:链接 ${c.links} / 内容 ${c.contentBindings} / 广告 ${c.adBindings} / 链接级订阅 ${c.linkGates}`
          : '克隆完成'
      );
      setCloneModalOpen(false);
      cloneForm.resetFields();
      fetchBots();
    } catch (err: any) {
      if (err?.errorFields) return; // antd form 校验失败,不弹错
      message.error(err.response?.data?.message || '克隆失败');
    } finally {
      setCloneSubmitting(false);
    }
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
          <Button
            size="small"
            type="text"
            icon={<LockOutlined />}
            title="全局订阅配置"
            onClick={() => {
              setBotGateTarget({ id: record.id, name: record.name });
              setBotGateDrawerOpen(true);
            }}
          />
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
        <Space>
          <Button icon={<CopyOutlined />} onClick={openClone}>
            克隆机器人
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增机器人
          </Button>
        </Space>
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
        destroyOnHidden
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
      <SubscriptionGateDrawer
        level="bot"
        targetId={botGateTarget?.id ?? null}
        targetName={botGateTarget?.name ?? ''}
        open={botGateDrawerOpen}
        onClose={() => setBotGateDrawerOpen(false)}
      />

      <Modal
        title="克隆机器人"
        open={cloneModalOpen}
        onOk={handleClone}
        onCancel={() => { if (!cloneSubmitting) { setCloneModalOpen(false); cloneForm.resetFields(); } }}
        confirmLoading={cloneSubmitting}
        okText="开始克隆"
        cancelButtonProps={{ disabled: cloneSubmitting }}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="订阅频道配置会一并复制"
          description="如果源机器人配置了强制订阅频道,新机器人需要被加进同一批频道并设为管理员,否则订阅检查会拦截所有用户。"
        />
        <Form form={cloneForm} layout="vertical">
          <Form.Item name="name" label="新机器人名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="机器人名称" />
          </Form.Item>
          <Form.Item name="token" label="新机器人 Bot Token" rules={[{ required: true, message: '请输入 Token' }]}>
            <Input.Password placeholder="从 @BotFather 获取的 Token" />
          </Form.Item>
          <Form.Item
            name="sourceBotId"
            label="被克隆的源机器人"
            rules={[{ required: true, message: '请选择源机器人' }]}
            extra="复制链接 / 内容绑定 / 广告绑定 / 链接级订阅 / Bot 全局订阅"
          >
            <Select
              placeholder="选择要克隆配置的源机器人"
              options={bots.map((b) => ({
                label: `${b.name}${b.username ? ` (@${b.username})` : ''}`,
                value: b.id,
              }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
