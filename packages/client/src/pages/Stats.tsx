import { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, DatePicker, message, Typography, Statistic, Row, Col,
} from 'antd';
import {
  UserAddOutlined, TeamOutlined, NotificationOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type {
  StatsOverview, DailyStat, LinkStat, ApiResponse,
} from 'shared';
import api from '@/services/api';

const { Title } = Typography;
const { RangePicker } = DatePicker;

// 简单趋势图占位组件（纯 CSS 柱状图）
function TrendChart({ data }: { data: DailyStat[] }) {
  if (data.length === 0) {
    return <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>暂无趋势数据</div>;
  }
  const maxUsers = Math.max(...data.map((d) => d.newUsers), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 200, padding: '0 8px' }}>
      {data.map((d) => (
        <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>
          <div
            style={{
              height: `${(d.newUsers / maxUsers) * 160}px`,
              background: '#1677ff',
              borderRadius: '4px 4px 0 0',
              minHeight: 2,
              transition: 'height 0.3s',
            }}
            title={`${d.date}: 新增 ${d.newUsers}, 广告 ${d.adImpressions}`}
          />
          <div style={{ fontSize: 10, color: '#999', marginTop: 4, transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>
            {d.date.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Stats() {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [linkStats, setLinkStats] = useState<LinkStat[]>([]);
  const [loading, setLoading] = useState(false);
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

      {/* 趋势图占位 */}
      <Card
        title="趋势图"
        style={{ marginBottom: 24 }}
        extra={
          <RangePicker
            value={dateRange}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                setDateRange([dates[0], dates[1]]);
              }
            }}
          />
        }
      >
        <TrendChart data={dailyStats} />
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
