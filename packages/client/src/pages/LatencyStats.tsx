import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Card, Table, DatePicker, message, Typography, Statistic, Row, Col, Select, Space, Button, Tag,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import type {
  LatencySummary, LatencyItem, BotInfo, ApiResponse,
} from 'shared';
import api from '@/services/api';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const BUTTON_LABEL: Record<string, string> = {
  next: '下一页 ▶',
  reveal: '🔽 展开更多',
};

export default function LatencyStats() {
  const navigate = useNavigate();
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<number | null>(null);
  const [buttonType, setButtonType] = useState<string | null>(null);
  const [summary, setSummary] = useState<LatencySummary | null>(null);
  const [items, setItems] = useState<LatencyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, 'day'),
    dayjs(),
  ]);

  const queryParams = useMemo(() => {
    const p: Record<string, any> = {
      startDate: dateRange[0].format('YYYY-MM-DD'),
      endDate: dateRange[1].format('YYYY-MM-DD'),
      page,
      pageSize,
    };
    if (selectedBotId) p.botId = selectedBotId;
    if (buttonType) p.buttonType = buttonType;
    return p;
  }, [dateRange, selectedBotId, buttonType, page, pageSize]);

  const fetchBots = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<BotInfo[]>>('/bots');
      setBots(data.data || []);
    } catch {
      // 忽略
    }
  }, []);

  const fetchLatency = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<{
        summary: LatencySummary; items: LatencyItem[]; total: number;
      }>>('/stats/latency', { params: queryParams });
      if (data.data) {
        setSummary(data.data.summary);
        setItems(data.data.items);
        setTotal(data.data.total);
      }
    } catch {
      message.error('获取延迟数据失败');
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  useEffect(() => { fetchBots(); }, [fetchBots]);
  useEffect(() => { fetchLatency(); }, [fetchLatency]);

  const fmtMs = (v: number) => `${v} ms`;
  const colorOfLatency = (v: number) => {
    if (v < 500) return 'green';
    if (v < 1500) return 'gold';
    if (v < 3000) return 'orange';
    return 'red';
  };

  const columns = [
    { title: '时间', dataIndex: 'clickedAt', key: 'clickedAt', width: 180,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
    { title: '机器人', dataIndex: 'botName', key: 'botName' },
    { title: '链接', dataIndex: 'linkName', key: 'linkName',
      render: (_: any, r: LatencyItem) => <span>{r.linkName} <Text type="secondary">({r.linkCode})</Text></span>,
    },
    { title: '按钮', dataIndex: 'buttonType', key: 'buttonType',
      render: (v: string) => BUTTON_LABEL[v] ?? v },
    { title: '延迟', dataIndex: 'latencyMs', key: 'latencyMs', width: 120,
      sorter: (a: LatencyItem, b: LatencyItem) => a.latencyMs - b.latencyMs,
      render: (v: number) => <Tag color={colorOfLatency(v)}>{fmtMs(v)}</Tag>,
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/stats')}>返回</Button>
        <Title level={4} style={{ margin: 0 }}>按钮响应延迟</Title>
      </div>

      {/* 汇总卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}>
          <Card><Statistic title="样本数" value={summary?.count ?? 0} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="p50 (中位)" value={summary?.p50 ?? '-'} suffix="ms" /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="p95" value={summary?.p95 ?? '-'} suffix="ms" valueStyle={{ color: '#faad14' }} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="p99" value={summary?.p99 ?? '-'} suffix="ms" valueStyle={{ color: '#fa541c' }} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="max" value={summary?.max ?? '-'} suffix="ms" valueStyle={{ color: '#cf1322' }} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="平均" value={summary?.avg ?? '-'} suffix="ms" /></Card>
        </Col>
      </Row>

      {/* 筛选 */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <span>机器人:</span>
          <Select
            allowClear
            placeholder="全部"
            style={{ width: 200 }}
            value={selectedBotId ?? undefined}
            onChange={(v) => { setSelectedBotId(v ?? null); setPage(1); }}
            options={bots.map((b) => ({ label: b.name, value: b.id }))}
          />
          <span>按钮类型:</span>
          <Select
            allowClear
            placeholder="全部"
            style={{ width: 160 }}
            value={buttonType ?? undefined}
            onChange={(v) => { setButtonType(v ?? null); setPage(1); }}
            options={[
              { label: '下一页 ▶', value: 'next' },
              { label: '🔽 展开更多', value: 'reveal' },
            ]}
          />
          <span>时间范围:</span>
          <RangePicker
            value={dateRange}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                setDateRange([dates[0], dates[1]]);
                setPage(1);
              }
            }}
          />
        </Space>
      </Card>

      {/* 明细表 */}
      <Card title="延迟明细">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['20', '50', '100', '200'],
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            showTotal: (t) => `共 ${t} 条`,
          }}
          size="small"
        />
      </Card>
    </>
  );
}
