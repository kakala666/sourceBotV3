import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Switch, Space, message, Popconfirm, Typography, Select, Alert, Tag,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SafetyCertificateOutlined, LinkOutlined, LockOutlined, CopyOutlined, SyncOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { BotInfo, BotCreateInput, BotAutoSyncConfigInfo, ApiResponse } from 'shared';
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
  const [autoSyncModalOpen, setAutoSyncModalOpen] = useState(false);
  const [autoSyncTarget, setAutoSyncTarget] = useState<BotInfo | null>(null);
  const [autoSyncConfig, setAutoSyncConfig] = useState<BotAutoSyncConfigInfo | null>(null);
  const [autoSyncLoading, setAutoSyncLoading] = useState(false);
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);
  const [autoSyncRunning, setAutoSyncRunning] = useState(false);
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

  const openAutoSync = async (bot: BotInfo) => {
    setAutoSyncTarget(bot);
    setAutoSyncModalOpen(true);
    setAutoSyncLoading(true);
    setAutoSyncConfig(null);
    try {
      const { data } = await api.get<ApiResponse<BotAutoSyncConfigInfo>>(`/bots/${bot.id}/auto-sync`);
      setAutoSyncConfig(data.data || null);
    } catch {
      message.error('获取自动同步配置失败');
    } finally {
      setAutoSyncLoading(false);
    }
  };

  const handleAutoSyncSave = async (vals: { enabled: boolean; targetBotId: number | null }) => {
    if (!autoSyncTarget) return;
    setAutoSyncSaving(true);
    try {
      const { data } = await api.put<ApiResponse<BotAutoSyncConfigInfo>>(
        `/bots/${autoSyncTarget.id}/auto-sync`,
        { enabled: vals.enabled, targetBotId: vals.targetBotId ?? null },
      );
      setAutoSyncConfig(data.data || null);
      message.success('已保存');
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setAutoSyncSaving(false);
    }
  };

  const handleAutoSyncRunNow = async () => {
    if (!autoSyncTarget) return;
    setAutoSyncRunning(true);
    try {
      const { data } = await api.post<ApiResponse<{ status: string; message: string }>>(
        `/bots/${autoSyncTarget.id}/auto-sync/run`,
      );
      message.success(data.data?.message || '同步完成');
      // 刷新配置以拿最新 lastSyncAt / message
      const { data: cfg } = await api.get<ApiResponse<BotAutoSyncConfigInfo>>(
        `/bots/${autoSyncTarget.id}/auto-sync`,
      );
      setAutoSyncConfig(cfg.data || null);
    } catch (err: any) {
      message.error(err.response?.data?.message || '同步失败');
    } finally {
      setAutoSyncRunning(false);
    }
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
          <Button
            size="small"
            type="text"
            icon={<SyncOutlined />}
            title="自动同步"
            onClick={() => openAutoSync(record)}
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

      <AutoSyncModal
        bot={autoSyncTarget}
        bots={bots}
        config={autoSyncConfig}
        loading={autoSyncLoading}
        saving={autoSyncSaving}
        running={autoSyncRunning}
        open={autoSyncModalOpen}
        onClose={() => setAutoSyncModalOpen(false)}
        onSave={handleAutoSyncSave}
        onRunNow={handleAutoSyncRunNow}
      />
    </>
  );
}

function AutoSyncModal({
  bot, bots, config, loading, saving, running, open, onClose, onSave, onRunNow,
}: {
  bot: BotInfo | null;
  bots: BotInfo[];
  config: BotAutoSyncConfigInfo | null;
  loading: boolean;
  saving: boolean;
  running: boolean;
  open: boolean;
  onClose: () => void;
  onSave: (vals: { enabled: boolean; targetBotId: number | null }) => Promise<void>;
  onRunNow: () => Promise<void>;
}) {
  const [form] = Form.useForm<{ enabled: boolean; targetBotId: number | null }>();

  useEffect(() => {
    if (config) {
      form.setFieldsValue({ enabled: config.enabled, targetBotId: config.targetBotId });
    } else {
      form.resetFields();
    }
  }, [config, form]);

  const statusTag = config?.lastSyncStatus
    ? config.lastSyncStatus === 'success'
      ? <Tag color="green">成功</Tag>
      : config.lastSyncStatus === 'partial'
        ? <Tag color="orange">部分成功</Tag>
        : <Tag color="red">失败</Tag>
    : <Tag>未运行</Tag>;

  return (
    <Modal
      title={bot ? `自动同步 - ${bot.name}` : '自动同步'}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={520}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="每日凌晨 00:00 自动从目标机器人同步同名链接的资源内容(完全覆盖)。订阅频道/赞助商/按钮不同步。"
      />
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => onSave({ enabled: v.enabled, targetBotId: v.targetBotId ?? null })}
        disabled={loading}
      >
        <Form.Item name="enabled" label="启用自动同步" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="targetBotId"
          label="同步源(目标机器人)"
          extra="每天从这个机器人拉取同名链接的资源内容,覆盖本机器人"
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (getFieldValue('enabled') && !value) return Promise.reject(new Error('启用后必须选择目标'));
                return Promise.resolve();
              },
            }),
          ]}
        >
          <Select
            placeholder="选择源机器人"
            allowClear
            options={bots
              .filter((b) => b.id !== bot?.id)
              .map((b) => ({
                label: `${b.name}${b.username ? ` (@${b.username})` : ''}`,
                value: b.id,
              }))}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
        <Space style={{ marginTop: 8 }}>
          <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
          <Button onClick={onRunNow} loading={running} disabled={!config?.enabled || !config?.targetBotId}>
            立即同步一次
          </Button>
        </Space>
      </Form>
      <div style={{ marginTop: 24, padding: '12px 16px', background: '#fafafa', borderRadius: 4 }}>
        <Typography.Text type="secondary">上次同步</Typography.Text>
        <div style={{ marginTop: 8 }}>
          {statusTag}
          {config?.lastSyncAt && (
            <span style={{ marginLeft: 8, color: '#666' }}>
              {dayjs(config.lastSyncAt).format('YYYY-MM-DD HH:mm:ss')}
            </span>
          )}
          {config?.lastSyncMessage && (
            <div style={{ marginTop: 6, color: '#333' }}>{config.lastSyncMessage}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
