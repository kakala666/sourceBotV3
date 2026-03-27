import { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, DatePicker, message, Typography, Statistic, Row, Col, Radio,
} from 'antd';
import {
  UserAddOutlined, TeamOutlined, NotificationOutlined,
  LineChartOutlined, BarChartOutlined, AreaChartOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  ResponsiveContainer, LineChart, BarChart, AreaChart,
  Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type {
  StatsOverview, DailyStat, LinkStat, ApiResponse,
} from 'shared';
import api from '@/services/api';

const { Title } = Typography;
const { RangePicker } = DatePicker;

type ChartType = 'line' | 'smooth' | 'bar' | 'area';

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
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [linkStats, setLinkStats] = useState<LinkStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [chartType, setChartType] = useState<ChartType>('line');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, 'day'),
    dayjs(),
  ]);

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
        params: {
          startDate: dateRange[0].format('YYYY-MM-DD'),
          endDate: dateRange[1].format('YYYY-MM-DD'),
        },
      });
      setDailyStats(data.data || []);
    } catch {
      message.error('获取趋势数据失败');
    }
  }, [dateRange]);

  const fetchLinkStats = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<LinkStat[]>>('/stats/by-link');
      setLinkStats(data.data || []);
    } catch {
      message.error('获取链接统计失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => { fetchDailyStats(); }, [fetchDailyStats]);
  useEffect(() => { fetchLinkStats(); }, [fetchLinkStats]);

  const linkColumns = [
    { title: '机器人', dataIndex: 'botName', key: 'botName' },
    { title: '链接名称', dataIndex: 'linkName', key: 'linkName' },
    { title: 'Code', dataIndex: 'linkCode', key: 'linkCode' },
    { title: '总用户', dataIndex: 'totalUsers', key: 'totalUsers', sorter: (a: LinkStat, b: LinkStat) => a.totalUsers - b.totalUsers },
    { title: '今日新增', dataIndex: 'todayUsers', key: 'todayUsers', sorter: (a: LinkStat, b: LinkStat) => a.todayUsers - b.todayUsers },
    { title: '总广告展示', dataIndex: 'totalAdImpressions', key: 'totalAdImpressions' },
  ];

  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>统计报表</Title>

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

      {/* 趋势图 */}
      <Card
        title="趋势图"
        style={{ marginBottom: 24 }}
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Radio.Group value={chartType} onChange={(e) => setChartType(e.target.value)} size="small">
              <Radio.Button value="line"><LineChartOutlined /> 折线图</Radio.Button>
              <Radio.Button value="smooth"><LineChartOutlined /> 曲线图</Radio.Button>
              <Radio.Button value="bar"><BarChartOutlined /> 柱状图</Radio.Button>
              <Radio.Button value="area"><AreaChartOutlined /> 面积图</Radio.Button>
            </Radio.Group>
            <RangePicker
              value={dateRange}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setDateRange([dates[0], dates[1]]);
                }
              }}
            />
          </div>
        }
      >
        <TrendChart data={dailyStats} chartType={chartType} />
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
