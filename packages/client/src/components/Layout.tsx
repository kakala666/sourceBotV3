import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, theme } from 'antd';
import {
  RobotOutlined,
  FileImageOutlined,
  AppstoreOutlined,
  NotificationOutlined,
  TeamOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/stores/auth';

const { Header, Sider, Content } = AntLayout;

const menuItems = [
  { key: '/bots', icon: <RobotOutlined />, label: '机器人管理' },
  { key: '/resources', icon: <FileImageOutlined />, label: '资源管理' },
  { key: '/contents', icon: <AppstoreOutlined />, label: '内容配置' },
  { key: '/ads', icon: <NotificationOutlined />, label: '广告配置' },
  { key: '/users', icon: <TeamOutlined />, label: '用户列表' },
  { key: '/stats', icon: <BarChartOutlined />, label: '统计报表' },
  { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { admin, logout } = useAuthStore();
  const { token: { colorBgContainer, borderRadiusLG } } = theme.useToken();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // 匹配当前菜单项（支持子路由高亮）
  const selectedKey = menuItems.find((item) =>
    location.pathname.startsWith(item.key),
  )?.key || '/bots';

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        breakpoint="lg"
      >
        <div style={{
          height: 48,
          margin: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 600,
          fontSize: collapsed ? 14 : 16,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}>
          {collapsed ? 'Bot' : 'Bot 管理后台'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <AntLayout>
        <Header style={{
          padding: '0 24px',
          background: colorBgContainer,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <a
              href="https://github.com/tvvocold/How-To-Ask-Questions-The-Smart-Way?tab=readme-ov-file"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1677ff' }}
            >
              反馈BUG前看我
            </a>
            <a
              href="/manual"
              style={{ color: '#1677ff' }}
            >
              不会用就先看我
            </a>
            <span>管理员：{admin?.username}</span>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={handleLogout}
            >
              退出
            </Button>
          </div>
        </Header>
        <Content style={{
          margin: 24,
          padding: 24,
          background: colorBgContainer,
          borderRadius: borderRadiusLG,
          minHeight: 280,
        }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
