import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Card, Table, DatePicker, message, Typography, Statistic, Row, Col, Radio, Select, Space,
} from 'antd';
import {
  UserAddOutlined, TeamOutlined, NotificationOutlined,
  LineChartOutlined, BarChartOutlined, AreaChartOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, BarChart, AreaChart,
  Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type {
  StatsOverview, DailyStat, LinkStat, ButtonClickStat, SecondaryOpRateStat,
  BotInfo, ApiResponse,
} from 'shared';
import api from '@/services/api';

const { Title } = Typography;
const { RangePicker } = DatePicker;

type ChartType = 'line' | 'smooth' | 'bar' | 'area';

const BUTTON_LABEL: Record<string, string> = {
  next: '下一页 ▶',
  reveal: '🔽 展开更多',
};

function TrendChart({ data, chartType }: { data: DailyStat[]; chartType: ChartType }) {
  if (data.length === 0) {
    return <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>暂无趋势数据</div>;
  }

  const chartData = data.map((d) => ({ ...d, date: d.date.slice(5) }));

  const commonProps = {
    data: chartData,
    margin: { top: 5, right: 20, left: 0, bottom: 5 },
  };

  const renderChart = () => {
    switch (chartType) {
      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            <Bar dataKey="newUsers" name="新增用户" fill="#1677ff" />
            <Bar dataKey="adImpressions" name="广告展示" fill="#ff7a45" />
          </BarChart>
        );
      case 'area':
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            <Area type="monotone" dataKey="newUsers" name="新增用户" stroke="#1677ff" fill="#1677ff" fillOpacity={0.2} />
            <Area type="monotone" dataKey="adImpressions" name="广告展示" stroke="#ff7a45" fill="#ff7a45" fillOpacity={0.2} />
          </AreaChart>
        );
      case 'smooth':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="newUsers" name="新增用户" stroke="#1677ff" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="adImpressions" name="广告展示" stroke="#ff7a45" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        );
      default:
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            <Line type="linear" dataKey="newUsers" name="新增用户" stroke="#1677ff" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="linear" dataKey="adImpressions" name="广告展示" stroke="#ff7a45" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        );
    }
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      {renderChart()}
    </ResponsiveContainer>
  );
}

