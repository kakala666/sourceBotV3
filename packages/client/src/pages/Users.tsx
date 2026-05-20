import { useEffect, useState, useCallback } from 'react';
import {
  Table, Input, Select, Space, message, Typography, Button, Drawer, Tag,
} from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type {
  BotUserInfo, BotInfo, InviteLinkInfo, BotUserActionItem,
  ApiResponse, PaginatedResponse,
} from 'shared';
import api from '@/services/api';

const { Title } = Typography;
const { Search } = Input;

export default function Users() {
  const [users, setUsers] = useState<BotUserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [links, setLinks] = useState<InviteLinkInfo[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<number | undefined>();
  const [selectedLinkId, setSelectedLinkId] = useState<number | undefined>();

  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<BotUserInfo | null>(null);
  const [actions, setActions] = useState<BotUserActionItem[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionPage, setActionPage] = useState(1);
  const [actionTotal, setActionTotal] = useState(0);

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

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, pageSize: 20 };
      if (search) params.search = search;
      if (selectedBotId) params.botId = selectedBotId;
      if (selectedLinkId) params.linkId = selectedLinkId;
      const { data } = await api.get<ApiResponse<PaginatedResponse<BotUserInfo>>>(
        '/users', { params },
      );
      setUsers(data.data?.items || []);
      setTotal(data.data?.total || 0);
    } catch {
      message.error('获取用户列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, search, selectedBotId, selectedLinkId]);

  useEffect(() => { fetchBots(); }, [fetchBots]);
  useEffect(() => { fetchLinks(); }, [fetchLinks]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleBotChange = (v: number | undefined) => {
    setSelectedBotId(v);
    setSelectedLinkId(undefined);
    setPage(1);
  };

  const fetchActions = useCallback(async (userId: number, p: number) => {
    setActionLoading(true);
    try {
      const { data } = await api.get<ApiResponse<PaginatedResponse<BotUserActionItem>>>(
        `/users/${userId}/actions`,
        { params: { page: p, pageSize: 20 } },
      );
      setActions(data.data?.items || []);
      setActionTotal(data.data?.total || 0);
    } catch {
      message.error('获取操作记录失败');
    } finally {
      setActionLoading(false);
    }
  }, []);

  const openActions = (user: BotUserInfo) => {
    setActionTarget(user);
    setActionPage(1);
    setActions([]);
    setActionTotal(0);
    setActionDrawerOpen(true);
    fetchActions(user.id, 1);
  };

  const columns = [
    { title: 'Telegram ID', dataIndex: 'telegramId', key: 'telegramId' },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (v: string | null) => v ? `@${v}` : '-',
    },
    {
      title: '姓名',
      key: 'name',
      render: (_: unknown, r: BotUserInfo) =>
        [r.firstName, r.lastName].filter(Boolean).join(' ') || '-',
    },
    {
      title: '来源 Bot',
      dataIndex: 'botId',
      key: 'botId',
      render: (v: number) => bots.find((b) => b.id === v)?.name || v,
    },
    {
      title: '来源链接',
      dataIndex: 'inviteLinkId',
      key: 'inviteLinkId',
      render: (v: number) => links.find((l) => l.id === v)?.name || v,
    },
    {
      title: '首次使用',
      dataIndex: 'firstSeenAt',
      key: 'firstSeenAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '最后使用',
      key: 'lastSeenAt',
      render: (_: unknown, r: BotUserInfo) =>
        r.lastSeenAt === r.firstSeenAt ? '无' : dayjs(r.lastSeenAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, r: BotUserInfo) => (
        <Button size="small" icon={<HistoryOutlined />} onClick={() => openActions(r)}>
          最近操作
        </Button>
      ),
    },
  ];

  const actionColumns = [
    {
      title: '时间',
      dataIndex: 'clickedAt',
      key: 'clickedAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '类型',
      dataIndex: 'buttonType',
      key: 'buttonType',
      render: (v: 'next' | 'reveal') =>
        v === 'next' ? <Tag color="blue">翻页</Tag> : <Tag color="green">展开</Tag>,
    },
    { title: '来源链接', dataIndex: 'linkName', key: 'linkName' },
  ];

  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>用户列表</Title>
      <Space style={{ marginBottom: 16 }}>
        <Search
          placeholder="搜索用户名/ID"
          allowClear
          onSearch={(v) => { setSearch(v); setPage(1); }}
          style={{ width: 240 }}
        />
        <Select
          placeholder="选择机器人"
          allowClear
          style={{ width: 180 }}
          value={selectedBotId}
          onChange={handleBotChange}
          options={bots.map((b) => ({ label: b.name, value: b.id }))}
        />
        <Select
          placeholder="选择链接"
          allowClear
          style={{ width: 180 }}
          value={selectedLinkId}
          onChange={(v) => { setSelectedLinkId(v); setPage(1); }}
          disabled={!selectedBotId}
          options={links.map((l) => ({ label: l.name, value: l.id }))}
        />
      </Space>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={users}
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
      />
      <Drawer
        title={`最近操作${actionTarget ? ` - ${actionTarget.username ? '@' + actionTarget.username : actionTarget.firstName || actionTarget.telegramId}` : ''}`}
        open={actionDrawerOpen}
        onClose={() => setActionDrawerOpen(false)}
        width={640}
      >
        <Table
          rowKey="id"
          size="small"
          columns={actionColumns}
          dataSource={actions}
          loading={actionLoading}
          pagination={{
            current: actionPage,
            total: actionTotal,
            pageSize: 20,
            onChange: (p) => {
              setActionPage(p);
              if (actionTarget) fetchActions(actionTarget.id, p);
            },
            showTotal: (t) => `共 ${t} 条`,
          }}
          locale={{ emptyText: '该用户暂无翻页 / 展开记录' }}
        />
      </Drawer>
    </>
  );
}
