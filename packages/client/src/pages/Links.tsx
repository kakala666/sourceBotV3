import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Table, Button, Modal, Form, Input, Space, message, Popconfirm, Typography, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ArrowLeftOutlined, CopyOutlined,
} from '@ant-design/icons';
import type {
  InviteLinkInfo, InviteLinkCreateInput, BotInfo,
  ApiResponse,
} from 'shared';
import api from '@/services/api';

const { Title } = Typography;

export default function Links() {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const [links, setLinks] = useState<InviteLinkInfo[]>([]);
  const [bot, setBot] = useState<BotInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<InviteLinkInfo | null>(null);
  const [form] = Form.useForm<InviteLinkCreateInput>();

  const fetchBot = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<BotInfo[]>>('/bots');
      const found = (data.data || []).find((b) => b.id === Number(botId));
      setBot(found || null);
    } catch {
      message.error('获取机器人信息失败');
    }
  }, [botId]);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<InviteLinkInfo[]>>(
        `/bots/${botId}/links`,
      );
      const items = data.data || [];
      setLinks(items);
      setTotal(items.length);
    } catch {
      message.error('获取链接列表失败');
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => { fetchBot(); }, [fetchBot]);
  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const getFullLink = (code: string) => {
    if (bot?.username) return `https://t.me/${bot.username}?start=${code}`;
    return `t.me/BOT?start=${code}`;
  };

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(getFullLink(code));
    message.success('已复制到剪贴板');
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingLink) {
        await api.put(`/bots/${botId}/links/${editingLink.id}`, values);
        message.success('更新成功');
      } else {
        await api.post(`/bots/${botId}/links`, values);
        message.success('创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditingLink(null);
      fetchLinks();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/bots/${botId}/links/${id}`);
      message.success('删除成功');
      fetchLinks();
    } catch {
      message.error('删除失败');
    }
  };

  const openEdit = (link: InviteLinkInfo) => {
    setEditingLink(link);
    form.setFieldsValue({ name: link.name, code: link.code });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditingLink(null);
    form.resetFields();
    setModalOpen(true);
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'Code', dataIndex: 'code', key: 'code', render: (v: string) => <code>{v}</code> },
    {
      title: '完整链接',
      key: 'fullLink',
      render: (_: unknown, record: InviteLinkInfo) => (
        <Space>
          <Tooltip title={getFullLink(record.code)}>
            <span style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
              {getFullLink(record.code)}
            </span>
          </Tooltip>
          <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(record.code)} />
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: InviteLinkInfo) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
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
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/bots')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>
            {bot ? `${bot.name} - 邀请链接管理` : '邀请链接管理'}
          </Title>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增链接</Button>
      </div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={links}
        loading={loading}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
      />
      <Modal
        title={editingLink ? '编辑链接' : '新增链接'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditingLink(null); form.resetFields(); }}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="链接名称" />
          </Form.Item>
          <Form.Item name="code" label="Code" rules={[{ required: true, message: '请输入 Code' }]}>
            <Input placeholder="唯一标识码" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