export default function Stats() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [linkStats, setLinkStats] = useState<LinkStat[]>([]);
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<number | null>(null);
  const [buttonClicks, setButtonClicks] = useState<ButtonClickStat[]>([]);
  const [secondaryStats, setSecondaryStats] = useState<SecondaryOpRateStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [chartType, setChartType] = useState<ChartType>('line');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, 'day'),
    dayjs(),
  ]);

  const rangeParams = useMemo(() => ({
    startDate: dateRange[0].format('YYYY-MM-DD'),
    endDate: dateRange[1].format('YYYY-MM-DD'),
  }), [dateRange]);

  const fetchBots = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<BotInfo[]>>('/bots');
      setBots(data.data || []);
    } catch {
      // 忽略
    }
  }, []);

  const fetchOverview = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<StatsOverview>>('/stats/overview');
      setOverview(data.data ?? null);
    } catch {
      message.error('获取概览数据失败');
    }
  }, []);

  const fetchDailyStats = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<DailyStat[]>>('/stats/daily', {
        params: rangeParams,
      });
      setDailyStats(data.data || []);
    } catch {
      message.error('获取趋势数据失败');
    }
  }, [rangeParams]);

  const fetchLinkStats = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (selectedBotId) params.botId = selectedBotId;
      const { data } = await api.get<ApiResponse<LinkStat[]>>('/stats/by-link', { params });
      setLinkStats(data.data || []);
    } catch {
      message.error('获取链接统计失败');
    } finally {
      setLoading(false);
    }
  }, [selectedBotId]);

  const fetchButtonClicks = useCallback(async () => {
    try {
      const params: Record<string, any> = { ...rangeParams };
      if (selectedBotId) params.botId = selectedBotId;
      const { data } = await api.get<ApiResponse<ButtonClickStat[]>>('/stats/button-clicks', { params });
      setButtonClicks(data.data || []);
    } catch {
      message.error('获取按钮点击统计失败');
    }
  }, [rangeParams, selectedBotId]);

  const fetchSecondaryStats = useCallback(async () => {
    try {
      const params: Record<string, any> = { ...rangeParams };
      if (selectedBotId) params.botId = selectedBotId;
      const { data } = await api.get<ApiResponse<SecondaryOpRateStat[]>>('/stats/secondary-op-rate', { params });
      setSecondaryStats(data.data || []);
    } catch {
      message.error('获取二次操作率失败');
    }
  }, [rangeParams, selectedBotId]);

  useEffect(() => { fetchBots(); }, [fetchBots]);
  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => { fetchDailyStats(); }, [fetchDailyStats]);
  useEffect(() => { fetchLinkStats(); }, [fetchLinkStats]);
  useEffect(() => { fetchButtonClicks(); }, [fetchButtonClicks]);
  useEffect(() => { fetchSecondaryStats(); }, [fetchSecondaryStats]);

  const linkColumns = [
    { title: '机器人', dataIndex: 'botName', key: 'botName' },
    { title: '链接名称', dataIndex: 'linkName', key: 'linkName' },
    { title: 'Code', dataIndex: 'linkCode', key: 'linkCode' },
    { title: '总用户', dataIndex: 'totalUsers', key: 'totalUsers', sorter: (a: LinkStat, b: LinkStat) => a.totalUsers - b.totalUsers },
    { title: '今日新增', dataIndex: 'todayUsers', key: 'todayUsers', sorter: (a: LinkStat, b: LinkStat) => a.todayUsers - b.todayUsers },
    { title: '总广告展示', dataIndex: 'totalAdImpressions', key: 'totalAdImpressions' },
  ];

  const buttonClickColumns = [
    {
      title: '按钮',
      dataIndex: 'buttonType',
      key: 'buttonType',
      render: (v: string) => BUTTON_LABEL[v] ?? v,
    },
    {
      title: '总点击数(非去重)',
      dataIndex: 'totalClicks',
      key: 'totalClicks',
      sorter: (a: ButtonClickStat, b: ButtonClickStat) => a.totalClicks - b.totalClicks,
    },
    {
      title: '去重用户数(按用户×链接×按钮)',
      dataIndex: 'uniqueClickers',
      key: 'uniqueClickers',
      sorter: (a: ButtonClickStat, b: ButtonClickStat) => a.uniqueClickers - b.uniqueClickers,
    },
  ];

  const secondaryColumns = [
    { title: '机器人', dataIndex: 'botName', key: 'botName' },
    { title: '链接名称', dataIndex: 'linkName', key: 'linkName' },
    { title: 'Code', dataIndex: 'linkCode', key: 'linkCode' },
    {
      title: '新增用户(分母)',
      dataIndex: 'newUsers',
      key: 'newUsers',
      sorter: (a: SecondaryOpRateStat, b: SecondaryOpRateStat) => a.newUsers - b.newUsers,
    },
    {
      title: '有二次操作的用户(分子)',
      dataIndex: 'activeUsers',
      key: 'activeUsers',
      sorter: (a: SecondaryOpRateStat, b: SecondaryOpRateStat) => a.activeUsers - b.activeUsers,
    },
    {
      title: '二次操作率',
      dataIndex: 'rate',
      key: 'rate',
      sorter: (a: SecondaryOpRateStat, b: SecondaryOpRateStat) => a.rate - b.rate,
      render: (_: number, r: SecondaryOpRateStat) =>
        r.newUsers === 0 ? '—' : `${(r.rate * 100).toFixed(1)}%`,
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>统计报表</Title>
        <a onClick={() => navigate('/stats/latency')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ThunderboltOutlined /> 查看延迟详情
        </a>
      </div>

      {/* 概览卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="今日新增用户"
              value={overview?.todayNewUsers ?? '-'}
              prefix={<UserAddOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="总用户数"
              value={overview?.totalUsers ?? '-'}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="今日广告展示"
              value={overview?.todayAdImpressions ?? '-'}
              prefix={<NotificationOutlined />}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 筛选条 */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <span>机器人:</span>
          <Select
            allowClear
            placeholder="全部机器人"
            style={{ width: 220 }}
            value={selectedBotId ?? undefined}
            onChange={(v) => setSelectedBotId(v ?? null)}
            options={bots.map((b) => ({ label: b.name, value: b.id }))}
          />
          <span>时间范围:</span>
          <RangePicker
            value={dateRange}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                setDateRange([dates[0], dates[1]]);
              }
            }}
          />
        </Space>
      </Card>

      {/* 趋势图 */}
      <Card
        title="趋势图"
        style={{ marginBottom: 24 }}
        extra={
          <Radio.Group value={chartType} onChange={(e) => setChartType(e.target.value)} size="small">
            <Radio.Button value="line"><LineChartOutlined /> 折线图</Radio.Button>
            <Radio.Button value="smooth"><LineChartOutlined /> 曲线图</Radio.Button>
            <Radio.Button value="bar"><BarChartOutlined /> 柱状图</Radio.Button>
            <Radio.Button value="area"><AreaChartOutlined /> 面积图</Radio.Button>
          </Radio.Group>
        }
      >
        <TrendChart data={dailyStats} chartType={chartType} />
      </Card>

      {/* 按钮点击统计 */}
      <Card title="按钮点击统计" style={{ marginBottom: 24 }}>
        <Table
          rowKey="buttonType"
          columns={buttonClickColumns}
          dataSource={buttonClicks}
          pagination={false}
          size="small"
          locale={{ emptyText: '该时间范围内暂无点击' }}
        />
      </Card>

      {/* 二次操作率 */}
      <Card title="二次操作率(有二次操作的用户 ÷ 新增用户,可能 >100%)" style={{ marginBottom: 24 }}>
        <Table
          rowKey="linkId"
          columns={secondaryColumns}
          dataSource={secondaryStats}
          pagination={false}
          size="small"
          locale={{ emptyText: '该时间范围内暂无新用户' }}
        />
      </Card>

      {/* 按链接细分 */}
      <Card title="按链接细分统计">
        <Table
          rowKey="linkId"
          columns={linkColumns}
          dataSource={linkStats}
          loading={loading}
          pagination={false}
          size="small"
        />
      </Card>
    </>
  );
}
